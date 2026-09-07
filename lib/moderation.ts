import { db, profile, clean, ApiError } from './server';
import { restriction, requireModerator, isModerator } from './account-access';
import {
  contentModerationGet,
  contentModerationPost,
} from './content-moderation';
export async function moderationGet(
  action: string,
  s: URLSearchParams,
  me: string,
): Promise<Response | null> {
  const d = db();
  const contentResult = await contentModerationGet(action, s, me);
  if (contentResult) return contentResult;
  if (action === 'account') return Response.json(await profile(me, me));
  if (action === 'exportAccount') {
    const user = await profile(me, me);
    const queries = [
      [
        'posts',
        'SELECT p.* FROM posts p JOIN users u ON u.id=p.userId WHERE u.id=? OR u.ownerId=?',
        [me, me],
      ],
      ['comments', 'SELECT * FROM comments WHERE userId=?', [me]],
      [
        'messages',
        'SELECT * FROM messages WHERE sender=? OR recipient=?',
        [me, me],
      ],
      ['following', 'SELECT following FROM follows WHERE follower=?', [me]],
      [
        'uploads',
        'SELECT id,type,name,created FROM uploads WHERE userId=?',
        [me],
      ],
      [
        'stars',
        'SELECT * FROM star_transfers WHERE sender=? OR recipient=?',
        [me, me],
      ],
    ] as const;
    const data: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      profile: user,
      format: 'JSON: тексты и сведения о файлах; сами медиа не включены.',
    };
    for (const [key, sql, args] of queries)
      data[key] = (
        await d
          .prepare(sql)
          .bind(...args)
          .all()
      ).results;
    return Response.json(data, {
      headers: {
        'Content-Disposition': 'attachment; filename="noctgram-account.json"',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (
    ![
      'moderationUsers',
      'moderationAppeals',
      'moderationHistory',
      'moderationReports',
    ].includes(action)
  )
    return null;
  await requireModerator(me);
  if (action === 'moderationUsers') {
    const targetId = s.get('id');
    const q =
      '%' +
      (s.get('q') || '')
        .trim()
        .replace(/^@/, '')
        .slice(0, 100)
        .replace(/[\\%_]/g, '\\$&') +
      '%';
    // Resolve report authors by immutable ID; text search includes every handle.
    const predicate = targetId
      ? 'u.id=?'
      : "(u.name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM handles sh WHERE sh.userId=u.id AND sh.handle LIKE ? ESCAPE '\\')) AND u.id>?";
    const rows = (
      await d
        .prepare(
          `SELECT u.id,u.name,u.avatar,u.kind,u.ownerId,h.handle,
            ou.name AS ownerName,oh.handle AS ownerHandle,
            r.mode,r.reason,r.expiresAt,r.created AS restrictedAt,
            EXISTS(SELECT 1 FROM moderators m WHERE m.userId=u.id) AS moderator
          FROM users u
          JOIN handles h ON h.userId=u.id AND h.main=1
          LEFT JOIN users ou ON ou.id=u.ownerId
          LEFT JOIN handles oh ON oh.userId=ou.id AND oh.main=1
          LEFT JOIN account_restrictions r ON r.userId=u.id
            AND (r.expiresAt IS NULL OR r.expiresAt>?)
          WHERE ${predicate} ORDER BY u.id LIMIT 31`,
        )
        .bind(
          Date.now(),
          ...(targetId ? [targetId] : [q, q, s.get('after') || '']),
        )
        .all<{ id: string; kind: string; moderator: number }>()
    ).results.map((row) => ({
      ...row,
      canRestrict: row.id !== me && row.id !== 'noctgram' && !row.moderator,
    }));
    return Response.json({
      people: rows.slice(0, 30),
      hasMore: rows.length > 30,
      nextCursor: rows.length > 30 ? rows[29].id : null,
    });
  }
  if (action === 'moderationHistory')
    return Response.json(
      (
        await d
          .prepare(
            'SELECT e.*,h.handle AS moderatorHandle FROM moderation_events e LEFT JOIN handles h ON h.userId=e.moderatorId AND h.main=1 WHERE e.userId=? ORDER BY e.created DESC,e.id DESC LIMIT 30',
          )
          .bind(s.get('id') || '')
          .all()
      ).results,
    );
  return Response.json(
    (
      await d
        .prepare(
          "SELECT a.*,u.name,h.handle,e.mode,e.reason FROM moderation_appeals a JOIN users u ON u.id=a.userId JOIN handles h ON h.userId=u.id AND h.main=1 JOIN moderation_events e ON e.id=a.eventId ORDER BY (a.status='pending') DESC,a.created DESC LIMIT 50",
        )
        .all()
    ).results,
  );
}
export async function moderationPost(
  action: string,
  b: Record<string, unknown>,
  me: string,
): Promise<Response | null> {
  const d = db();
  const contentResult = await contentModerationPost(action, b, me);
  if (contentResult) return contentResult;
  if (action === 'appeal') {
    const r = await restriction(me);
    if (!r) throw new ApiError(400, 'Нет действующего ограничения');
    const text = clean(b.text, 2000, true);
    await d
      .prepare(
        'INSERT OR IGNORE INTO moderation_appeals(id,userId,eventId,text,created) VALUES(?,?,?,?,?)',
      )
      .bind(crypto.randomUUID(), me, r.eventId, text, Date.now())
      .run();
    return Response.json(await profile(me, me));
  }
  if (!['moderate', 'reviewAppeal'].includes(action)) return null;
  await requireModerator(me);
  if (action === 'reviewAppeal') {
    const id = clean(b.id, 100, true),
      note = clean(b.note, 1000, true);
    if (b.decision !== 'accepted' && b.decision !== 'dismissed')
      throw new ApiError(400, 'Выберите решение');
    const a = await d
      .prepare('SELECT * FROM moderation_appeals WHERE id=?')
      .bind(id)
      .first<{ userId: string; eventId: string; status: string }>();
    if (!a || a.status !== 'pending')
      throw new ApiError(409, 'Обращение уже рассмотрено или не найдено');
    if (a.userId === me || (await isModerator(a.userId)))
      throw new ApiError(403, 'Нельзя менять ограничения модератора');
    const now = Date.now(),
      eventId = crypto.randomUUID();
    const statements = [];
    if (b.decision === 'accepted') {
      // An appeal may lift only the decision it contests, never a newer restriction.
      statements.push(
        d
          .prepare(
            "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) SELECT ?,?,?,'active',?,? WHERE EXISTS(SELECT 1 FROM account_restrictions WHERE userId=? AND eventId=?) AND EXISTS(SELECT 1 FROM moderation_appeals WHERE id=? AND status='pending')",
          )
          .bind(eventId, a.userId, me, note, now, a.userId, a.eventId, id),
      );
      statements.push(
        d
          .prepare(
            'DELETE FROM account_restrictions WHERE userId=? AND eventId=? AND EXISTS(SELECT 1 FROM moderation_events WHERE id=?)',
          )
          .bind(a.userId, a.eventId, eventId),
      );
    }
    statements.push(
      d
        .prepare(
          "UPDATE moderation_appeals SET status=?,reviewNote=?,reviewedBy=?,reviewedAt=? WHERE id=? AND status='pending'",
        )
        .bind(b.decision, note, me, now, id),
    );
    const results = await d.batch(statements);
    if (!results.at(-1)?.meta.changes)
      throw new ApiError(409, 'Обращение уже рассмотрено');
    return Response.json({ ok: true });
  }
  const id = clean(b.id, 200, true),
    reason = clean(b.reason, 500, true),
    mode = b.mode;
  if (!['active', 'read_only', 'blocked'].includes(String(mode)))
    throw new ApiError(400, 'Выберите ограничение');
  if (id === me || id === 'noctgram' || (await isModerator(id)))
    throw new ApiError(403, 'Нельзя ограничить этот аккаунт');
  if (
    !(await d
      .prepare(
        "SELECT id FROM users WHERE id=? AND kind IN ('person','channel')",
      )
      .bind(id)
      .first())
  )
    throw new ApiError(404, 'Пользователь не найден');
  const minutes = b.minutes;
  if (
    minutes !== null &&
    (!Number.isInteger(minutes) ||
      Number(minutes) < 1 ||
      Number(minutes) > 525600)
  )
    throw new ApiError(400, 'Укажите срок до года или бессрочное ограничение');
  const now = Date.now(),
    until =
      mode === 'active' || minutes === null
        ? null
        : now + Number(minutes) * 60000,
    eventId = crypto.randomUUID();
  await d.batch([
    d
      .prepare(
        'INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,expiresAt,created) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(eventId, id, me, mode, reason, until, now),
    mode === 'active'
      ? d.prepare('DELETE FROM account_restrictions WHERE userId=?').bind(id)
      : d
          .prepare(
            'INSERT INTO account_restrictions(userId,eventId,mode,reason,expiresAt,created) VALUES(?,?,?,?,?,?) ON CONFLICT(userId) DO UPDATE SET eventId=excluded.eventId,mode=excluded.mode,reason=excluded.reason,expiresAt=excluded.expiresAt,created=excluded.created',
          )
          .bind(id, eventId, mode, reason, until, now),
  ]);
  return Response.json({ ok: true });
}
