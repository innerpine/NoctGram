import { db } from './storage';
import { ApiError } from './api-error';
import { visibleAccount } from './account-access';
import { requireAdministrator } from './administrator-access';
import { balance, ensureWallet } from './star-wallet';
import { rateLimit } from './rate-limit';
import { GIFT_CATALOG, RETIRED_GIFTS, giftDefinition } from './gift-catalog';
import type { GiftAttributes } from './gift-collectibles';
import {
  MARKET_MAX_PRICE,
  formatMarketNumber,
  marketFee,
  type MarketAsset,
  type MarketAssets,
  type MarketCatalog,
  type MarketFacet,
  type MarketGift,
  type MarketKind,
  type MarketLot,
  type MarketPerson,
  type MarketRow,
} from './market-policy';

const kinds: readonly MarketKind[] = ['number', 'username', 'gift'];
const reservedNames = [
  'admin',
  'support',
  'system',
  'noctgram',
  'premium',
  'root',
];
const gone = 'Лот уже продан или снят с продажи';

function text(input: unknown, max: number) {
  if (typeof input !== 'string' || !input.trim() || input.length > max)
    throw new ApiError(400, 'Проверьте данные лота');
  return input.trim();
}
function kindOf(input: unknown) {
  if (!kinds.includes(input as MarketKind))
    throw new ApiError(400, 'Неизвестный тип лота');
  return input as MarketKind;
}
function priceOf(input: unknown) {
  if (
    !Number.isSafeInteger(input) ||
    (input as number) < 1 ||
    (input as number) > MARKET_MAX_PRICE
  )
    throw new ApiError(400, 'Цена: от 1 до 10 000 000 Stars');
  return input as number;
}
function giftKey(key: string) {
  const at = key.lastIndexOf(':'),
    number = Number(key.slice(at + 1));
  if (at < 1 || !Number.isSafeInteger(number) || number < 1)
    throw new ApiError(404, 'Лот не найден');
  return { family: key.slice(0, at), number };
}
const giftName = (family: string) => giftDefinition(family)?.name || 'Подарок';
function marketGift(row: {
  family: string;
  number: number;
  attributes: string;
}): MarketGift {
  return {
    family: row.family,
    number: row.number,
    name: giftName(row.family),
    attributes: JSON.parse(row.attributes) as GiftAttributes,
  };
}
function titleOf(kind: MarketKind, key: string, gift?: MarketGift) {
  return kind === 'number'
    ? formatMarketNumber(key)
    : kind === 'username'
      ? '@' + key
      : `${gift?.name || 'Подарок'} #${gift?.number ?? ''}`;
}

// SQL fragments. Aliases are internal identifiers; values always use bindings.
const unrestricted = (alias: string) =>
  `NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=${alias}.id AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))`;
const alive = `NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=g.id) AND NOT EXISTS(SELECT 1 FROM gift_consumptions WHERE receiptId=g.id)`;
// Ownership is re-checked wherever a listing is trusted: a listing is only a price tag.
const sellerOwns = `CASE l.kind
  WHEN 'number' THEN EXISTS(SELECT 1 FROM market_numbers n WHERE n.number=l.assetId AND n.ownerId IS l.sellerId)
  WHEN 'username' THEN CASE WHEN l.sellerId IS NULL THEN NOT EXISTS(SELECT 1 FROM handles h WHERE h.handle=l.assetId)
    ELSE EXISTS(SELECT 1 FROM handles h WHERE h.handle=l.assetId AND h.userId=l.sellerId AND h.main=0) END
  ELSE EXISTS(SELECT 1 FROM received_gifts g JOIN gift_upgrades c ON c.receiptId=g.id WHERE g.id=l.assetId AND g.recipient=l.sellerId AND ${alive}) END`;
const sellerVisible = `(l.sellerId IS NULL OR EXISTS(SELECT 1 FROM users s WHERE s.id=l.sellerId AND s.kind='person' AND ${visibleAccount('s')}))`;
const personColumns = (alias: string) =>
  `${alias}.id,${alias}.name,${alias}.avatar,COALESCE((SELECT handle FROM handles WHERE userId=${alias}.id AND main=1),'') AS handle`;
const sweep = (now: number, kind: MarketKind, assetId: string) =>
  db()
    .prepare(
      `UPDATE market_listings AS l SET status='cancelled',closed=?1 WHERE l.kind=?2 AND l.assetId=?3 AND l.status='active' AND NOT (${sellerOwns})`,
    )
    .bind(now, kind, assetId);

export async function buyLot(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  const listingId = text(body.listingId, 120),
    expected = priceOf(body.expectedPrice);
  const d = db();
  const lot = await d
    .prepare(
      `SELECT l.kind,l.assetId,l.sellerId,l.price,l.status,l.buyerId,c.family,c.number,c.attributes
      FROM market_listings l LEFT JOIN gift_upgrades c ON l.kind='gift' AND c.receiptId=l.assetId WHERE l.id=?`,
    )
    .bind(listingId)
    .first<{
      kind: MarketKind;
      assetId: string;
      sellerId: string | null;
      price: number;
      status: string;
      buyerId: string | null;
      family: string;
      number: number;
      attributes: string;
    }>();
  if (!lot) throw new ApiError(404, 'Лот не найден');
  // The listing, not a browser session, is the idempotency boundary.
  if (lot.status === 'sold' && lot.buyerId === me)
    return { ok: true, balance: await balance(me) };
  if (lot.status !== 'active') throw new ApiError(409, gone);
  if (lot.price !== expected)
    throw new ApiError(409, 'Цена лота изменилась. Обновите страницу.');
  if (lot.sellerId === me) throw new ApiError(400, 'Это ваш лот');
  await rateLimit('market-buy', me, 20, 60);
  await ensureWallet(me);
  const fee = lot.sellerId ? marketFee(lot.price) : 0;
  const title = titleOf(
    lot.kind,
    lot.assetId,
    lot.kind === 'gift' ? marketGift(lot) : undefined,
  );
  const paid = `EXISTS(SELECT 1 FROM market_listings l JOIN star_transfers t ON t.id='market:'||l.id WHERE l.id=?1 AND l.status='active' AND t.sender=?2 AND t.kind='market_sale')`;
  const move =
    lot.kind === 'number'
      ? d
          .prepare(
            `UPDATE market_numbers SET ownerId=?2,displayed=NOT EXISTS(SELECT 1 FROM market_numbers m WHERE m.ownerId=?2 AND m.displayed=1) WHERE number=?3 AND ${paid}`,
          )
          .bind(listingId, me, lot.assetId)
      : lot.kind === 'gift'
        ? d
            .prepare(
              // The buyer becomes the recorded sender: the original gifter and caption stay private.
              `UPDATE received_gifts SET recipient=?2,sender=?2,message='Куплен в Маркете',hidden=0 WHERE id=?3 AND recipient=?4 AND ${paid}`,
            )
            .bind(listingId, me, lot.assetId, lot.sellerId)
        : lot.sellerId
          ? d
              .prepare(
                `UPDATE handles SET userId=?2,main=0 WHERE handle=?3 AND userId=?4 AND main=0 AND ${paid}`,
              )
              .bind(listingId, me, lot.assetId, lot.sellerId)
          : d
              .prepare(
                `INSERT INTO handles(handle,userId,main) SELECT ?3,?2,0 WHERE ${paid}`,
              )
              .bind(listingId, me, lot.assetId);
  await d.batch([
    d
      .prepare(
        `INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created)
      SELECT 'market:'||l.id,b.id,COALESCE(l.sellerId,'noctgram_gifts'),?3,l.price-?4,'market_sale',?5
      FROM market_listings l JOIN users b ON b.id=?2
      WHERE l.id=?1 AND l.status='active' AND l.price=?6
        AND b.kind='person' AND ${visibleAccount('b')} AND ${unrestricted('b')}
        AND (l.sellerId IS NULL OR l.sellerId<>b.id) AND ${sellerVisible} AND ${sellerOwns}
        AND (l.kind<>'username' OR (SELECT COUNT(*) FROM handles WHERE userId=b.id)<5)
        AND l.price <= (SELECT COALESCE(SUM(CASE WHEN recipient=b.id THEN amount ELSE -amount END),0) FROM star_transfers WHERE recipient=b.id OR sender=b.id)
      ON CONFLICT(id) DO NOTHING`,
      )
      .bind(listingId, me, title, fee, now, expected),
    ...(fee
      ? [
          d
            .prepare(
              `INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created)
            SELECT 'market-fee:'||?1,?2,'noctgram_gifts',?3,?4,'market_fee',?5 WHERE ${paid}
            ON CONFLICT(id) DO NOTHING`,
            )
            .bind(listingId, me, title, fee, now),
        ]
      : []),
    move,
    d
      .prepare(
        `UPDATE market_listings SET status='sold',buyerId=?2,fee=?3,closed=?4 WHERE id=?1 AND status='active'
        AND EXISTS(SELECT 1 FROM star_transfers t WHERE t.id='market:'||?1 AND t.sender=?2 AND t.kind='market_sale')`,
      )
      .bind(listingId, me, fee, now),
  ]);
  const done = await d
    .prepare('SELECT status,buyerId FROM market_listings WHERE id=?')
    .bind(listingId)
    .first<{ status: string; buyerId: string | null }>();
  const remaining = await balance(me);
  if (done?.status === 'sold' && done.buyerId === me)
    return { ok: true, balance: remaining };
  if (done?.status !== 'active') throw new ApiError(409, gone);
  if (remaining < lot.price)
    throw new ApiError(409, 'Не хватает Noct Stars', 'INSUFFICIENT_STARS');
  if (lot.kind === 'username') {
    const owned = await d
      .prepare('SELECT COUNT(*) AS n FROM handles WHERE userId=?')
      .bind(me)
      .first<{ n: number }>();
    if (Number(owned?.n) >= 5)
      throw new ApiError(
        409,
        'У вас уже 5 юзернеймов. Освободите место в профиле и повторите.',
      );
  }
  await sweep(now, lot.kind, lot.assetId).run();
  throw new ApiError(
    403,
    'Покупка сейчас недоступна: лот снят или аккаунт ограничен.',
  );
}

export async function listAsset(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  const kind = kindOf(body.kind),
    key = text(body.key, 140).toLowerCase(),
    price = priceOf(body.price);
  await rateLimit('market-list', me, 20, 60);
  const d = db(),
    id = crypto.randomUUID();
  const seller = `u.id=?4 AND u.kind='person' AND ${visibleAccount('u')} AND ${unrestricted('u')}`;
  const gift = kind === 'gift' ? giftKey(key) : null;
  // Ownership is asserted by the INSERT itself, never by a preflight read.
  const source =
    kind === 'number'
      ? `n.number,u.id,?2,?3 FROM market_numbers n JOIN users u ON u.id=n.ownerId WHERE n.number=?5 AND ${seller}`
      : kind === 'username'
        ? `h.handle,u.id,?2,?3 FROM handles h JOIN users u ON u.id=h.userId WHERE h.handle=?5 AND h.main=0 AND ${seller}`
        : `g.id,u.id,?2,?3 FROM gift_upgrades c JOIN received_gifts g ON g.id=c.receiptId JOIN users u ON u.id=g.recipient
          WHERE c.family=?5 AND c.number=?6 AND ${alive} AND ${seller}`;
  await d.batch([
    ...(kind === 'username' ? [sweep(now, kind, key)] : []),
    d
      .prepare(
        `INSERT OR IGNORE INTO market_listings(id,kind,assetId,sellerId,price,created) SELECT ?1,'${kind}',${source}`,
      )
      .bind(id, price, now, me, ...(gift ? [gift.family, gift.number] : [key])),
  ]);
  if (
    !(await d
      .prepare('SELECT id FROM market_listings WHERE id=?')
      .bind(id)
      .first())
  )
    throw new ApiError(
      409,
      'Не удалось выставить: актив уже продаётся, не принадлежит вам или аккаунт ограничен.',
    );
  return { ok: true, listingId: id };
}

export async function cancelLot(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  const result = await db()
    .prepare(
      `UPDATE market_listings SET status='cancelled',closed=?2 WHERE id=?1 AND status='active'
      AND (sellerId=?3 OR (sellerId IS NULL AND EXISTS(SELECT 1 FROM administrators WHERE userId=?3)))`,
    )
    .bind(text(body.listingId, 120), now, me)
    .run();
  if (!result.meta.changes) throw new ApiError(409, gone);
  return { ok: true };
}

export async function displayNumber(me: string, body: Record<string, unknown>) {
  const number = body.number === null ? null : text(body.number, 8);
  const d = db();
  const result = await d.batch([
    d
      .prepare(
        'UPDATE market_numbers SET displayed=0 WHERE ownerId=? AND displayed=1',
      )
      .bind(me),
    ...(number
      ? [
          d
            .prepare(
              'UPDATE market_numbers SET displayed=1 WHERE number=? AND ownerId=?',
            )
            .bind(number, me),
        ]
      : []),
  ]);
  if (number && !result[1]?.meta.changes)
    throw new ApiError(404, 'Номер не найден');
  return { ok: true };
}

function parseLots(kind: 'number' | 'username', raw: string) {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 50)
    throw new ApiError(400, 'От 1 до 50 лотов, по одному в строке.');
  const lots = lines.map((line) => {
    const match = line.match(/^(.*\S)\s+(\d{1,8})$/);
    const bad = new ApiError(
      400,
      `Строка «${line.slice(0, 40)}»: ${kind === 'number' ? 'номер из 8 цифр' : 'юзернейм 4–24 символа'} и цена через пробел.`,
    );
    if (!match) throw bad;
    let value = match[1];
    if (kind === 'number') {
      value = value.replace(/\D/g, '');
      if (value.length === 11 && value.startsWith('888'))
        value = value.slice(3);
      if (!/^\d{8}$/.test(value)) throw bad;
    } else {
      value = value.replace(/^@/, '').toLowerCase();
      // Shorter names cannot be saved by the profile editor or opened by link.
      if (!/^[a-z0-9_]{4,24}$/.test(value) || reservedNames.includes(value))
        throw bad;
    }
    return { value, price: priceOf(Number(match[2])) };
  });
  if (new Set(lots.map((lot) => lot.value)).size !== lots.length)
    throw new ApiError(400, 'Лоты не должны повторяться.');
  return lots;
}
export async function issueLots(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  await requireAdministrator(me);
  const kind = kindOf(body.kind);
  if (kind === 'gift') throw new ApiError(400, 'Неизвестный тип лота');
  const requestId = text(body.requestId, 36),
    reason = text(body.reason, 500);
  if (!/^[a-f0-9-]{36}$/.test(requestId))
    throw new ApiError(400, 'Обновите форму и повторите.');
  if (typeof body.lots !== 'string' || body.lots.length > 4000)
    throw new ApiError(400, 'Проверьте список лотов.');
  const lots = parseLots(kind, body.lots);
  const d = db(),
    id = `admin:${me}:${requestId}`,
    payload = JSON.stringify({ kind, lots });
  const issued = async (repriced: string[] = []) => {
    const rows = await d
      .prepare(
        `SELECT assetId FROM market_listings WHERE id IN (SELECT ?1||':'||j.key FROM json_each(?2,'$.lots') j)`,
      )
      .bind(id, payload)
      .all<{ assetId: string }>();
    const created = rows.results.map((row) => row.assetId);
    return {
      ok: true,
      created,
      repriced,
      skipped: lots
        .map((l) => l.value)
        .filter((v) => !created.includes(v) && !repriced.includes(v)),
    };
  };
  const old = await d
    .prepare('SELECT action,reason,payload FROM admin_events WHERE id=?')
    .bind(id)
    .first<{ action: string; reason: string; payload: string }>();
  if (old) {
    if (
      old.action !== 'marketIssue' ||
      old.reason !== reason ||
      old.payload !== payload
    )
      throw new ApiError(409, 'Этот запрос уже использован.');
    return issued();
  }
  await rateLimit('market-issue', me, 10, 60);
  // A value that Noct Market already sells gets the new price instead of a second lot.
  // Read only for the report; the UPDATE below re-checks everything itself.
  const selling = await d
    .prepare(
      `SELECT l.assetId,l.price FROM market_listings l WHERE l.kind=?1 AND l.status='active' AND l.sellerId IS NULL
      AND l.assetId IN (SELECT json_extract(j.value,'$.value') FROM json_each(?2,'$.lots') j)`,
    )
    .bind(kind, payload)
    .all<{ assetId: string; price: number }>();
  const repriced = selling.results
    .filter(
      (row) => lots.find((l) => l.value === row.assetId)?.price !== row.price,
    )
    .map((row) => row.assetId);
  // The audit event owns the batch: lots exist only if their event committed.
  const audited = `EXISTS(SELECT 1 FROM admin_events e WHERE e.id=?1 AND e.payload=?2)`;
  await d.batch([
    d
      .prepare(
        `INSERT INTO admin_events(id,actorId,targetId,action,amount,reason,payload,created)
      SELECT ?1,?2,?2,'marketIssue',?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM administrators a JOIN users u ON u.id=a.userId
        WHERE a.userId=?2 AND u.kind='person' AND ${visibleAccount('u')} AND ${unrestricted('u')})
      ON CONFLICT(id) DO NOTHING`,
      )
      .bind(id, me, lots.length, reason, payload, now),
    ...(kind === 'number'
      ? [
          d
            .prepare(
              `INSERT OR IGNORE INTO market_numbers(number,created)
            SELECT json_extract(j.value,'$.value'),?3 FROM json_each(?2,'$.lots') j WHERE ${audited}`,
            )
            .bind(id, payload, now),
        ]
      : []),
    d
      .prepare(
        // A buyer who saw the old price is refused by the expectedPrice check.
        `UPDATE market_listings SET price=(SELECT json_extract(j.value,'$.price') FROM json_each(?2,'$.lots') j
          WHERE json_extract(j.value,'$.value')=market_listings.assetId)
      WHERE kind=?3 AND status='active' AND sellerId IS NULL AND ${audited}
        AND assetId IN (SELECT json_extract(j.value,'$.value') FROM json_each(?2,'$.lots') j)`,
      )
      .bind(id, payload, kind),
    d
      .prepare(
        `INSERT OR IGNORE INTO market_listings(id,kind,assetId,sellerId,price,created)
      SELECT ?1||':'||j.key,?4,json_extract(j.value,'$.value'),NULL,json_extract(j.value,'$.price'),?3
      FROM json_each(?2,'$.lots') j WHERE ${audited}
        AND CASE ?4 WHEN 'number'
          THEN EXISTS(SELECT 1 FROM market_numbers n WHERE n.number=json_extract(j.value,'$.value') AND n.ownerId IS NULL)
          ELSE NOT EXISTS(SELECT 1 FROM handles h WHERE h.handle=json_extract(j.value,'$.value')) END`,
      )
      .bind(id, payload, now, kind),
  ]);
  if (
    !(await d
      .prepare('SELECT id FROM admin_events WHERE id=?')
      .bind(id)
      .first())
  )
    throw new ApiError(403, 'Права или аккаунт изменились.');
  return issued(repriced);
}

type ListingRow = {
  id: string;
  assetId: string;
  price: number;
  status: string;
  closed: number;
};
type GiftRow = {
  family: string;
  number: number;
  attributes: string;
  listingId: string | null;
  price: number | null;
};
export async function catalog(s: URLSearchParams): Promise<MarketCatalog> {
  const kind = kindOf(s.get('kind')),
    status = s.get('status') || 'all',
    sort = s.get('sort') || 'recent',
    offset = Math.min(Math.max(Number(s.get('offset')) || 0, 0), 5000);
  let q = (s.get('q') || '').trim().toLowerCase().slice(0, 40);
  const d = db();
  const counted = await d
    .prepare(
      `SELECT l.kind,COUNT(*) AS n FROM market_listings l WHERE l.status='active' AND ${sellerVisible} AND ${sellerOwns} GROUP BY l.kind`,
    )
    .all<{ kind: MarketKind; n: number }>();
  const counts = { number: 0, username: 0, gift: 0 };
  for (const row of counted.results) counts[row.kind] = row.n;
  if (kind !== 'gift') {
    q =
      kind === 'number'
        ? q.replace(/^\+?888(?=[\s\d])/, '').replace(/\D/g, '')
        : q.replace(/[^a-z0-9_]/g, '');
    const order =
      sort === 'priceAsc'
        ? 'l.price ASC'
        : sort === 'priceDesc'
          ? 'l.price DESC'
          : 'MAX(l.created,l.closed) DESC';
    const rows = await d
      .prepare(
        `SELECT l.id,l.assetId,l.price,l.status,l.closed FROM market_listings l
      WHERE l.kind=?1 AND ${status === 'sale' ? "l.status='active'" : status === 'sold' ? "l.status='sold'" : "l.status IN('active','sold')"}
        AND (?2='' OR instr(l.assetId,?2)>0)
        AND (l.status<>'active' OR (${sellerVisible} AND ${sellerOwns}))
        AND (l.status<>'sold' OR NOT EXISTS(SELECT 1 FROM market_listings x WHERE x.kind=l.kind AND x.assetId=l.assetId
          AND x.status IN('active','sold') AND x.created>l.created))
      ORDER BY (l.status='active') DESC,${order},l.id LIMIT 26 OFFSET ?3`,
      )
      .bind(kind, q, offset)
      .all<ListingRow>();
    return {
      counts,
      more: rows.results.length > 25,
      rows: rows.results.slice(0, 25).map(
        (row): MarketRow => ({
          kind,
          key: row.assetId,
          title: titleOf(kind, row.assetId),
          status: row.status === 'active' ? 'sale' : 'sold',
          price: row.price,
          listingId: row.status === 'active' ? row.id : null,
          closed: row.closed,
        }),
      ),
    };
  }
  // Gifts are a showcase of every collectible; a listing only adds the price.
  // ponytail: full scan with json_extract per page; add generated columns + an index once collectibles pass ~50k.
  const family = (s.get('family') || '').slice(0, 100);
  const names = q.replace(/^#/, '');
  const matched = q
    ? [...GIFT_CATALOG, ...RETIRED_GIFTS]
        .filter((gift) => gift.name.toLowerCase().includes(names))
        .map((gift) => gift.id)
    : [];
  const base = `FROM gift_upgrades c JOIN received_gifts g ON g.id=c.receiptId JOIN users o ON o.id=g.recipient
    LEFT JOIN market_listings l ON l.kind='gift' AND l.assetId=g.id AND l.status='active' AND l.sellerId=g.recipient
    WHERE ${alive} AND ${visibleAccount('o')} AND (g.hidden=0 OR l.id IS NOT NULL)
      AND ${status === 'sale' ? 'l.id IS NOT NULL' : status === 'idle' ? 'l.id IS NULL' : '1'}
      AND (?1='' OR c.family IN (SELECT value FROM json_each(?2)) OR CAST(c.number AS TEXT)=?3)`;
  const baseArgs = [q, JSON.stringify(matched), names];
  const filters = ` AND (?4='' OR c.family=?4)
    AND (?5='' OR json_extract(c.attributes,'$.model.id')=?5)
    AND (?6='' OR json_extract(c.attributes,'$.backdrop.id')=?6)
    AND (?7='' OR json_extract(c.attributes,'$.symbol.id')=?7)`;
  const filterArgs = [
    family,
    ...['model', 'backdrop', 'symbol'].map((name) =>
      family ? (s.get(name) || '').slice(0, 100) : '',
    ),
  ];
  const order =
    sort === 'priceAsc'
      ? 'l.price IS NULL,l.price ASC'
      : sort === 'priceDesc'
        ? 'l.price IS NULL,l.price DESC'
        : 'COALESCE(l.created,0) DESC';
  const facet = (name: string) =>
    `SELECT '${name}' AS facet,json_extract(c.attributes,'$.${name}.id') AS id,json_extract(c.attributes,'$.${name}.name') AS name,
      json_extract(c.attributes,'$.${name}.rarityPermille') AS rarityPermille,COUNT(*) AS count ${base} AND c.family=?4 GROUP BY 2`;
  const [rows, families, attributes] = await d.batch<
    GiftRow & MarketFacet & { facet: 'model' | 'backdrop' | 'symbol' }
  >([
    d
      .prepare(
        `SELECT c.family,c.number,c.attributes,l.id AS listingId,l.price ${base}${filters}
        ORDER BY ${order},c.created DESC,c.receiptId LIMIT 26 OFFSET ?8`,
      )
      .bind(...baseArgs, ...filterArgs, offset),
    d
      .prepare(
        `SELECT c.family AS id,COUNT(*) AS count ${base} GROUP BY c.family ORDER BY count DESC`,
      )
      .bind(...baseArgs),
    ...(family
      ? [
          d
            .prepare(
              `${facet('model')} UNION ALL ${facet('backdrop')} UNION ALL ${facet('symbol')} ORDER BY count DESC`,
            )
            .bind(...baseArgs, family),
        ]
      : []),
  ]);
  const grouped: NonNullable<MarketCatalog['attributes']> = {
    model: [],
    backdrop: [],
    symbol: [],
  };
  for (const { facet: name, ...item } of attributes?.results || [])
    grouped[name].push(item);
  return {
    counts,
    more: rows.results.length > 25,
    rows: rows.results.slice(0, 25).map((row): MarketRow => {
      const gift = marketGift(row);
      return {
        kind,
        key: `${row.family}:${row.number}`,
        title: titleOf(kind, '', gift),
        status: row.listingId ? 'sale' : 'idle',
        price: row.price,
        listingId: row.listingId,
        closed: 0,
        gift,
      };
    }),
    families: families.results.map((row) => ({
      id: row.id,
      name: giftName(row.id),
      count: row.count,
    })),
    ...(family ? { attributes: grouped } : {}),
  };
}

export async function lot(me: string, s: URLSearchParams): Promise<MarketLot> {
  const kind = kindOf(s.get('kind')),
    key = text(s.get('key'), 140).toLowerCase();
  const d = db(),
    missing = new ApiError(404, 'Лот не найден');
  let assetId = key,
    ownerId: string | null = null,
    issued = 0,
    shown = true,
    gift: MarketGift | undefined;
  if (kind === 'number') {
    const row = await d
      .prepare(
        'SELECT ownerId,displayed,created FROM market_numbers WHERE number=?',
      )
      .bind(key)
      .first<{ ownerId: string | null; displayed: number; created: number }>();
    if (!row) throw missing;
    ownerId = row.ownerId;
    issued = row.created;
    shown = !!row.displayed;
  } else if (kind === 'username') {
    const row = await d
      .prepare(
        `SELECT (SELECT userId FROM handles WHERE handle=?1) AS ownerId,
        (SELECT MIN(created) FROM market_listings WHERE kind='username' AND assetId=?1) AS created`,
      )
      .bind(key)
      .first<{ ownerId: string | null; created: number | null }>();
    // Only names that have been on the market have a lot page.
    if (!row?.created) throw missing;
    ownerId = row.ownerId;
    issued = row.created;
  } else {
    const id = giftKey(key);
    const row = await d
      .prepare(
        `SELECT g.id,g.recipient,g.hidden,c.family,c.number,c.attributes,c.created FROM gift_upgrades c
        JOIN received_gifts g ON g.id=c.receiptId WHERE c.family=? AND c.number=? AND ${alive}`,
      )
      .bind(id.family, id.number)
      .first<{
        id: string;
        recipient: string;
        hidden: number;
        family: string;
        number: number;
        attributes: string;
        created: number;
      }>();
    if (!row) throw missing;
    assetId = row.id;
    ownerId = row.recipient;
    issued = row.created;
    shown = !row.hidden;
    gift = marketGift(row);
  }
  const listing = await d
    .prepare(
      `SELECT l.id,l.price,l.sellerId FROM market_listings l WHERE l.kind=? AND l.assetId=? AND l.status='active' AND ${sellerVisible} AND ${sellerOwns}`,
    )
    .bind(kind, assetId)
    .first<{ id: string; price: number; sellerId: string | null }>();
  // A hidden gift or an undisplayed number is public only while it is for sale.
  if (kind === 'gift' && !shown && !listing && ownerId !== me) throw missing;
  const owner =
    ownerId && (shown || listing || ownerId === me)
      ? await d
          .prepare(
            `SELECT ${personColumns('u')} FROM users u WHERE u.id=? AND ${visibleAccount('u')}`,
          )
          .bind(ownerId)
          .first<MarketPerson>()
      : null;
  if (kind === 'gift' && !owner) throw missing;
  const sales = await d
    .prepare(
      `SELECT l.price,l.closed,l.sellerId,
      s.id AS sId,s.name AS sName,s.avatar AS sAvatar,COALESCE((SELECT handle FROM handles WHERE userId=s.id AND main=1),'') AS sHandle,
      b.id AS bId,b.name AS bName,b.avatar AS bAvatar,COALESCE((SELECT handle FROM handles WHERE userId=b.id AND main=1),'') AS bHandle
      FROM market_listings l LEFT JOIN users s ON s.id=l.sellerId AND ${visibleAccount('s')}
      LEFT JOIN users b ON b.id=l.buyerId AND ${visibleAccount('b')}
      WHERE l.kind=? AND l.assetId=? AND l.status='sold' ORDER BY l.closed DESC,l.id LIMIT 20`,
    )
    .bind(kind, assetId)
    .all<Record<string, string | number | null>>();
  const person = (row: Record<string, unknown>, p: string) =>
    row[p + 'Id']
      ? ({
          id: row[p + 'Id'],
          name: row[p + 'Name'],
          avatar: row[p + 'Avatar'],
          handle: row[p + 'Handle'],
        } as MarketPerson)
      : null;
  return {
    kind,
    key,
    title: titleOf(kind, key, gift),
    issued,
    owner,
    mine: ownerId === me,
    listing: listing
      ? { id: listing.id, price: listing.price, system: !listing.sellerId }
      : null,
    history: sales.results.map((row) => ({
      seller: person(row, 's'),
      buyer: person(row, 'b'),
      system: !row.sellerId,
      price: Number(row.price),
      closed: Number(row.closed),
    })),
    ...(gift ? { gift } : {}),
  };
}

export async function assets(me: string): Promise<MarketAssets> {
  const d = db();
  type Row = {
    key: string;
    main: number;
    displayed: number;
    listingId: string | null;
    price: number | null;
    family: string;
    number: number;
    attributes: string;
  };
  const [handles, numbers, gifts] = await d.batch<Row>([
    d
      .prepare(
        `SELECT h.handle AS key,h.main,l.id AS listingId,l.price FROM handles h
        LEFT JOIN market_listings l ON l.kind='username' AND l.assetId=h.handle AND l.status='active' AND l.sellerId=h.userId
        WHERE h.userId=? ORDER BY h.main DESC,h.handle`,
      )
      .bind(me),
    d
      .prepare(
        `SELECT n.number AS key,n.displayed,l.id AS listingId,l.price FROM market_numbers n
        LEFT JOIN market_listings l ON l.kind='number' AND l.assetId=n.number AND l.status='active' AND l.sellerId=n.ownerId
        WHERE n.ownerId=? ORDER BY n.created DESC,n.number`,
      )
      .bind(me),
    // ponytail: first 100 collectibles only; paginate when someone owns more.
    d
      .prepare(
        `SELECT c.family,c.number,c.attributes,l.id AS listingId,l.price FROM gift_upgrades c JOIN received_gifts g ON g.id=c.receiptId
        LEFT JOIN market_listings l ON l.kind='gift' AND l.assetId=g.id AND l.status='active' AND l.sellerId=g.recipient
        WHERE g.recipient=? AND ${alive} ORDER BY c.created DESC,c.receiptId LIMIT 100`,
      )
      .bind(me),
  ]);
  const listing = (row: Row) =>
    row.listingId ? { id: row.listingId, price: Number(row.price) } : null;
  return {
    balance: await balance(me),
    assets: [
      ...handles.results.map(
        (row): MarketAsset => ({
          kind: 'username',
          key: row.key,
          title: titleOf('username', row.key),
          main: !!row.main,
          listing: listing(row),
        }),
      ),
      ...numbers.results.map(
        (row): MarketAsset => ({
          kind: 'number',
          key: row.key,
          title: titleOf('number', row.key),
          displayed: !!row.displayed,
          listing: listing(row),
        }),
      ),
      ...gifts.results.map((row): MarketAsset => {
        const gift = marketGift(row);
        return {
          kind: 'gift',
          key: `${row.family}:${row.number}`,
          title: titleOf('gift', '', gift),
          listing: listing(row),
          gift,
        };
      }),
    ],
  };
}
