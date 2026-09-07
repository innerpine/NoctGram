import { db, clean, ApiError } from './server';
import {
  assertPostVisible,
  assertWritable,
  requireModerator,
} from './account-access';

type TargetType = 'post' | 'comment';
function targetType(value: unknown): TargetType {
  if (value !== 'post' && value !== 'comment')
    throw new ApiError(400, 'Выберите пост или комментарий');
  return value;
}
function reportStatus(value: unknown) {
  if (value !== 'new' && value !== 'reviewing' && value !== 'closed')
    throw new ApiError(400, 'Выберите статус жалобы');
  return value;
}
async function content(type: TargetType, id: string) {
  return db()
    .prepare(
      type === 'post'
        ? 'SELECT p.*,u.ownerId FROM posts p JOIN users u ON u.id=p.userId WHERE p.id=?'
        : 'SELECT c.* FROM comments c WHERE c.id=?',
    )
    .bind(id)
    .first<{
      id: string;
      userId: string;
      postId?: string;
      ownerId?: string;
      text: string;
      media?: string;
    }>();
}
export async function contentModerationGet(
  action: string,
  s: URLSearchParams,
  me: string,
): Promise<Response | null> {
  if (!['moderationReports', 'moderationRemovals'].includes(action))
    return null;
  await requireModerator(me);
  const before = Number(s.get('before')) || Date.now() + 1;
  const beforeId = s.get('beforeId') || '';
  if (action === 'moderationRemovals') {
    const rows = await db()
      .prepare(`SELECT r.id,r.targetType,r.targetId,r.postId,r.authorId,r.text,r.reason,r.created,
      h.handle,mh.handle AS moderatorHandle FROM content_removals r
      LEFT JOIN handles h ON h.userId=r.authorId AND h.main=1
      LEFT JOIN handles mh ON mh.userId=r.moderatorId AND mh.main=1
      WHERE (r.created<? OR(r.created=? AND r.id<?)) ORDER BY r.created DESC,r.id DESC LIMIT 50`)
      .bind(before, before, beforeId)
      .all();
    return Response.json(rows.results);
  }
  const status = s.get('status') || 'all';
  if (status !== 'all') reportStatus(status);
  const rows = await db()
    .prepare(`SELECT r.*,u.name,u.kind,h.handle,rh.handle AS reporterHandle,mh.handle AS reviewerHandle,
    CASE WHEN r.targetType='post' THEN EXISTS(SELECT 1 FROM posts p WHERE p.id=r.targetId)
      WHEN r.targetType='message' THEN EXISTS(SELECT 1 FROM messages m WHERE m.id=r.targetId)
      ELSE EXISTS(SELECT 1 FROM comments c WHERE c.id=r.targetId) END AS available
    FROM content_reports r JOIN users u ON u.id=r.authorId
    LEFT JOIN handles h ON h.userId=u.id AND h.main=1
    LEFT JOIN handles rh ON rh.userId=r.userId AND rh.main=1
    LEFT JOIN handles mh ON mh.userId=r.reviewedBy AND mh.main=1
    WHERE (?='all' OR r.status=?) AND (r.created<? OR(r.created=? AND r.id<?))
    ORDER BY r.created DESC,r.id DESC LIMIT 50`)
    .bind(status, status, before, before, beforeId)
    .all();
  return Response.json(rows.results);
}
export async function contentModerationPost(
  action: string,
  b: Record<string, unknown>,
  me: string,
): Promise<Response | null> {
  if (
    !['report', 'reportComment', 'reviewReport', 'removeContent'].includes(
      action,
    )
  )
    return null;
  const d = db();
  if (action === 'report' || action === 'reportComment') {
    await assertWritable(me);
    const type = action === 'report' ? 'post' : 'comment';
    const id = clean(b.id, 200, true),
      reason = clean(b.reason, 500, true);
    const row = await content(type, id);
    if (!row) throw new ApiError(404, 'Контент больше недоступен');
    await assertPostVisible(type === 'post' ? id : row.postId!);
    if (row.userId === me || row.ownerId === me)
      throw new ApiError(400, 'Это ваш контент');
    const now = Date.now();
    // A duplicate cannot reopen a resolved report or replace its original evidence.
    const submitted = await d
      .prepare(`INSERT OR IGNORE INTO content_reports
      (id,targetType,targetId,postId,userId,authorId,text,snapshot,reason,created,updated)
      SELECT ?,?,?,?,?,?,?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM ${type === 'post' ? 'posts' : 'comments'} WHERE id=?)
        AND EXISTS(SELECT 1 FROM posts WHERE id=?)`)
      .bind(
        crypto.randomUUID(),
        type,
        id,
        type === 'post' ? id : row.postId!,
        me,
        row.userId,
        row.text,
        JSON.stringify(row),
        reason,
        now,
        now,
        id,
        type === 'post' ? id : row.postId!,
      )
      .run();
    if (
      !submitted.meta.changes &&
      !(await d
        .prepare(
          'SELECT id FROM content_reports WHERE targetType=? AND targetId=? AND userId=?',
        )
        .bind(type, id, me)
        .first())
    )
      throw new ApiError(404, 'Контент больше недоступен');
    return Response.json({ ok: true });
  }
  await requireModerator(me);
  if (action === 'reviewReport') {
    const id = clean(b.id, 200, true),
      status = reportStatus(b.status),
      expected = reportStatus(b.expectedStatus);
    const note = clean(b.note || '', 1000, status === 'closed');
    const r = await d
      .prepare(`UPDATE content_reports SET status=?,reviewedBy=?,reviewNote=?,updated=?
      WHERE id=? AND status=? AND status<>?`)
      .bind(status, me, note, Date.now(), id, expected, status)
      .run();
    if (!r.meta.changes)
      throw new ApiError(409, 'Жалоба уже изменена. Обновите список.');
    return Response.json({ ok: true });
  }
  const type = targetType(b.targetType),
    id = clean(b.id, 200, true),
    reason = clean(b.reason, 500, true);
  const row = await content(type, id);
  if (!row) throw new ApiError(409, 'Контент уже удалён. Обновите список.');
  const table = type === 'post' ? 'posts' : 'comments';
  const eventId = crypto.randomUUID(),
    now = Date.now(),
    postId = type === 'post' ? id : row.postId!;
  const statements = [
    d
      .prepare(`INSERT OR IGNORE INTO content_removals
    (id,targetType,targetId,postId,authorId,moderatorId,text,snapshot,reason,created)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=?)`)
      .bind(
        eventId,
        type,
        id,
        postId,
        row.userId,
        me,
        row.text,
        JSON.stringify(row),
        reason,
        now,
        id,
      ),
  ];
  if (type === 'post') {
    statements.push(
      d
        .prepare(`INSERT OR IGNORE INTO moderated_uploads(uploadId,removalId)
      SELECT up.id,? FROM posts p,json_each(p.media) m JOIN uploads up ON up.id=json_extract(m.value,'$.id')
      WHERE p.id=? AND EXISTS(SELECT 1 FROM content_removals WHERE id=?)`)
        .bind(eventId, id, eventId),
    );
  }
  statements.push(
    d
      .prepare(`UPDATE content_reports SET status='closed',reviewNote=?,reviewedBy=?,updated=?
    WHERE ${type === 'post' ? 'postId=?' : "targetType='comment' AND targetId=?"}
    AND status<>'closed' AND EXISTS(SELECT 1 FROM content_removals WHERE id=?)`)
      .bind(reason, me, now, id, eventId),
  );
  statements.push(
    d
      .prepare(
        `DELETE FROM ${table} WHERE id=? AND EXISTS(SELECT 1 FROM content_removals WHERE id=?)`,
      )
      .bind(id, eventId),
  );
  const result = await d.batch(statements);
  if (!result.at(-1)?.meta.changes)
    throw new ApiError(409, 'Контент уже удалён. Обновите список.');
  return Response.json({ ok: true });
}
