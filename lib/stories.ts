import { appearanceColumns } from '@/lib/premium-access';
import { assertMediaRead, mediaPermission } from '@/lib/media-access';
import { db, clean, ApiError } from './server';
import {
  assertReadable,
  assertWritable,
  assertUploadAvailable,
  visibleAccount,
} from './account-access';
import { personalVisibility } from './privacy';
import { sqlNow, activeActor } from './channel-access';

function visibleStory() {
  return `s.deletedAt=0 AND s.expiresAt>${sqlNow} AND ${visibleAccount('u')} AND ${personalVisibility('u')}`;
}
async function story(id: string, me: string) {
  const r = await db()
    .prepare(
      `SELECT s.* FROM stories s JOIN users u ON u.id=s.userId WHERE s.id=? AND ${visibleStory()}`,
    )
    .bind(id, me)
    .first();
  if (!r) throw new ApiError(404, 'История больше недоступна');
  return r;
}
export async function storiesGet(
  action: string,
  s: URLSearchParams,
  me: string,
): Promise<Response | null> {
  if (action === 'stories') {
    const rows = await db()
      .prepare(`SELECT s.*,u.name,u.avatar,${appearanceColumns('u')},h.handle,up.type,up.name AS mediaName,
      EXISTS(SELECT 1 FROM story_views WHERE storyId=s.id AND userId=?) AS viewed,
      CASE WHEN s.userId=? THEN (SELECT COUNT(*) FROM story_views WHERE storyId=s.id AND userId<>s.userId) ELSE NULL END AS views
      FROM stories s JOIN users u ON u.id=s.userId JOIN handles h ON h.userId=u.id AND h.main=1
      LEFT JOIN uploads up ON up.id=s.mediaId WHERE ${visibleStory()}
      ORDER BY (s.userId=?) DESC,s.created DESC LIMIT 200`)
      .bind(me, me, me, me)
      .all();
    return Response.json(rows.results);
  }
  if (action === 'storyViewers') {
    const id = s.get('id') || '';
    const r = await story(id, me);
    if (r.userId !== me) throw new ApiError(403, 'Просмотры доступны автору');
    const rows = await db()
      .prepare(
        `SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle,v.created FROM story_views v JOIN users u ON u.id=v.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE v.storyId=? AND v.userId<>? AND ${visibleAccount('u')} ORDER BY v.created DESC LIMIT 100`,
      )
      .bind(id, me)
      .all();
    return Response.json(rows.results);
  }
  return null;
}
export async function storiesPost(
  action: string,
  b: Record<string, unknown>,
  me: string,
): Promise<Response | null> {
  if (!['story', 'viewStory', 'deleteStory', 'reportStory'].includes(action))
    return null;
  await assertReadable(me);
  const d = db();
  if (action === 'story') {
    await assertWritable(me);
    const text = clean(b.text || '', 500),
      mediaId = b.mediaId ? clean(b.mediaId, 200, true) : null;
    if (!text && !mediaId)
      throw new ApiError(400, 'Добавь фото, видео или текст');
    if (mediaId) {
      const media = await d
        .prepare(
          "SELECT id FROM uploads WHERE id=? AND userId=? AND (type LIKE 'image/%' OR type LIKE 'video/%')",
        )
        .bind(mediaId, me)
        .first();
      if (!media) throw new ApiError(400, 'Файл не найден');
      await assertUploadAvailable(mediaId);
      await assertMediaRead(mediaId, me, me);
    }
    const background = clean(b.background || 'night', 20);
    if (!['night', 'violet', 'blue', 'ember'].includes(background))
      throw new ApiError(400, 'Выбери фон');
    const now = Date.now(),
      id = crypto.randomUUID();
    const r = await d
      .prepare(
        `WITH input AS(SELECT ? AS actor,? AS mediaId) INSERT INTO stories(id,userId,text,mediaId,background,created,expiresAt) SELECT ?,?,?,?,?,?,? FROM input i WHERE (i.mediaId IS NULL OR EXISTS(SELECT 1 FROM uploads up WHERE up.id=i.mediaId AND up.userId=i.actor AND ${mediaPermission('up.id', 'i.actor')})) AND ${activeActor()} AND (SELECT COUNT(*) FROM stories WHERE userId=? AND deletedAt=0 AND expiresAt>${sqlNow})<20`,
      )
      .bind(
        me,
        mediaId,
        id,
        me,
        text,
        mediaId,
        background,
        now,
        now + 86400000,
        me,
        me,
      )
      .run();
    if (!r.meta.changes)
      throw new ApiError(
        409,
        'Достигнут лимит 20 историй или публикация ограничена',
      );
    return Response.json({ ok: true, id });
  }
  const id = clean(b.id, 200, true),
    r = await story(id, me);
  if (action === 'viewStory') {
    await d
      .prepare(
        'INSERT OR IGNORE INTO story_views(storyId,userId,created) VALUES(?,?,?)',
      )
      .bind(id, me, Date.now())
      .run();
    return Response.json({ ok: true });
  }
  if (action === 'deleteStory') {
    await assertWritable(me);
    if (r.userId !== me) throw new ApiError(403, 'Это чужая история');
    await d
      .prepare('UPDATE stories SET deletedAt=? WHERE id=? AND userId=?')
      .bind(Date.now(), id, me)
      .run();
    return Response.json({ ok: true });
  }
  if (r.userId === me) throw new ApiError(400, 'Это ваша история');
  const reason = clean(b.reason, 500, true),
    now = Date.now();
  const inserted = await d
    .prepare(
      `INSERT OR IGNORE INTO content_reports(id,targetType,targetId,postId,userId,authorId,text,snapshot,reason,created,updated) SELECT ?,'story',?,'',?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM stories WHERE id=? AND deletedAt=0 AND expiresAt>${sqlNow})`,
    )
    .bind(
      crypto.randomUUID(),
      id,
      me,
      r.userId,
      r.text,
      JSON.stringify(r),
      reason,
      now,
      now,
      id,
    )
    .run();
  if (
    !inserted.meta.changes &&
    !(await d
      .prepare(
        "SELECT id FROM content_reports WHERE targetType='story' AND targetId=? AND userId=?",
      )
      .bind(id, me)
      .first())
  )
    throw new ApiError(404, 'История больше недоступна');
  return Response.json({ ok: true });
}
