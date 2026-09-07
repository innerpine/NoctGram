import { db, clean, ApiError } from './server';
import {
  allowed,
  requireChannel,
  channelRights,
  channelPermission,
  writableTarget,
  sqlNow,
} from './channel-access';
import { assertAccountVisible } from './account-access';

export function scheduleTime(value: unknown, required = false) {
  if (!required && (value === undefined || value === 0 || value === null))
    return 0;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < Date.now() + 59000 ||
    Number(value) > Date.now() + 365 * 86400000
  )
    throw new ApiError(400, 'Выбери время от минуты до года вперёд');
  return Number(value);
}
export async function channelFeatureGet(
  action: string,
  s: URLSearchParams,
  me: string,
): Promise<Response | null> {
  if (!['channelTeam', 'scheduled'].includes(action)) return null;
  const id = s.get('id') || me;
  await requireChannel(id, me);
  const rights = await channelRights(id, me);
  if (action === 'channelTeam') {
    const rows = await db()
      .prepare(
        `SELECT u.id,u.name,u.avatar,h.handle,cm.role FROM channel_members cm JOIN users u ON u.id=cm.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE cm.channelId=? ORDER BY cm.created,u.id`,
      )
      .bind(id)
      .all();
    return Response.json({ members: rows.results, ...rights });
  }
  const rows = await db()
    .prepare(
      `SELECT p.*,h.handle AS publisherHandle FROM posts p LEFT JOIN handles h ON h.userId=p.publisherId AND h.main=1 WHERE p.userId=? AND p.publishAt>${sqlNow} AND (?=1 OR p.publisherId=?) ORDER BY p.publishAt,p.id LIMIT 100`,
    )
    .bind(id, rights.canManagePosts ? 1 : 0, me)
    .all();
  return Response.json(
    rows.results.map((p) => ({
      ...p,
      media: JSON.parse(String(p.media)),
      poll: JSON.parse(String(p.poll)),
    })),
  );
}
export async function channelFeaturePost(
  action: string,
  b: Record<string, unknown>,
  me: string,
): Promise<Response | null> {
  if (!['channelMember', 'reschedule', 'cancelScheduled'].includes(action))
    return null;
  const id = clean(b.id, 200, true),
    d = db();
  if (action === 'channelMember') {
    const channelId = clean(b.channelId, 200, true);
    await requireChannel(channelId, me, 'members');
    const channel = await d
      .prepare("SELECT ownerId FROM users WHERE id=? AND kind='channel'")
      .bind(channelId)
      .first();
    if (!channel || id === channel.ownerId)
      throw new ApiError(
        400,
        'Владелец канала не меняется через список администраторов',
      );
    if (b.role !== 'remove') await assertAccountVisible(id);
    if (
      !(await d
        .prepare("SELECT id FROM users WHERE id=? AND kind='person'")
        .bind(id)
        .first())
    )
      throw new ApiError(400, 'Выбери пользователя');
    if (!['admin', 'editor', 'remove'].includes(String(b.role)))
      throw new ApiError(400, 'Выбери роль');
    if (b.role === 'remove')
      await d.batch([
        d
          .prepare('DELETE FROM channel_members WHERE channelId=? AND userId=?')
          .bind(channelId, id),
        d
          .prepare(
            `UPDATE posts SET cancelledAt=? WHERE userId=? AND publisherId=? AND publishAt>${sqlNow} AND cancelledAt=0`,
          )
          .bind(Date.now(), channelId, id),
      ]);
    else
      await d
        .prepare(
          `INSERT INTO channel_members(channelId,userId,role,created) VALUES(?,?,?,?) ON CONFLICT(channelId,userId) DO UPDATE SET role=excluded.role`,
        )
        .bind(channelId, id, b.role, Date.now())
        .run();
    return Response.json({ ok: true });
  }
  const post = await d
    .prepare('SELECT userId,publisherId FROM posts WHERE id=?')
    .bind(id)
    .first<{ userId: string; publisherId: string }>();
  if (!post) throw new ApiError(404, 'Публикация не найдена');
  await requireChannel(post.userId, me);
  if (post.publisherId !== me && !(await allowed(post.userId, me, 'manage')))
    throw new ApiError(403, 'Редактор управляет только своей очередью');
  const at = action === 'reschedule' ? scheduleTime(b.publishAt, true) : 0;
  const result = await d
    .prepare(
      `UPDATE posts SET ${action === 'reschedule' ? 'publishAt=?,created=?' : 'cancelledAt=?'} WHERE id=? AND publishAt>${sqlNow} AND cancelledAt=0 AND EXISTS(SELECT 1 FROM users u WHERE u.id=posts.userId AND ((${channelPermission('u', 'publish')} AND posts.publisherId=?) OR ${channelPermission('u', 'manage')}) AND ${writableTarget('u')})`,
    )
    .bind(
      ...(action === 'reschedule' ? [at, at] : [Date.now()]),
      id,
      me,
      me,
      me,
      me,
      me,
      me,
      me,
      me,
    )
    .run();
  if (!result.meta.changes)
    throw new ApiError(409, 'Очередь уже изменилась. Обнови список.');
  return Response.json({ ok: true });
}
