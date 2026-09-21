import { db } from './storage';
import { clean } from './server';
import { ApiError } from './api-error';
import { isAdministrator, requireAdministrator } from './administrator-access';
import { adminGiftCatalog, grantCollectibleGifts } from './admin-gifts';
import { appearanceColumns } from './premium-access';
import { rateLimit } from './rate-limit';

export { isAdministrator } from './administrator-access';
export async function administrationGet(
  action: string,
  s: URLSearchParams,
  me: string,
) {
  if (action === 'adminGiftCatalog')
    return Response.json(await adminGiftCatalog(me, s.get('giftId') || ''), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  if (action !== 'administration') return null;
  await requireAdministrator(me);
  const q = (s.get('q') || '').trim().replace(/^@/, '').slice(0, 80);
  const rich = s.get('sort') === 'balance',
    offset = Math.min(Math.max(Number(s.get('offset')) || 0, 0), 100000);
  // ponytail: the rich list re-aggregates the whole ledger for every page; materialize balances when it gets slow.
  const people = await db()
    .prepare(`SELECT u.id,u.name,u.avatar,u.kind,${appearanceColumns('u')},h.handle,
    EXISTS(SELECT 1 FROM moderators WHERE userId=u.id) AS moderator,
    EXISTS(SELECT 1 FROM administrators WHERE userId=u.id) AS administrator,
    COALESCE((SELECT SUM(CASE WHEN recipient=u.id THEN amount ELSE -amount END) FROM star_transfers WHERE sender=u.id OR recipient=u.id),0) AS balance
    FROM users u JOIN handles h ON h.userId=u.id AND h.main=1 WHERE u.deletedAt=0 AND u.onboardingComplete=1
    AND (?='' OR instr(lower(u.name),lower(?))>0 OR EXISTS(SELECT 1 FROM handles hh WHERE hh.userId=u.id AND instr(hh.handle,lower(?))>0))
    ${rich ? "AND u.kind='person' ORDER BY balance DESC,u.id" : 'ORDER BY u.created DESC'} LIMIT 31 OFFSET ?`)
    .bind(q, q, q, rich ? offset : 0)
    .all();
  const events = await db()
    .prepare(`SELECT e.*,u.name,u.avatar,${appearanceColumns('u')},h.handle,a.name AS actorName
    FROM admin_events e JOIN users u ON u.id=e.targetId JOIN users a ON a.id=e.actorId
    LEFT JOIN handles h ON h.userId=u.id AND h.main=1 ORDER BY e.created DESC,e.id DESC LIMIT 40`)
    .all();
  return Response.json(
    {
      people: people.results.slice(0, 30),
      more: rich && people.results.length > 30,
      events: events.results,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
export async function administrationPost(
  action: string,
  b: Record<string, unknown>,
  me: string,
) {
  if (action === 'adminGiftGrant')
    return Response.json(await grantCollectibleGifts(me, b), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  if (action !== 'adminGrant') return null;
  await requireAdministrator(me);
  await rateLimit('admin-grant', me, 30, 60);
  const target = clean(b.target, 100, true),
    kind = clean(b.kind, 30, true),
    reason = clean(b.reason, 500, true);
  const requestId = clean(b.requestId, 36, true);
  if (!/^[a-f0-9-]{36}$/.test(requestId))
    throw new ApiError(400, 'Обновите форму и повторите.');
  if (
    !['stars', 'starsDebit', 'premium', 'verified', 'moderator'].includes(kind)
  )
    throw new ApiError(400, 'Неизвестное действие.');
  const amount = Number(b.amount),
    stars = kind === 'stars' || kind === 'starsDebit';
  if (
    !Number.isSafeInteger(amount) ||
    (stars
      ? amount < 1 || amount > 1000000
      : kind === 'premium'
        ? amount < 1 || amount > 365
        : amount !== 0 && amount !== 1)
  )
    throw new ApiError(
      400,
      stars
        ? 'От 1 до 1 000 000 Stars.'
        : kind === 'premium'
          ? 'От 1 до 365 дней.'
          : 'Проверьте значение.',
    );
  const user = await db()
    .prepare(
      'SELECT kind FROM users WHERE id=? AND deletedAt=0 AND onboardingComplete=1',
    )
    .bind(target)
    .first<{ kind: string }>();
  if (!user) throw new ApiError(404, 'Аккаунт не найден.');
  if ((stars || kind === 'premium') && user.kind !== 'person')
    throw new ApiError(
      400,
      'Stars и Premium выдаются личному аккаунту. Выберите владельца канала.',
    );
  if (
    kind === 'moderator' &&
    (user.kind !== 'person' || (await isAdministrator(target)))
  )
    throw new ApiError(
      400,
      'Роль модератора назначается личному аккаунту. Права администратора здесь не меняются.',
    );
  const id = `admin:${me}:${requestId}`,
    d = db(),
    now = Date.now(),
    start = Math.floor(now / 1000) * 1000;
  const old = await d
    .prepare('SELECT * FROM admin_events WHERE id=?')
    .bind(id)
    .first();
  if (old) {
    if (
      old.targetId !== target ||
      old.action !== kind ||
      old.amount !== amount ||
      old.reason !== reason
    )
      throw new ApiError(409, 'Этот запрос уже использован.');
    return Response.json({ ok: true, replayed: true });
  }
  // The event and grant commit together. The event is inserted last so retries never apply twice.
  const gate = `NOT EXISTS(SELECT 1 FROM admin_events WHERE id=?) AND EXISTS(SELECT 1 FROM administrators a JOIN users u ON u.id=a.userId WHERE a.userId=? AND u.deletedAt=0 AND u.onboardingComplete=1 AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=a.userId AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))) AND EXISTS(SELECT 1 FROM users WHERE id=? AND deletedAt=0)`;
  let grant: D1PreparedStatement;
  if (kind === 'stars')
    grant = d
      .prepare(
        `INSERT INTO star_transfers(id,sender,recipient,amount,kind,created) SELECT ?,NULL,?,?,'admin_grant',? WHERE ${gate}`,
      )
      .bind(id, target, amount, Date.now(), id, me, target);
  else if (kind === 'starsDebit')
    // The debit goes to the treasury and can never push a balance below zero.
    grant = d
      .prepare(
        `INSERT INTO star_transfers(id,sender,recipient,amount,kind,created) SELECT ?,?,'noctgram_gifts',?,'admin_debit',? WHERE ${gate}
        AND ? <= (SELECT COALESCE(SUM(CASE WHEN recipient=? THEN amount ELSE -amount END),0) FROM star_transfers WHERE recipient=? OR sender=?)`,
      )
      .bind(
        id,
        target,
        amount,
        Date.now(),
        id,
        me,
        target,
        amount,
        target,
        target,
        target,
      );
  else if (kind === 'premium')
    grant = d
      .prepare(`INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) SELECT ?,?,?, 'admin',? WHERE ${gate}
    ON CONFLICT(userId) DO UPDATE SET startsAt=MIN(startsAt,excluded.startsAt),expiresAt=MAX(CASE WHEN revokedAt=0 THEN expiresAt ELSE 0 END,excluded.startsAt)+?,revokedAt=0,source='admin'`)
      .bind(
        target,
        start,
        start + amount * 86400000,
        now,
        id,
        me,
        target,
        amount * 86400000,
      );
  else if (kind === 'verified')
    grant = d
      .prepare(`UPDATE users SET verified=? WHERE id=? AND ${gate}`)
      .bind(amount, target, id, me, target);
  else if (amount)
    grant = d
      .prepare(
        `INSERT OR IGNORE INTO moderators(userId,created) SELECT ?,? WHERE ${gate}`,
      )
      .bind(target, Date.now(), id, me, target);
  else
    grant = d
      .prepare(`DELETE FROM moderators WHERE userId=? AND ${gate}`)
      .bind(target, id, me, target);
  await d.batch([
    grant,
    d
      .prepare(
        // A debit that did not happen must not leave an audit record.
        `INSERT INTO admin_events(id,actorId,targetId,action,amount,reason,created) SELECT ?,?,?,?,?,?,? WHERE ${gate}${kind === 'starsDebit' ? " AND EXISTS(SELECT 1 FROM star_transfers WHERE id=? AND kind='admin_debit')" : ''}`,
      )
      .bind(
        id,
        me,
        target,
        kind,
        amount,
        reason,
        Date.now(),
        id,
        me,
        target,
        ...(kind === 'starsDebit' ? [id] : []),
      ),
  ]);
  const saved = await d
    .prepare('SELECT * FROM admin_events WHERE id=?')
    .bind(id)
    .first();
  if (!saved) {
    const left =
      kind === 'starsDebit' &&
      (await d
        .prepare(
          'SELECT COALESCE(SUM(CASE WHEN recipient=? THEN amount ELSE -amount END),0) AS balance FROM star_transfers WHERE recipient=? OR sender=?',
        )
        .bind(target, target, target)
        .first<{ balance: number }>());
    if (left && left.balance < amount)
      throw new ApiError(
        409,
        `На балансе только ${left.balance} Stars: столько списать нельзя.`,
      );
    throw new ApiError(409, 'Права или аккаунт изменились.');
  }
  if (
    saved.targetId !== target ||
    saved.action !== kind ||
    saved.amount !== amount ||
    saved.reason !== reason
  )
    throw new ApiError(409, 'Этот запрос уже использован.');
  return Response.json({ ok: true });
}
