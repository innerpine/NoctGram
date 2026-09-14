import { db } from './storage';
import { ApiError } from './api-error';
import { requireAdministrator } from './administrator-access';
import { rateLimit } from './rate-limit';
import { ACCESS_HISTORY_MS } from './access-security';

const staff = (id: string) =>
  `(EXISTS(SELECT 1 FROM administrators WHERE userId=${id}) OR EXISTS(SELECT 1 FROM moderators WHERE userId=${id}))`;
const administratorAllowed = `EXISTS(SELECT 1 FROM administrators a JOIN users u ON u.id=a.userId
  WHERE a.userId=? AND u.deletedAt=0 AND u.onboardingComplete=1
  AND NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.userId=a.userId AND (r.expiresAt IS NULL OR r.expiresAt>strftime('%s','now')*1000)))`;
const protectedObservation = `EXISTS(SELECT 1 FROM access_observations shared JOIN users staffUser ON staffUser.id=shared.userId
  WHERE shared.kind=o.kind AND shared.valueHash=o.valueHash AND shared.lastSeen>=?
    AND staffUser.deletedAt=0 AND ${staff('staffUser.id')})`;
function text(value: unknown, maximum: number) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > maximum
  )
    throw new ApiError(400, 'Проверьте заполнение формы.');
  return value.trim();
}
export async function readAdminAccess(me: string, params: URLSearchParams) {
  await requireAdministrator(me);
  const q = (params.get('q') || '').trim().replace(/^@/, '').slice(0, 80);
  const target = params.get('target') || '';
  const cutoff = Date.now() - ACCESS_HISTORY_MS;
  const people = await db()
    .prepare(`SELECT u.id,u.name,u.avatar,h.handle,${staff('u.id')} AS protected
    FROM users u JOIN handles h ON h.userId=u.id AND h.main=1
    WHERE u.kind='person' AND u.deletedAt=0 AND u.onboardingComplete=1
    AND (?='' OR instr(lower(u.name),lower(?))>0 OR EXISTS(SELECT 1 FROM handles hh WHERE hh.userId=u.id AND instr(hh.handle,lower(?))>0))
    ORDER BY u.created DESC LIMIT 30`)
    .bind(q, q, q)
    .all();
  const observations = target
    ? await db()
        .prepare(`SELECT o.id,o.kind,o.label,o.firstSeen,o.lastSeen,
    (SELECT COUNT(*) FROM access_observations shared JOIN users u ON u.id=shared.userId WHERE shared.kind=o.kind AND shared.valueHash=o.valueHash AND shared.lastSeen>=? AND u.deletedAt=0) AS accounts,
    ${protectedObservation} AS protected
    FROM access_observations o WHERE o.userId=? AND o.lastSeen>=? ORDER BY o.lastSeen DESC LIMIT 40`)
        .bind(cutoff, cutoff, target, cutoff)
        .all()
    : { results: [] };
  const blocks = await db()
    .prepare(`SELECT b.id,b.targetId,b.reason,b.created,b.revokedAt,u.name,h.handle,a.name AS actorName,
    (SELECT json_group_array(json_object('kind',r.kind,'label',r.label)) FROM access_block_rules r WHERE r.blockId=b.id) AS rules
    FROM access_blocks b JOIN users u ON u.id=b.targetId JOIN users a ON a.id=b.actorId
    LEFT JOIN handles h ON h.userId=u.id AND h.main=1
    WHERE (?='' OR b.targetId=?)
    ORDER BY b.revokedAt=0 DESC,b.created DESC LIMIT 100`)
    .bind(target, target)
    .all<{ rules: string }>();
  return {
    people: people.results,
    observations: observations.results,
    blocks: blocks.results.map((block) => ({
      ...block,
      rules: JSON.parse(block.rules) as { kind: string; label: string }[],
    })),
  };
}

export async function blockAdminAccess(
  me: string,
  body: Record<string, unknown>,
) {
  await requireAdministrator(me);
  await rateLimit('admin-access', me, 20, 60);
  const target = text(body.target, 100),
    reason = text(body.reason, 500);
  const requestId = text(body.requestId, 36);
  if (
    !/^[a-f0-9-]{36}$/.test(requestId) ||
    !Array.isArray(body.observations) ||
    !body.observations.length ||
    body.observations.length > 12 ||
    body.observations.some(
      (id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id),
    )
  )
    throw new ApiError(400, 'Выберите от 1 до 12 IP или устройств.');
  const ids = [...new Set(body.observations as string[])].sort();
  const id = `access:${me}:${requestId}`,
    now = Date.now(),
    cutoff = now - ACCESS_HISTORY_MS;
  const fingerprint = JSON.stringify({ target, reason, observations: ids });
  const previous = await db()
    .prepare('SELECT request FROM access_blocks WHERE id=?')
    .bind(id)
    .first<{ request: string }>();
  if (previous) {
    if (previous.request !== fingerprint)
      throw new ApiError(409, 'Этот запрос уже использован.');
    return { ok: true, replayed: true };
  }
  const user = await db()
    .prepare(`SELECT id FROM users u WHERE id=? AND id<>? AND kind='person'
    AND deletedAt=0 AND NOT ${staff('u.id')}`)
    .bind(target, me)
    .first();
  if (!user)
    throw new ApiError(403, 'Нельзя блокировать свой аккаунт или сотрудника.');
  const placeholders = ids.map(() => '?').join(',');
  const valid = await db()
    .prepare(`SELECT o.id FROM access_observations o WHERE o.userId=?
    AND o.id IN (${placeholders}) AND o.lastSeen>=? AND NOT ${protectedObservation}`)
    .bind(target, ...ids, cutoff, cutoff)
    .all();
  if (valid.results.length !== ids.length)
    throw new ApiError(
      409,
      'Адрес или устройство устарели либо используются сотрудником. Обновите список.',
    );
  // Gate every observation, the actor's current role and the target in the same transaction.
  // Rules copy only server-observed identifiers; request bodies never supply IPs or device hashes.
  await db().batch([
    db()
      .prepare(`INSERT INTO access_blocks(id,targetId,actorId,reason,request,created)
      SELECT ?,?,?,?,?,? WHERE ${administratorAllowed}
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.id<>? AND u.kind='person' AND u.deletedAt=0 AND NOT ${staff('u.id')})
      AND (SELECT COUNT(*) FROM access_observations o WHERE o.userId=? AND o.id IN (${placeholders}) AND o.lastSeen>=? AND NOT ${protectedObservation})=?
      ON CONFLICT(id) DO NOTHING`)
      .bind(
        id,
        target,
        me,
        reason,
        fingerprint,
        now,
        me,
        target,
        me,
        target,
        ...ids,
        cutoff,
        cutoff,
        ids.length,
      ),
    db()
      .prepare(`INSERT OR IGNORE INTO access_block_rules(blockId,kind,valueHash,label)
      SELECT ?,o.kind,o.valueHash,o.label FROM access_observations o
      WHERE o.userId=? AND o.id IN (${placeholders}) AND EXISTS(SELECT 1 FROM access_blocks WHERE id=? AND request=?)`)
      .bind(id, target, ...ids, id, fingerprint),
  ]);
  const saved = await db()
    .prepare('SELECT request FROM access_blocks WHERE id=?')
    .bind(id)
    .first<{ request: string }>();
  if (saved?.request !== fingerprint)
    throw new ApiError(409, 'Доступ или сведения изменились. Обновите список.');
  return { ok: true };
}
export async function revokeAdminAccess(
  me: string,
  body: Record<string, unknown>,
) {
  await requireAdministrator(me);
  await rateLimit('admin-access', me, 20, 60);
  const id = text(body.id, 180);
  const row = await db()
    .prepare('SELECT id FROM access_blocks WHERE id=?')
    .bind(id)
    .first();
  if (!row) throw new ApiError(404, 'Блокировка не найдена.');
  await db()
    .prepare(
      `UPDATE access_blocks SET revokedAt=?,revokedBy=? WHERE id=? AND revokedAt=0 AND ${administratorAllowed}`,
    )
    .bind(Date.now(), me, id, me)
    .run();
  await requireAdministrator(me);
  return { ok: true };
}
