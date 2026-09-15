import { ApiError } from './api-error';
import { db } from './storage';
import { balance } from './star-wallet';
import { giftDefinition } from './gift-catalog';
import { collectibleFromRow, type GiftUpgradeRow } from './gift-collectibles';
import { noctGiftsIdentity, noctGiftsLinkedUser } from './noct-gifts-account';
import { rateLimit } from './rate-limit';
import {
  NOCT_GIFTS_ALIASES,
  NOCT_GIFTS_CASES,
  NOCT_GIFTS_GAME_VERSION,
} from './noct-gifts-catalog';

type GameRequest = {
  kind: 'case' | 'upgrade';
  key: string;
  version: string;
  caseId?: string;
  count?: number;
  receiptId?: string;
  receiptIds?: string[];
  targetGiftId?: string;
};
type GameOperation = {
  id: string;
  key: string;
  kind: 'case' | 'upgrade';
  price: number;
  created: number;
  success: boolean;
  giftAlias?: string;
  giftId?: string;
  giftPrice?: number;
  caseId?: string;
  sourceReceiptId?: string;
  targetGiftId?: string;
  chance?: number;
  roll?: number;
};
type Saved = {
  request: GameRequest;
  operation: GameOperation;
  batch?: Saved[];
};
function word(value: unknown, max: number) {
  if (typeof value !== 'string' || !value || value.length > max)
    throw new ApiError(
      400,
      'Проверьте параметры операции.',
      'INVALID_GAME_REQUEST',
    );
  return value;
}
// Uniform tickets without modulo bias. Never called by the browser.
export function gameTicket(total: number) {
  const bytes = new Uint32Array(1),
    cutoff = 0x100000000 - (0x100000000 % total);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= cutoff);
  return bytes[0] % total;
}
async function savedOperation(id: string, userId: string) {
  const row = await db()
    .prepare(
      "SELECT postText FROM star_transfers WHERE id=? AND sender=? AND kind IN ('case_open','gift_risk_upgrade')",
    )
    .bind(id, userId)
    .first<{ postText: string }>();
  return row ? (JSON.parse(row.postText) as Saved) : null;
}
function sameRequest(saved: Saved, request: GameRequest) {
  if (JSON.stringify(saved.request) !== JSON.stringify(request))
    throw new ApiError(
      409,
      'Этот ключ уже использован для другой операции.',
      'GAME_KEY_CONFLICT',
    );
}
async function singleResponse(
  saved: Saved,
  userId: string,
  origin: string,
  wallet: number,
) {
  const op = saved.operation;
  const receipt = await db()
    .prepare(`SELECT g.id,g.giftId,g.created,g.hidden,
    (NOT EXISTS(SELECT 1 FROM gift_consumptions WHERE receiptId=g.id)
      AND NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=g.id)) AS available
    FROM received_gifts g WHERE g.transferId=? AND g.recipient=?`)
    .bind(op.id, userId)
    .first<{
      id: string;
      giftId: string;
      created: number;
      hidden: number;
      available: number;
    }>();
  const gift = receipt ? giftDefinition(receipt.giftId) : null;
  const upgraded = receipt
    ? await db()
        .prepare('SELECT * FROM gift_upgrades WHERE receiptId=?')
        .bind(receipt.id)
        .first<GiftUpgradeRow>()
    : null;
  const collectible = upgraded ? collectibleFromRow(upgraded) : null;
  const art =
    collectible?.model.asset &&
    /^collectible-[a-z_]+-[a-f0-9]{12}$/.test(collectible.model.asset)
      ? collectible.model.asset
      : gift?.id;
  return {
    userId,
    operation: op,
    balance: wallet,
    gift:
      receipt && gift
        ? {
            id: receipt.id,
            giftId: gift.id,
            name: gift.name,
            price: gift.price,
            color: gift.color,
            created: receipt.created,
            hidden: !!receipt.hidden,
            collectible,
            available: !!receipt.available,
            imageUrl: new URL(`/assets/gifts/${art}.webp`, origin).href,
            animationUrl: new URL(
              `/assets/gifts/${art}${art?.startsWith('collectible-') ? '.tgs' : '.json'}`,
              origin,
            ).href,
          }
        : null,
  };
}
async function response(saved: Saved, userId: string, origin: string) {
  const wallet = await balance(userId);
  if (!saved.batch?.length)
    return singleResponse(saved, userId, origin, wallet);
  const results = await Promise.all(
    [saved, ...saved.batch].map((item) =>
      singleResponse(item, userId, origin, wallet),
    ),
  );
  return {
    ...results[0],
    operation: {
      ...saved.operation,
      count: results.length,
      price: results.reduce((sum, item) => sum + item.operation.price, 0),
    },
    results: results.map(({ operation, gift }) => ({ operation, gift })),
    gifts: results.flatMap((item) => (item.gift ? [item.gift] : [])),
    balance: wallet,
  };
}
export async function noctGiftsGame(
  kind: 'case' | 'upgrade',
  body: Record<string, unknown>,
  origin: string,
) {
  const auth = await noctGiftsIdentity(body.initData);
  if (!auth.user)
    throw new ApiError(
      409,
      'Сначала привяжите Telegram к NoctGram.',
      'TELEGRAM_NOT_LINKED',
    );
  const me = auth.user;
  const verifiedResponse = async (saved: Saved) => {
    const result = await response(saved, me.id, origin);
    if (
      (await noctGiftsLinkedUser(auth.telegramId, auth.authenticatedAt))
        ?.linkId !== me.linkId
    )
      throw new ApiError(
        401,
        'Привязка изменилась. Откройте аккаунт заново.',
        'TELEGRAM_LINK_CHANGED',
      );
    return result;
  };
  const key = word(body.key, 120);
  if (!/^[a-zA-Z0-9_-]{16,120}$/.test(key))
    throw new ApiError(
      400,
      'Некорректный ключ операции.',
      'INVALID_GAME_REQUEST',
    );
  const count =
    kind === 'case' ? (body.count === undefined ? 1 : body.count) : 1;
  if (typeof count !== 'number' || ![1, 3, 5, 10].includes(count))
    throw new ApiError(
      400,
      'Выберите 1, 3, 5 или 10 открытий.',
      'INVALID_GAME_REQUEST',
    );
  let receiptIds: string[] = [];
  if (kind === 'upgrade') {
    if (body.receiptIds !== undefined) {
      if (
        body.receiptId !== undefined ||
        !Array.isArray(body.receiptIds) ||
        ![1, 3, 5, 10].includes(body.receiptIds.length)
      )
        throw new ApiError(
          400,
          'Выберите 1, 3, 5 или 10 разных подарков.',
          'INVALID_GAME_REQUEST',
        );
      receiptIds = body.receiptIds.map((id) => word(id, 220));
      if (new Set(receiptIds).size !== receiptIds.length)
        throw new ApiError(
          400,
          'Один подарок нельзя использовать дважды.',
          'INVALID_GAME_REQUEST',
        );
    } else receiptIds = [word(body.receiptId, 220)];
  }
  const request: GameRequest =
    kind === 'case'
      ? {
          kind,
          key,
          version: word(body.version, 60),
          caseId: word(body.caseId, 40),
          ...(count > 1 ? { count } : {}),
        }
      : {
          kind,
          key,
          version: word(body.version, 60),
          receiptId: receiptIds[0],
          targetGiftId: word(body.targetGiftId, 80),
          ...(receiptIds.length > 1 ? { receiptIds } : {}),
        };
  // One namespace for both actions: a key cannot be repurposed across endpoints.
  const id = `noct-game:${me.id}:${key}`;
  let saved = await savedOperation(id, me.id);
  if (saved) {
    sameRequest(saved, request);
    return verifiedResponse(saved);
  }
  if (request.version !== NOCT_GIFTS_GAME_VERSION)
    throw new ApiError(
      409,
      'Условия изменились. Обновите каталог перед подтверждением.',
      'GAME_CATALOG_CHANGED',
    );
  await rateLimit('noct-gifts-play', me.id, 20, 60);
  const now = Date.now();
  const operations: GameOperation[] = [];
  const operationKey = (index: number) =>
    index ? key + ':' + (index + 1) : key;
  const operationId = (index: number) => (index ? id + ':' + (index + 1) : id);
  if (kind === 'case') {
    const box = NOCT_GIFTS_CASES.find((c) => c.id === request.caseId);
    if (!box) throw new ApiError(400, 'Кейс недоступен.', 'CASE_NOT_FOUND');
    for (let index = 0; index < count; index++) {
      let ticket = gameTicket(100);
      const alias = box.items.find(([, weight]) => {
        if (ticket < weight) return true;
        ticket -= weight;
        return false;
      })?.[0];
      if (!alias) throw Error('Invalid case distribution');
      const giftId = NOCT_GIFTS_ALIASES[alias].id;
      operations.push({
        id: operationId(index),
        key: operationKey(index),
        kind,
        caseId: box.id,
        price: box.p,
        created: now,
        success: true,
        giftAlias: alias,
        giftId,
        giftPrice: giftDefinition(giftId)!.price,
      });
    }
  } else {
    const rows = await db()
      .prepare(`SELECT g.id,g.giftId FROM received_gifts g WHERE g.id IN(SELECT value FROM json_each(?)) AND g.recipient=?
      AND NOT EXISTS(SELECT 1 FROM gift_upgrades WHERE receiptId=g.id)
      AND NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=g.id)
      AND NOT EXISTS(SELECT 1 FROM gift_consumptions WHERE receiptId=g.id)`)
      .bind(JSON.stringify(receiptIds), me.id)
      .all<{ id: string; giftId: string }>();
    const sources = new Map(
      rows.results.map((g) => [g.id, giftDefinition(g.giftId)]),
    );
    const alias = Object.keys(NOCT_GIFTS_ALIASES).find(
      (a) => NOCT_GIFTS_ALIASES[a].id === request.targetGiftId,
    );
    const to = alias && giftDefinition(NOCT_GIFTS_ALIASES[alias].id);
    if (
      !to ||
      receiptIds.some(
        (receipt) =>
          !sources.get(receipt) || to.price <= sources.get(receipt)!.price,
      )
    )
      throw new ApiError(
        409,
        'Выберите доступные обычные подарки и более дорогую цель.',
        'GIFT_NOT_AVAILABLE',
      );
    receiptIds.forEach((receipt, index) => {
      const chance = Math.max(
        2,
        Math.min(92, Math.round((sources.get(receipt)!.price / to.price) * 88)),
      );
      const roll = gameTicket(10000) / 100;
      operations.push({
        id: operationId(index),
        key: operationKey(index),
        kind,
        sourceReceiptId: receipt,
        targetGiftId: to.id,
        price: 0,
        created: now,
        chance,
        roll,
        success: roll < chance,
        ...(roll < chance
          ? { giftId: to.id, giftAlias: alias, giftPrice: to.price }
          : {}),
      });
    });
  }
  const operation = operations[0],
    price = operation.price,
    totalPrice = operations.reduce((sum, op) => sum + op.price, 0);
  // Each draw retains its canonical ledger receipt. The parent freezes the whole
  // batch so racing/retried requests cannot redraw or partially award it.
  const batch: Saved[] = operations.slice(1).map((op) => ({
    request:
      kind === 'case'
        ? {
            kind,
            key: op.key,
            version: request.version,
            caseId: request.caseId,
          }
        : {
            kind,
            key: op.key,
            version: request.version,
            receiptId: op.sourceReceiptId,
            targetGiftId: request.targetGiftId,
          },
    operation: op,
  }));
  const payload = JSON.stringify({
    request,
    operation,
    ...(batch.length ? { batch } : {}),
  });
  // All eligibility and balance conditions are repeated in the write transaction.
  const sourceGate =
    kind === 'case'
      ? ''
      : `AND (SELECT COUNT(*) FROM received_gifts g WHERE g.id IN(SELECT value FROM json_each(?10)) AND g.recipient=u.id
    AND NOT EXISTS(SELECT 1 FROM gift_upgrades WHERE receiptId=g.id)
    AND NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=g.id)
    AND NOT EXISTS(SELECT 1 FROM gift_consumptions WHERE receiptId=g.id)) = ${receiptIds.length}`;
  const args: (string | number)[] = [
    id,
    payload,
    price,
    now,
    me.id,
    me.linkId,
    auth.telegramId,
    auth.authenticatedAt,
    kind === 'case' ? 'case_open' : 'gift_risk_upgrade',
  ];
  if (kind === 'upgrade') args.push(JSON.stringify(receiptIds));
  // Upgrade records carry zero Stars; only the source gift is consumed.
  const operationRecord = db()
    .prepare(`INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created)
    SELECT ?1,u.id,'noctgram_gifts',?2,?3,?9,?4 FROM users u
    WHERE u.id=?5 AND u.kind='person' AND u.deletedAt=0 AND u.onboardingComplete=1 AND u.sessionsRevokedAt<=?8
    AND EXISTS(SELECT 1 FROM telegram_links l WHERE l.id=?6 AND l.userId=u.id AND l.telegramId=?7)
    AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=u.id AND (ar.expiresAt IS NULL OR ar.expiresAt>?4))
    AND (?3 * ${operations.length}) <= (SELECT COALESCE(SUM(CASE WHEN recipient=u.id THEN amount ELSE -amount END),0) FROM star_transfers WHERE recipient=u.id OR sender=u.id)
    ${sourceGate} ON CONFLICT(id) DO NOTHING`)
    .bind(...args);
  const statements = [operationRecord];
  if (batch.length)
    statements.push(
      db()
        .prepare(`INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created)
    SELECT json_extract(child.value,'$.operation.id'),parent.sender,parent.recipient,child.value,
      json_extract(child.value,'$.operation.price'),parent.kind,parent.created
    FROM star_transfers parent,json_each(parent.postText,'$.batch') child
    WHERE parent.id=? AND parent.sender=? AND parent.kind IN ('case_open','gift_risk_upgrade')
    ON CONFLICT(id) DO NOTHING`)
        .bind(id, me.id),
    );
  const batchIds = `id IN(SELECT ? UNION ALL SELECT json_extract(child.value,'$.operation.id')
    FROM star_transfers parent,json_each(parent.postText,'$.batch') child WHERE parent.id=?)`;

  if (kind === 'upgrade')
    statements.push(
      db()
        .prepare(`INSERT INTO gift_consumptions(receiptId,transferId,created)
    SELECT json_extract(postText,'$.request.receiptId'),id,created FROM star_transfers
    WHERE ${batchIds} AND sender=? AND kind='gift_risk_upgrade' ON CONFLICT(receiptId) DO NOTHING`)
        .bind(id, id, me.id),
    );
  // Read the persisted outcome even when another identical request won the race.
  statements.push(
    db()
      .prepare(`INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,message,created)
    SELECT id,id,json_extract(postText,'$.operation.giftId'),sender,sender,?,created FROM star_transfers
    WHERE ${batchIds} AND sender=? AND kind IN ('case_open','gift_risk_upgrade') AND json_extract(postText,'$.operation.success')=1
    ON CONFLICT(id) DO NOTHING`)
      .bind(
        kind === 'case'
          ? 'Получен в Noct Gifts'
          : 'Получен после апгрейда Noct Gifts',
        id,
        id,
        me.id,
      ),
  );
  await db().batch(statements);
  saved = await savedOperation(id, me.id);
  if (!saved) {
    if (kind === 'case' && (await balance(me.id)) < totalPrice)
      throw new ApiError(409, 'Не хватает Noct Stars.', 'INSUFFICIENT_STARS');
    throw new ApiError(
      409,
      'Операция недоступна. Обновите аккаунт и выбранный подарок.',
      'GAME_NOT_AVAILABLE',
    );
  }
  sameRequest(saved, request);
  return verifiedResponse(saved);
}
