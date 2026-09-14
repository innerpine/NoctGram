import { appearanceColumns } from '@/lib/premium-access';
import { assertUnqueuedPublicWrite } from './antispam';
import { assertMediaRead, mediaPermission } from '@/lib/media-access';
import { db, clean, ApiError } from './server';
import {
  assertReadable,
  assertWritable,
  assertUploadAvailable,
  visibleAccount,
} from './account-access';
import { personalVisibility } from './privacy';
import { sqlNow, requireChannel } from './channel-access';
import {
  channelLevel,
  channelCanAct,
  boostChannelActive,
  boostPersonActive,
} from './boost-access';

function managesStory(actor: string) {
  return `(s.userId=${actor} OR (u.kind='channel' AND (${channelCanAct('u', actor, true)} OR (s.publisherId=${actor} AND ${channelCanAct('u', actor)}))))`;
}

function visibleStory() {
  return `s.deletedAt=0 AND s.expiresAt>${sqlNow} AND ${visibleAccount('u')} AND ${personalVisibility('u')}`;
}
// Moderator removals physically delete stories. Their original publication still
// consumes the rolling quota; UNION also keeps a retained row from counting twice.
function channelPublications() {
  return `(SELECT COUNT(*) FROM (
    SELECT id FROM stories WHERE userId=u.id AND created>${sqlNow}-86400000
    UNION SELECT targetId FROM content_removals WHERE authorId=u.id AND targetType='story'
      AND created>${sqlNow}-86400000 AND CAST(json_extract(snapshot,'$.created') AS INTEGER)>${sqlNow}-86400000
  ))`;
}
async function story(id: string, me: string) {
  const r = await db()
    .prepare(
      `WITH i AS(SELECT ? AS viewer) SELECT s.*,${managesStory('i.viewer')} AS canManage FROM stories s JOIN users u ON u.id=s.userId CROSS JOIN i WHERE s.id=? AND ${visibleStory()}`,
    )
    .bind(me, id, me)
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
      .prepare(`WITH i AS(SELECT ? AS viewer) SELECT s.*,u.name,u.avatar,u.kind,${appearanceColumns('u')},h.handle,up.type,up.name AS mediaName,
      ${managesStory('i.viewer')} AS canManage,
      EXISTS(SELECT 1 FROM story_views WHERE storyId=s.id AND userId=i.viewer) AS viewed,
      CASE WHEN ${managesStory('i.viewer')} THEN (SELECT COUNT(*) FROM story_views WHERE storyId=s.id AND userId<>s.userId) ELSE NULL END AS views
      FROM stories s JOIN users u ON u.id=s.userId JOIN handles h ON h.userId=u.id AND h.main=1
      LEFT JOIN uploads up ON up.id=s.mediaId CROSS JOIN i WHERE ${visibleStory()} AND (?='' OR s.userId=?)
      ORDER BY (s.userId=i.viewer) DESC,s.created DESC LIMIT 200`)
      .bind(me, me, s.get('id') || '', s.get('id') || '')
      .all();
    return Response.json(rows.results);
  }
  if (action === 'storyViewers') {
    const id = s.get('id') || '';
    const r = await story(id, me);
    if (!r.canManage)
      throw new ApiError(403, 'Просмотры доступны автору и команде канала');
    const rows = await db()
      .prepare(
        `SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle,v.created FROM story_views v JOIN users u ON u.id=v.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE v.storyId=? AND v.userId<>? AND ${visibleAccount('u')}
        AND EXISTS(SELECT 1 FROM stories s JOIN users u ON u.id=s.userId CROSS JOIN (SELECT ? AS viewer) i WHERE s.id=v.storyId AND ${visibleStory()} AND ${managesStory('i.viewer')})
        ORDER BY v.created DESC LIMIT 100`,
      )
      .bind(id, me, me, me)
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
    const target = b.channelId ? clean(b.channelId, 200, true) : me;
    if (target !== me) await requireChannel(target, me, 'publish');
    const text = clean(b.text || '', 500),
      mediaId = b.mediaId ? clean(b.mediaId, 200, true) : null;
    if (!text && !mediaId)
      throw new ApiError(400, 'Добавь фото, видео или текст');
    await assertUnqueuedPublicWrite(me, text, target);
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
        `WITH input AS(SELECT ? AS actor,? AS target,? AS mediaId) INSERT INTO stories(id,userId,publisherId,text,mediaId,background,created,expiresAt)
        SELECT ?,u.id,i.actor,?,?,?,?,? FROM input i JOIN users u ON u.id=i.target JOIN users a ON a.id=i.actor
        WHERE ${boostPersonActive('a')} AND (i.mediaId IS NULL OR EXISTS(SELECT 1 FROM uploads up WHERE up.id=i.mediaId AND up.userId=i.actor AND ${mediaPermission('up.id', 'i.actor')}))
        AND ((u.id=i.actor AND u.kind='person' AND (SELECT COUNT(*) FROM stories WHERE userId=u.id AND deletedAt=0 AND expiresAt>${sqlNow})<20)
        OR (${boostChannelActive('u')} AND ${channelCanAct('u', 'i.actor')} AND ${channelPublications()}<${channelLevel('u')}))`,
      )
      .bind(
        me,
        target,
        mediaId,
        id,
        text,
        mediaId,
        background,
        now,
        now + 86400000,
      )
      .run();
    if (!r.meta.changes)
      throw new ApiError(
        409,
        target === me
          ? 'Достигнут лимит 20 историй или публикация ограничена'
          : 'Лимит историй канала исчерпан или изменились его уровень и права. Каждый уровень даёт одну историю за 24 часа.',
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
    if (!r.canManage) throw new ApiError(403, 'Это чужая история');
    const deleted = await d
      .prepare(
        `WITH i AS(SELECT ? AS actor) UPDATE stories SET deletedAt=? WHERE id=? AND EXISTS(SELECT 1 FROM stories s JOIN users u ON u.id=s.userId CROSS JOIN i WHERE s.id=stories.id AND EXISTS(SELECT 1 FROM users a WHERE a.id=i.actor AND ${boostPersonActive('a')}) AND ${managesStory('i.actor')} AND (u.id=i.actor OR ${boostChannelActive('u')}))`,
      )
      .bind(me, Date.now(), id)
      .run();
    if (!deleted.meta.changes)
      throw new ApiError(403, 'Права в канале изменились');
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
