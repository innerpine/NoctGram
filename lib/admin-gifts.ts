import { db } from './storage';
import { ApiError } from './api-error';
import { requireAdministrator } from './administrator-access';
import { visibleAccount } from './account-access';
import { GIFT_CATALOG } from './gift-catalog';
import { upgradeCollection } from './gift-upgrade-catalog';
import { rateLimit } from './rate-limit';
import type { GiftAttributes } from './gift-collectibles';

function text(value: unknown, max: number, required = true) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new ApiError(400, 'Проверьте параметры подарка.');
  return value.trim();
}
function integer(value: unknown, min: number, max: number, label: string) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new ApiError(400, label);
  return value;
}
const nextNumberSql = `MAX(COALESCE((SELECT lastNumber FROM gift_collection_sequences WHERE family=?),0),COALESCE((SELECT MAX(number) FROM gift_upgrades WHERE family=?),0))+1`;
type GrantEvent = {
  id: string;
  actorId: string;
  targetId: string;
  action: string;
  amount: number;
  reason: string;
  payload: string;
};
type SavedPayload = {
  fingerprint: string;
  firstNumber: number;
  count: number;
  giftId: string;
};

export async function adminGiftCatalog(me: string, giftId: string) {
  await requireAdministrator(me);
  const gifts = GIFT_CATALOG.filter((g) => upgradeCollection(g.id)).map(
    ({ id, name }) => ({ id, name }),
  );
  if (!giftId) return { gifts };
  const collection = upgradeCollection(giftId);
  if (!collection || !gifts.some((g) => g.id === giftId))
    throw new ApiError(400, 'Выберите коллекционный подарок.');
  const next = await db()
    .prepare(`SELECT ${nextNumberSql} AS number`)
    .bind(giftId, giftId)
    .first<{ number: number }>();
  return { gifts, collection, nextNumber: next?.number || 1 };
}

export async function grantCollectibleGifts(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  await requireAdministrator(me);
  const target = text(body.target, 100),
    giftId = text(body.giftId, 100);
  const modelId = text(body.modelId, 100),
    backdropId = text(body.backdropId, 100),
    symbolId = text(body.symbolId, 100);
  const requestId = text(body.requestId, 36),
    reason = text(body.reason, 500);
  const message = text(body.message ?? '', 240, false);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      requestId,
    )
  )
    throw new ApiError(400, 'Обновите форму и повторите.');
  const count = integer(
    body.count,
    1,
    10,
    'Можно выдать от 1 до 10 подарков за раз.',
  );
  const startNumber =
    body.startNumber === null
      ? null
      : integer(
          body.startNumber,
          1,
          1_000_000_000 - count + 1,
          'Укажите свободный номер от 1 до 1 000 000 000.',
        );
  if (typeof body.keepOriginal !== 'boolean')
    throw new ApiError(400, 'Проверьте сохранение подписи.');
  const id = `admin-gift:${requestId}`;
  const input = {
    target,
    giftId,
    modelId,
    backdropId,
    symbolId,
    count,
    startNumber,
    keepOriginal: body.keepOriginal,
    message,
    reason,
  };
  const fingerprint = JSON.stringify(input);
  const d = db();
  function outcome(event: GrantEvent) {
    const payload = JSON.parse(event.payload) as SavedPayload;
    if (
      event.action !== 'collectible' ||
      event.actorId !== me ||
      event.targetId !== target ||
      event.amount !== count ||
      event.reason !== reason ||
      payload.fingerprint !== fingerprint
    )
      throw new ApiError(
        409,
        'Этот запрос уже использован с другими параметрами.',
      );
    return {
      ok: true,
      giftId: payload.giftId,
      firstNumber: payload.firstNumber,
      lastNumber: payload.firstNumber + payload.count - 1,
      count: payload.count,
    };
  }
  const old = await d
    .prepare('SELECT * FROM admin_events WHERE id=?')
    .bind(id)
    .first<GrantEvent>();
  if (old) return { ...outcome(old), replayed: true };
  const collection = upgradeCollection(giftId);
  if (!collection || !GIFT_CATALOG.some((g) => g.id === giftId))
    throw new ApiError(400, 'Этот подарок недоступен для выдачи.');
  const model = collection.models.find((a) => a.id === modelId),
    backdrop = collection.backdrops.find((a) => a.id === backdropId),
    symbol = collection.symbols.find((a) => a.id === symbolId);
  if (!model || !backdrop || !symbol)
    throw new ApiError(
      400,
      'Модель, фон и узор должны принадлежать выбранному подарку.',
    );
  const attributes: GiftAttributes & { issuance: 'admin' } = {
    model,
    backdrop,
    symbol,
    issuance: 'admin',
  };
  const payload = JSON.stringify({ ...input, fingerprint, attributes });
  await rateLimit('admin-gifts', me, 12, 60);
  const targetUser = await d
    .prepare(
      `SELECT id FROM users u WHERE id=? AND kind='person' AND ${visibleAccount('u')}`,
    )
    .bind(target)
    .first();
  if (!targetUser)
    throw new ApiError(404, 'Выберите доступный личный аккаунт.');
  const gate = `EXISTS(SELECT 1 FROM administrators a JOIN users u ON u.id=a.userId WHERE a.userId=? AND u.kind='person' AND ${visibleAccount('u')} AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=u.id AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))) AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.kind='person' AND ${visibleAccount('u')})`;
  const statements: D1PreparedStatement[] = [
    d
      .prepare(`INSERT INTO admin_events(id,actorId,targetId,action,amount,reason,payload,created)
    SELECT ?,?,?,'collectible',?,?,json_set(?,'$.firstNumber',CAST(COALESCE(?,${nextNumberSql}) AS INTEGER)),? WHERE ${gate}
    ON CONFLICT(id) DO NOTHING`)
      .bind(
        id,
        me,
        target,
        count,
        reason,
        payload,
        startNumber,
        giftId,
        giftId,
        now,
        me,
        target,
      ),
  ];
  // The canonical event owns the entire batch. Retries (even with a changed body)
  // cannot insert any row unless its fingerprint matches the committed event.
  for (let i = 0; i < count; i++) {
    const receipt = `${id}:${i}`;
    statements.push(
      d
        .prepare(`INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created)
        SELECT ?,NULL,'noctgram_gifts',json_object('adminEventId',id,'receiptId',?,'index',CAST(? AS INTEGER)),0,'gift_admin',created FROM admin_events
        WHERE id=? AND json_extract(payload,'$.fingerprint')=? ON CONFLICT(id) DO NOTHING`)
        .bind(receipt, receipt, i, id, fingerprint),
      d
        .prepare(`INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,message,created)
        SELECT ?,?,json_extract(payload,'$.giftId'),actorId,targetId,json_extract(payload,'$.message'),created FROM admin_events
        WHERE id=? AND json_extract(payload,'$.fingerprint')=? ON CONFLICT(id) DO NOTHING`)
        .bind(receipt, receipt, id, fingerprint),
      d
        .prepare(`INSERT INTO gift_upgrades(receiptId,transferId,family,number,attributes,keepOriginal,created)
        SELECT ?,?,json_extract(payload,'$.giftId'),json_extract(payload,'$.firstNumber')+?,json_extract(payload,'$.attributes'),json_extract(payload,'$.keepOriginal'),created FROM admin_events
        WHERE id=? AND json_extract(payload,'$.fingerprint')=? AND NOT EXISTS(SELECT 1 FROM gift_upgrades WHERE receiptId=?)`)
        .bind(receipt, receipt, i, id, fingerprint, receipt),
      d
        .prepare(`INSERT INTO notifications(id,userId,actorId,kind,targetId,created)
        SELECT g.id,g.recipient,g.sender,'gift',g.id,g.created FROM received_gifts g JOIN gift_upgrades c ON c.receiptId=g.id
        WHERE g.id=? AND g.recipient<>g.sender ON CONFLICT(id) DO NOTHING`)
        .bind(receipt),
    );
  }
  try {
    await d.batch(statements);
  } catch (error) {
    if (
      /UNIQUE constraint failed: gift_upgrades\.family, gift_upgrades\.number|UNIQUE constraint failed: gift_collection_number/i.test(
        String(error),
      )
    )
      throw new ApiError(
        409,
        'Один из этих номеров уже занят. Выберите другой номер или автоматическую нумерацию. Ничего не выдано.',
      );
    throw error;
  }
  const saved = await d
    .prepare('SELECT * FROM admin_events WHERE id=?')
    .bind(id)
    .first<GrantEvent>();
  if (!saved)
    throw new ApiError(
      409,
      'Права администратора или аккаунт получателя изменились.',
    );
  return outcome(saved);
}
