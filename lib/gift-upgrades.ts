import { db } from './storage';
import { ApiError } from './api-error';
import { visibleAccount } from './account-access';
import { balance, ensureWallet } from './star-wallet';
import { rateLimit } from './rate-limit';
import { upgradeCollection } from './gift-upgrade-catalog';
import {
  collectibleFromRow,
  type GiftAttribute,
  type GiftAttributes,
  type GiftUpgradeRow,
} from './gift-collectibles';

function receiptId(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 220)
    throw new ApiError(400, 'Выбери полученный подарок');
  return value;
}

async function ownedGift(me: string, id: string) {
  const gift = await db()
    .prepare(`SELECT g.giftId FROM received_gifts g JOIN users u ON u.id=g.recipient
      WHERE g.id=? AND g.recipient=? AND u.kind='person' AND ${visibleAccount('u')}
        AND NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=g.id)
        AND NOT EXISTS(SELECT 1 FROM gift_consumptions WHERE receiptId=g.id)`)
    .bind(id, me)
    .first<{ giftId: string }>();
  if (!gift) throw new ApiError(404, 'Подарок не найден');
  return gift;
}

async function upgradedGift(me: string, id: string) {
  const row = await db()
    .prepare(`SELECT c.* FROM gift_upgrades c JOIN received_gifts g ON g.id=c.receiptId
      WHERE c.receiptId=? AND g.recipient=?`)
    .bind(id, me)
    .first<GiftUpgradeRow>();
  return row ? collectibleFromRow(row) : null;
}

export async function previewGiftUpgrade(me: string, value: unknown) {
  const id = receiptId(value);
  const gift = await ownedGift(me, id);
  await ensureWallet(me);
  return {
    collection: upgradeCollection(gift.giftId),
    collectible: await upgradedGift(me, id),
    balance: await balance(me),
  };
}

// Draw from the complete server-owned distribution, with no modulo bias.
export function drawGiftAttribute<T extends GiftAttribute>(attributes: T[]): T {
  const total = attributes.reduce((sum, item) => sum + item.rarityPermille, 0);
  if (
    total !== 1000 ||
    attributes.some(
      (item) =>
        !Number.isSafeInteger(item.rarityPermille) || item.rarityPermille <= 0,
    )
  )
    throw new Error('Incomplete gift attribute distribution');
  const cutoff = 0x100000000 - (0x100000000 % total);
  const values = new Uint32Array(1);
  let random: number;
  do {
    crypto.getRandomValues(values);
    random = values[0];
  } while (random >= cutoff);
  let ticket = random % total;
  for (const item of attributes) {
    if (ticket < item.rarityPermille) return item;
    ticket -= item.rarityPermille;
  }
  throw new Error('Invalid gift attribute distribution');
}

export async function upgradeGift(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  const id = receiptId(body.id);
  const gift = await ownedGift(me, id);
  // The receipt, not a browser session, is the idempotency boundary. Even a
  // simultaneous request from another device can only obtain this one result.
  const previous = await upgradedGift(me, id);
  if (previous) return { collectible: previous, balance: await balance(me) };
  const collection = upgradeCollection(gift.giftId);
  if (!collection) throw new ApiError(400, 'Этот подарок нельзя улучшить');
  if (typeof body.keepOriginal !== 'boolean')
    throw new ApiError(400, 'Выбери, сохранять ли сведения об отправителе');
  if (body.expectedPrice !== collection.price)
    throw new ApiError(
      409,
      'Стоимость улучшения изменилась. Открой подарок заново.',
    );
  await rateLimit('gift-upgrades', me, 12, 60);
  await ensureWallet(me);
  const attributes: GiftAttributes = {
    model: drawGiftAttribute(collection.models),
    backdrop: drawGiftAttribute(collection.backdrops),
    symbol: drawGiftAttribute(collection.symbols),
  };
  const transfer = 'gift-upgrade:' + id;
  await db().batch([
    db()
      .prepare(`INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created)
      SELECT ?,u.id,'noctgram_gifts',?,?,'gift_upgrade',? FROM received_gifts g JOIN users u ON u.id=g.recipient
      WHERE g.id=? AND g.recipient=? AND g.giftId=? AND u.kind='person' AND ${visibleAccount('u')}
        AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=u.id AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))
        AND NOT EXISTS(SELECT 1 FROM gift_upgrades WHERE receiptId=g.id)
        AND NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=g.id)
        AND NOT EXISTS(SELECT 1 FROM gift_consumptions WHERE receiptId=g.id)
        AND ? <= (SELECT COALESCE(SUM(CASE WHEN recipient=u.id THEN amount ELSE -amount END),0) FROM star_transfers WHERE recipient=u.id OR sender=u.id)
      ON CONFLICT(id) DO NOTHING`)
      .bind(
        transfer,
        JSON.stringify({ receiptId: id, giftId: gift.giftId }),
        collection.price,
        now,
        id,
        me,
        collection.id,
        collection.price,
      ),
    db()
      .prepare(`INSERT INTO gift_collection_sequences(family,lastNumber)
      SELECT ?,1 WHERE EXISTS(SELECT 1 FROM star_transfers WHERE id=? AND sender=? AND kind='gift_upgrade')
        AND NOT EXISTS(SELECT 1 FROM gift_upgrades WHERE receiptId=?)
      ON CONFLICT(family) DO UPDATE SET lastNumber=lastNumber+1`)
      .bind(collection.id, transfer, me, id),
    db()
      .prepare(`INSERT INTO gift_upgrades(receiptId,transferId,family,number,attributes,keepOriginal,created)
      SELECT g.id,t.id,g.giftId,c.lastNumber,?,?,t.created FROM received_gifts g
      JOIN star_transfers t ON t.id=? AND t.sender=g.recipient AND t.kind='gift_upgrade'
      JOIN gift_collection_sequences c ON c.family=g.giftId
      WHERE g.id=? AND g.recipient=? AND NOT EXISTS(SELECT 1 FROM gift_upgrades WHERE receiptId=g.id)
      ON CONFLICT(receiptId) DO NOTHING`)
      .bind(
        JSON.stringify(attributes),
        Number(body.keepOriginal),
        transfer,
        id,
        me,
      ),
  ]);
  const collectible = await upgradedGift(me, id);
  if (!collectible) {
    if ((await balance(me)) < collection.price)
      throw new ApiError(400, 'Не хватает Noct Stars для улучшения');
    throw new ApiError(403, 'Сейчас улучшение подарка недоступно');
  }
  return { collectible, balance: await balance(me) };
}
