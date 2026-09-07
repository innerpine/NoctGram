import { db, bucket } from './storage';
import { ApiError } from './api-error';
export const STORAGE_BYTES = 512 * 1024 * 1024;
export const STORAGE_FILES = 500;
// Unknown legacy sizes conservatively consume the former per-file maximum until HEAD fills them.
export const storageSize = 'CASE WHEN bytes>0 THEN bytes ELSE 26214400 END';
export async function storageUsage(me: string) {
  const row = await db()
    .prepare(
      `SELECT COUNT(*) AS files,COALESCE(SUM(${storageSize}),0) AS bytes FROM uploads WHERE userId=?`,
    )
    .bind(me)
    .first();
  return { ...row, limitBytes: STORAGE_BYTES, limitFiles: STORAGE_FILES };
}
export async function queueStorageDeletion(objectKey: string) {
  await db()
    .prepare(
      'INSERT OR IGNORE INTO storage_deletions(objectKey,created) VALUES(?,?)',
    )
    .bind(objectKey, Date.now())
    .run();
}
export async function reserveUpload(id: string, me: string, file: File) {
  const accepted = await db()
    .prepare(`INSERT INTO uploads(id,userId,type,name,bytes,state,created)
    SELECT ?,?,?,?,?,'uploading',? WHERE
    (SELECT COALESCE(SUM(${storageSize}),0) FROM uploads WHERE userId=?) + ? <= ?
    AND (SELECT COUNT(*) FROM uploads WHERE userId=?) < ?
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND deletedAt=0) RETURNING id`)
    .bind(
      id,
      me,
      file.type,
      file.name.slice(0, 200),
      file.size,
      Date.now(),
      me,
      file.size,
      STORAGE_BYTES,
      me,
      STORAGE_FILES,
      me,
    )
    .first();
  if (!accepted)
    throw new ApiError(
      413,
      'Хранилище заполнено: до 512 МБ и 500 вложений. Удалите ненужные публикации; очистка выполняется автоматически.',
      'STORAGE_QUOTA',
    );
}
// Keep evidence and dormant profile/scheduled-post references, independent of visibility.
export const uploadReferenced = (id: string) => `
  EXISTS(SELECT 1 FROM users WHERE avatar='/api/media/'||${id} OR cover='/api/media/'||${id})
  OR EXISTS(SELECT 1 FROM profile_appearance WHERE avatarMotion='/api/media/'||${id})
  OR EXISTS(SELECT 1 FROM posts p,json_each(p.media) m WHERE json_extract(m.value,'$.id')=${id})
  OR EXISTS(SELECT 1 FROM stories WHERE mediaId=${id})
  OR EXISTS(SELECT 1 FROM moderated_uploads WHERE uploadId=${id})
  OR EXISTS(SELECT 1 FROM content_reports r WHERE json_extract(r.snapshot,'$.mediaId')=${id} OR EXISTS(SELECT 1 FROM json_each(json_extract(r.snapshot,'$.media')) m WHERE json_extract(m.value,'$.id')=${id}))
  OR EXISTS(SELECT 1 FROM content_removals r WHERE json_extract(r.snapshot,'$.mediaId')=${id} OR EXISTS(SELECT 1 FROM json_each(json_extract(r.snapshot,'$.media')) m WHERE json_extract(m.value,'$.id')=${id}))`;
export async function cleanUploads() {
  const d = db();
  let removed = 0;
  const queued = await d
    .prepare(
      'SELECT objectKey FROM storage_deletions q WHERE q.created<? AND NOT EXISTS(SELECT 1 FROM music_audio a WHERE a.objectKey=q.objectKey) LIMIT 20',
    )
    .bind(Date.now() - 86400000)
    .all<{ objectKey: string }>();
  for (const item of queued.results) {
    try {
      await bucket().delete(item.objectKey);
      await d
        .prepare('DELETE FROM storage_deletions WHERE objectKey=?')
        .bind(item.objectKey)
        .run();
    } catch {
      /* Durable outbox, retried next time. */
    }
  }
  const unknown = await d
    .prepare("SELECT id FROM uploads WHERE bytes=0 AND state='ready' LIMIT 8")
    .all<{ id: string }>();
  for (const row of unknown.results) {
    try {
      const object = await bucket().head(row.id);
      if (object)
        await d
          .prepare('UPDATE uploads SET bytes=? WHERE id=? AND bytes=0')
          .bind(object.size, row.id)
          .run();
    } catch {
      /* One unavailable object must not stop cleanup of other files. */
    }
  }
  // Expired stories are retained for seven days; moderation evidence keeps its own snapshot.
  await d
    .prepare(
      `DELETE FROM stories WHERE id IN(SELECT s.id FROM stories s WHERE s.expiresAt<? AND NOT EXISTS(SELECT 1 FROM content_reports r WHERE r.targetType='story' AND r.targetId=s.id) AND NOT EXISTS(SELECT 1 FROM content_removals r WHERE r.targetType='story' AND r.targetId=s.id) LIMIT 20)`,
    )
    .bind(Date.now() - 7 * 86400000)
    .run();
  await d
    .prepare(
      `UPDATE uploads SET state='deleting' WHERE id IN(SELECT up.id FROM uploads up WHERE state IN ('ready','uploading') AND created<? AND NOT (${uploadReferenced('up.id')}) LIMIT 20)`,
    )
    .bind(Date.now() - 86400000)
    .run();
  const rows = await d
    .prepare("SELECT id FROM uploads WHERE state='deleting' LIMIT 20")
    .all<{ id: string }>();
  for (const row of rows.results) {
    // Database triggers reject any new attachment after the atomic deleting claim.
    try {
      await bucket().delete(row.id);
      await d
        .prepare("DELETE FROM uploads WHERE id=? AND state='deleting'")
        .bind(row.id)
        .run();
      removed++;
    } catch {
      /* Retry on the next job; the reservation remains charged. */
    }
  }
  await d.batch([
    d
      .prepare(
        'DELETE FROM auth_limits WHERE key IN(SELECT key FROM auth_limits WHERE expiresAt<? LIMIT 200)',
      )
      .bind(Date.now()),
    d
      .prepare('DELETE FROM account_challenges WHERE expiresAt<?')
      .bind(Date.now()),
    d.prepare('DELETE FROM recovery_codes WHERE expiresAt<?').bind(Date.now()),
  ]);
  return { removed };
}
