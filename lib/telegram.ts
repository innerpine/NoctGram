import { db } from './storage';
import { ApiError } from './api-error';
import { setting, randomToken, tokenHash } from './auth-session';
import { assertReadable, assertWritable } from './account-access';

const packages = [100, 150, 250, 350, 500, 750, 1000, 1500, 2500, 5000, 10000];
const dailyLimit = 50000;
const ttl = 10 * 60 * 1000;
const activeUser = `EXISTS(SELECT 1 FROM users u WHERE u.id=t.userId AND u.kind='person' AND u.onboardingComplete=1) AND NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.userId=t.userId AND (r.expiresAt IS NULL OR r.expiresAt>strftime('%s','now')*1000))`;
type Link = {
  id: string;
  userId: string;
  telegramId: string;
  telegramName: string;
  telegramUsername: string;
};
type Order = {
  id: string;
  requestKey: string;
  userId: string;
  telegramId: string;
  linkId: string;
  amount: number;
  status: string;
  created: number;
  expiresAt: number;
  creditedAt: number | null;
};
function configuration() {
  const botUsername = setting('NOCT_BOT_USERNAME');
  return {
    enabled:
      setting('NOCT_BOT_TEST_MODE') === '1' &&
      setting('NOCT_BOT_SECRET').length >= 32 &&
      /^[a-zA-Z][a-zA-Z0-9_]{1,28}bot$/i.test(botUsername),
    testMode: true,
    botUsername,
  };
}
function requireEnabled() {
  if (!configuration().enabled)
    throw new ApiError(503, 'Тестовое пополнение сейчас отключено');
}
function telegramId(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]{0,15}$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new ApiError(400, 'Некорректный Telegram аккаунт');
  return value;
}
function string(value: unknown, max: number) {
  if (typeof value !== 'string' || !value || value.length > max)
    throw new ApiError(400, 'Некорректный запрос');
  return value;
}
function receipt(order: Order) {
  return {
    id: order.id,
    amount: order.amount,
    status: order.status,
    expiresAt: order.expiresAt,
    created: order.created,
    creditedAt: order.creditedAt,
  };
}
async function state(me: string) {
  const d = db();
  return {
    ...configuration(),
    link: await d
      .prepare(
        'SELECT telegramId,telegramName,telegramUsername FROM telegram_links WHERE userId=?',
      )
      .bind(me)
      .first(),
    pending: await d
      .prepare(
        'SELECT id,telegramId,telegramName,telegramUsername,expiresAt FROM telegram_challenges WHERE userId=? AND expiresAt>? AND attempts<5',
      )
      .bind(me, Date.now())
      .first(),
  };
}
export async function telegramGet(action: string, me: string) {
  if (action !== 'telegram') return null;
  await assertReadable(me);
  return Response.json(await state(me), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function telegramPost(
  action: string,
  b: Record<string, unknown>,
  me: string,
) {
  if (
    ![
      'telegramLink',
      'telegramConfirm',
      'telegramCancel',
      'telegramUnlink',
    ].includes(action)
  )
    return null;
  const d = db();
  // Even a restricted account can revoke this connection and pending proof.
  if (action === 'telegramCancel' || action === 'telegramUnlink') {
    await d.batch([
      d.prepare('DELETE FROM telegram_challenges WHERE userId=?').bind(me),
      ...(action === 'telegramUnlink'
        ? [d.prepare('DELETE FROM telegram_links WHERE userId=?').bind(me)]
        : []),
    ]);
    return Response.json(await state(me));
  }
  requireEnabled();
  await assertWritable(me);
  if (action === 'telegramLink') {
    if (
      await d
        .prepare('SELECT id FROM telegram_links WHERE userId=?')
        .bind(me)
        .first()
    )
      throw new ApiError(409, 'Сначала отвяжи текущий Telegram аккаунт');
    const token = randomToken().slice(0, 32),
      now = Date.now();
    const changed = await d
      .prepare(`INSERT INTO telegram_challenges(id,userId,tokenHash,created,expiresAt) SELECT ?,id,?,?,? FROM users WHERE id=? AND kind='person' AND onboardingComplete=1
      ON CONFLICT(userId) DO UPDATE SET id=excluded.id,tokenHash=excluded.tokenHash,created=excluded.created,expiresAt=excluded.expiresAt,telegramId=NULL,telegramName=NULL,telegramUsername=NULL,codeHash=NULL,attempts=0 WHERE telegram_challenges.created<?`)
      .bind(
        crypto.randomUUID(),
        await tokenHash(token),
        now,
        now + ttl,
        me,
        now - 5000,
      )
      .run();
    if (!changed.meta.changes)
      throw new ApiError(429, 'Подожди несколько секунд перед новой привязкой');
    return Response.json({
      ...(await state(me)),
      url: `https://t.me/${configuration().botUsername}?start=link_${token}`,
    });
  }
  const id = string(b.id, 36),
    code = string(b.code, 8);
  if (!/^[0-9]{8}$/.test(code))
    throw new ApiError(400, 'Введи 8 цифр из личного чата с ботом');
  const hash = await tokenHash(id + ':' + code),
    now = Date.now();
  try {
    await d.batch([
      d
        .prepare(`INSERT INTO telegram_links(id,userId,telegramId,telegramName,telegramUsername,created)
        SELECT id,userId,telegramId,telegramName,telegramUsername,? FROM telegram_challenges t WHERE id=? AND userId=? AND telegramId IS NOT NULL AND codeHash=? AND attempts<5 AND expiresAt>? AND ${activeUser}
        ON CONFLICT(id) DO NOTHING`)
        .bind(now, id, me, hash, now),
      d
        .prepare(
          'UPDATE telegram_challenges SET attempts=attempts+1 WHERE id=? AND userId=? AND codeHash<>? AND attempts<5 AND expiresAt>?',
        )
        .bind(id, me, hash, now),
      d
        .prepare(
          'DELETE FROM telegram_challenges WHERE id=? AND userId=? AND EXISTS(SELECT 1 FROM telegram_links WHERE id=? AND userId=?)',
        )
        .bind(id, me, id, me),
    ]);
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint/.test(e.message))
      throw new ApiError(409, 'Этот Telegram уже привязан к другому аккаунту');
    throw e;
  }
  if (
    !(await d
      .prepare('SELECT id FROM telegram_links WHERE id=? AND userId=?')
      .bind(id, me)
      .first())
  )
    throw new ApiError(
      400,
      'Код не подходит или срок истёк. После пяти ошибок создай новую ссылку',
    );
  return Response.json(await state(me));
}
export async function authorizeBot(req: Request) {
  const secret = setting('NOCT_BOT_SECRET'),
    supplied = req.headers.get('authorization') || '';
  if (secret.length < 32 || supplied.length > 256)
    throw new ApiError(401, 'Unauthorized');
  // Compare fixed-size digests without leaking prefix matches.
  const [a, b] = await Promise.all([
    tokenHash('Bearer ' + secret),
    tokenHash(supplied),
  ]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff) throw new ApiError(401, 'Unauthorized');
  requireEnabled();
}
async function linked(id: string) {
  const row = await db()
    .prepare('SELECT * FROM telegram_links WHERE telegramId=?')
    .bind(id)
    .first<Link>();
  if (!row)
    throw new ApiError(409, 'Привяжи аккаунт: Noct Stars на сайте → Telegram');
  await assertWritable(row.userId);
  return row;
}
async function snapshot(link: Link) {
  const d = db();
  await d
    .prepare(`INSERT INTO star_transfers(id,recipient,amount,kind,created)
    SELECT 'grant:'||t.userId,t.userId,10000,'grant',? FROM telegram_links t WHERE t.id=? AND t.telegramId=? AND t.userId=? AND ${activeUser} ON CONFLICT DO NOTHING`)
    .bind(Date.now(), link.id, link.telegramId, link.userId)
    .run();
  // One authorized snapshot: an unlink cannot race independent balance/history reads.
  const row = await d
    .prepare(`SELECT u.name,h.handle,
    (SELECT COALESCE(SUM(CASE WHEN recipient=t.userId THEN amount ELSE -amount END),0) FROM star_transfers WHERE recipient=t.userId OR sender=t.userId) AS balance,
    (SELECT COALESCE(SUM(amount),0) FROM telegram_topups WHERE (userId=t.userId OR telegramId=t.telegramId) AND status='credited' AND creditedAt>?) AS usedToday,
    (SELECT json_group_array(json_object('id',id,'amount',amount,'creditedAt',creditedAt)) FROM(SELECT id,amount,creditedAt FROM telegram_topups WHERE userId=t.userId AND status='credited' ORDER BY creditedAt DESC,id DESC LIMIT 10)) AS history
    FROM telegram_links t JOIN users u ON u.id=t.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE t.id=? AND t.telegramId=? AND t.userId=? AND ${activeUser}`)
    .bind(Date.now() - 86400000, link.id, link.telegramId, link.userId)
    .first<{
      name: string;
      handle: string;
      balance: number;
      usedToday: number;
      history: string;
    }>();
  if (!row)
    throw new ApiError(
      409,
      'Привязка или доступ изменились. Открой бота заново',
    );
  return {
    linked: true,
    testMode: true,
    dailyLimit,
    packages,
    profile: { name: row.name, handle: row.handle },
    balance: row.balance,
    usedToday: row.usedToday,
    history: JSON.parse(row.history),
  };
}
export async function botAction(b: Record<string, unknown>) {
  const action = string(b.action, 30),
    d = db();
  if (action === 'health') return { ...configuration(), packages, dailyLimit };
  const id = telegramId(b.telegramId),
    now = Date.now();
  if (action === 'claim') {
    const token = string(b.token, 32),
      code = string(b.code, 8);
    if (!/^[a-f0-9]{32}$/.test(token) || !/^[0-9]{8}$/.test(code))
      throw new ApiError(400, 'Ссылка привязки недействительна');
    const hash = await tokenHash(token);
    const challenge = await d
      .prepare(
        'SELECT id FROM telegram_challenges WHERE tokenHash=? AND expiresAt>? AND attempts<5',
      )
      .bind(hash, now)
      .first<{ id: string }>();
    if (!challenge)
      throw new ApiError(
        410,
        'Ссылка истекла — создай новую в Noct Stars на сайте',
      );
    const codeHash = await tokenHash(challenge.id + ':' + code);
    const result = await d
      .prepare(
        `UPDATE telegram_challenges AS t SET telegramId=?,telegramName=?,telegramUsername=?,codeHash=? WHERE id=? AND tokenHash=? AND expiresAt>? AND attempts<5 AND (telegramId IS NULL OR (telegramId=? AND codeHash=?)) AND ${activeUser} AND NOT EXISTS(SELECT 1 FROM telegram_links WHERE telegramId=? OR userId=t.userId)`,
      )
      .bind(
        id,
        typeof b.name === 'string' ? b.name.slice(0, 120) : 'telegram',
        typeof b.username === 'string' ? b.username.slice(0, 32) : '',
        codeHash,
        challenge.id,
        hash,
        now,
        id,
        codeHash,
        id,
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        409,
        'Эта ссылка или Telegram уже используются. Создай новую привязку на сайте',
      );
    return { pending: true };
  }
  if (
    action === 'status' &&
    !(await d
      .prepare('SELECT id FROM telegram_links WHERE telegramId=?')
      .bind(id)
      .first())
  )
    return { linked: false, testMode: true };
  const link = await linked(id);
  if (action === 'status') return snapshot(link);
  if (action === 'order') {
    const key = string(b.key, 100);
    if (
      !/^[a-zA-Z0-9_-]+$/.test(key) ||
      typeof b.amount !== 'number' ||
      !packages.includes(b.amount)
    )
      throw new ApiError(400, 'Выбери пакет из меню');
    const existing = await d
      .prepare('SELECT * FROM telegram_topups WHERE requestKey=?')
      .bind(key)
      .first<Order>();
    if (existing) {
      if (
        existing.telegramId !== id ||
        existing.linkId !== link.id ||
        existing.amount !== b.amount
      )
        throw new ApiError(409, 'Запрос уже использован');
      return { order: receipt(existing) };
    }
    // Rate-limit quotes too, without trusting the in-memory bot process.
    const inserted = await d
      .prepare(`INSERT INTO telegram_topups(id,requestKey,userId,telegramId,linkId,amount,created,expiresAt)
      SELECT ?,?,?,?,?,?,?,? FROM telegram_links t WHERE t.id=? AND t.telegramId=? AND ${activeUser} AND (SELECT COUNT(*) FROM telegram_topups WHERE telegramId=? AND created>?)<10 ON CONFLICT(requestKey) DO NOTHING`)
      .bind(
        crypto.randomUUID(),
        key,
        link.userId,
        id,
        link.id,
        b.amount,
        now,
        now + ttl,
        link.id,
        id,
        id,
        now - 60000,
      )
      .run();
    const order = await d
      .prepare('SELECT * FROM telegram_topups WHERE requestKey=?')
      .bind(key)
      .first<Order>();
    if (!order)
      throw new ApiError(429, 'Слишком много запросов — подожди минуту');
    if (
      order.telegramId !== id ||
      order.linkId !== link.id ||
      order.amount !== b.amount
    )
      throw new ApiError(409, 'Запрос уже использован');
    return { order: receipt(order), created: !!inserted.meta.changes };
  }
  if (action !== 'credit') throw new ApiError(400, 'Неизвестное действие');
  const orderId = string(b.id, 36);
  // The amount comes only from the stored quote, never from a callback or browser.
  // D1 batch is a transaction: the ledger insert and receipt status commit together.
  await d.batch([
    d
      .prepare(`INSERT INTO star_transfers(id,recipient,amount,kind,created)
      SELECT 'telegram-test:'||t.id,t.userId,t.amount,'telegram_test',? FROM telegram_topups t
      WHERE t.id=? AND t.telegramId=? AND t.linkId=? AND t.status='pending' AND t.expiresAt>?
      AND EXISTS(SELECT 1 FROM telegram_links l WHERE l.id=t.linkId AND l.userId=t.userId AND l.telegramId=t.telegramId)
      AND ${activeUser}
      AND t.amount+(SELECT COALESCE(SUM(amount),0) FROM telegram_topups used WHERE (used.userId=t.userId OR used.telegramId=t.telegramId) AND used.status='credited' AND used.creditedAt>?)<=?
      ON CONFLICT(id) DO NOTHING`)
      .bind(now, orderId, id, link.id, now, now - 86400000, dailyLimit),
    d
      .prepare(
        `UPDATE telegram_topups SET status='credited',creditedAt=(SELECT created FROM star_transfers WHERE id='telegram-test:'||telegram_topups.id) WHERE id=? AND telegramId=? AND status='pending' AND EXISTS(SELECT 1 FROM star_transfers WHERE id='telegram-test:'||telegram_topups.id)`,
      )
      .bind(orderId, id),
  ]);
  const order = await d
    .prepare(
      'SELECT * FROM telegram_topups WHERE id=? AND telegramId=? AND linkId=?',
    )
    .bind(orderId, id, link.id)
    .first<Order>();
  if (!order || order.status !== 'credited')
    throw new ApiError(
      409,
      'Пополнение недоступно: пакет истёк, привязка изменилась или достигнут лимит 50 000 за 24 часа',
    );
  return { order: receipt(order), ...(await snapshot(link)) };
}
