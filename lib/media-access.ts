import { animatedAvatarActive } from './premium-access';
import { db, ApiError } from './server';
import { published, channelPermission, sqlNow } from './channel-access';
import { visibleAccount } from './account-access';
import { messageVisible } from './chat-access';
export async function assertMediaRead(
  id: string,
  me: string,
  uploader: string,
) {
  const d = db(),
    url = '/api/media/' + id;
  const privateFile = await d
    .prepare('SELECT recipient,messageId FROM chat_uploads WHERE uploadId=?')
    .bind(id)
    .first<{ recipient: string; messageId: string | null }>();
  if (privateFile) {
    if (me === uploader && !privateFile.messageId) return;
    if (
      privateFile.messageId &&
      (await d
        .prepare(
          `SELECT 1 FROM messages m,json_each(m.media) j WHERE (m.sender=? OR m.recipient=?) AND ${messageVisible('m', '?')} AND json_extract(j.value,'$.id')=? LIMIT 1`,
        )
        .bind(me, me, me, id)
        .first())
    )
      return;
    throw new ApiError(404, 'Файл недоступен');
  }
  const publicRef = await d
    .prepare(`SELECT 1 FROM users u WHERE (u.avatar=? OR u.cover=?) AND ${visibleAccount('u')}
    UNION ALL SELECT 1 FROM profile_appearance pa JOIN users u ON u.id=pa.userId WHERE pa.avatarMotion=? AND ${animatedAvatarActive('u')} AND ${visibleAccount('u')}
    UNION ALL SELECT 1 FROM posts p JOIN users u ON u.id=p.userId WHERE ${published('p')} AND ${visibleAccount('u')}
      AND EXISTS(SELECT 1 FROM json_each(p.media) m WHERE json_extract(m.value,'$.id')=?)
    UNION ALL SELECT 1 FROM stories s JOIN users u ON u.id=s.userId WHERE s.mediaId=? AND s.deletedAt=0 AND s.expiresAt>${sqlNow} AND ${visibleAccount('u')} LIMIT 1`)
    .bind(url, url, url, id, id)
    .first();
  if (publicRef) return;
  const pending = await d
    .prepare(`SELECT 1 FROM posts p JOIN users u ON u.id=p.userId WHERE p.cancelledAt=0 AND p.publishAt>${sqlNow}
    AND ${channelPermission('u')} AND ${visibleAccount('u')} AND EXISTS(SELECT 1 FROM json_each(p.media) m WHERE json_extract(m.value,'$.id')=?) LIMIT 1`)
    .bind(me, me, me, id)
    .first();
  if (pending) return;
  if (uploader === me) {
    const scoped = await d
      .prepare(
        `SELECT 1 FROM posts p JOIN users u ON u.id=p.userId WHERE u.kind='channel' AND NOT (${published('p')}) AND EXISTS(SELECT 1 FROM json_each(p.media) m WHERE json_extract(m.value,'$.id')=?) LIMIT 1`,
      )
      .bind(id)
      .first();
    if (!scoped) return;
  }
  throw new ApiError(404, 'Файл пока недоступен или срок истории истёк');
}

// Only internal SQL expressions are accepted here. Keep the same access rule in
// content writes so revoking a channel editor cannot race an attachment check.
export function mediaPermission(idExpr: string, actorExpr: string) {
  // Keep both D1 limits: shallow expressions and at most five compound SELECTs.
  return `NOT EXISTS(SELECT 1 FROM chat_uploads cu WHERE cu.uploadId=${idExpr}) AND EXISTS(SELECT 1 FROM uploads live WHERE live.id=${idExpr} AND live.state='ready') AND NOT EXISTS(SELECT 1 FROM moderated_uploads mu WHERE mu.uploadId=${idExpr}) AND (EXISTS(
 SELECT 1 FROM users pu WHERE (pu.avatar='/api/media/'||${idExpr} OR pu.cover='/api/media/'||${idExpr}) AND ${visibleAccount('pu')}
 UNION SELECT 1 FROM profile_appearance ma JOIN users pu ON pu.id=ma.userId WHERE ma.avatarMotion='/api/media/'||${idExpr} AND ${visibleAccount('pu')} AND ${animatedAvatarActive('pu')}
 UNION SELECT 1 FROM posts mp JOIN users pu ON pu.id=mp.userId WHERE ${published('mp')} AND ${visibleAccount('pu')} AND EXISTS(SELECT 1 FROM json_each(mp.media) mm WHERE json_extract(mm.value,'$.id')=${idExpr})
 UNION SELECT 1 FROM stories ms JOIN users pu ON pu.id=ms.userId WHERE ms.mediaId=${idExpr} AND ms.deletedAt=0 AND ms.expiresAt>${sqlNow} AND ${visibleAccount('pu')}
 UNION SELECT 1 FROM posts mp JOIN users pu ON pu.id=mp.userId WHERE mp.cancelledAt=0 AND mp.publishAt>${sqlNow} AND ${visibleAccount('pu')} AND (pu.id=${actorExpr} OR pu.ownerId=${actorExpr} OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channelId=pu.id AND cm.userId=${actorExpr})) AND EXISTS(SELECT 1 FROM json_each(mp.media) mm WHERE json_extract(mm.value,'$.id')=${idExpr}))
 OR (EXISTS(SELECT 1 FROM uploads mu WHERE mu.id=${idExpr} AND mu.userId=${actorExpr}) AND NOT EXISTS(SELECT 1 FROM posts mp JOIN users pu ON pu.id=mp.userId WHERE pu.kind='channel' AND NOT (${published('mp')}) AND EXISTS(SELECT 1 FROM json_each(mp.media) mm WHERE json_extract(mm.value,'$.id')=${idExpr}))))`;
}
export function mediaAssignment(
  existing: string,
  incoming: string,
  actor: string,
) {
  return `(${incoming}='' OR ${incoming}=${existing} OR EXISTS(SELECT 1 FROM uploads up WHERE '/api/media/'||up.id=${incoming} AND up.userId=${actor} AND ${mediaPermission('up.id', actor)}))`;
}
