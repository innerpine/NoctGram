import { db } from './storage';
import { ApiError } from './api-error';
import { assertReadable, visibleAccount } from './account-access';

const access = `actor.id=? AND peer.id=? AND actor.kind='person' AND peer.kind='person'
  AND actor.id<>peer.id AND ${visibleAccount('actor')} AND ${visibleAccount('peer')}`;
function peerId(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 100)
    throw new ApiError(400, 'Выбери собеседника');
  return value;
}
export async function readChatNotifications(me: string, value: unknown) {
  await assertReadable(me);
  const peer = peerId(value);
  const row = await db()
    .prepare(`SELECT COALESCE(prefs.muted,0) AS muted
    FROM users actor,users peer LEFT JOIN direct_chat_notifications prefs
      ON prefs.userId=? AND prefs.peerId=peer.id WHERE ${access}`)
    .bind(me, me, peer)
    .first<{ muted: number }>();
  if (!row) throw new ApiError(404, 'Диалог недоступен');
  return { peer, muted: !!row.muted };
}
export async function saveChatNotifications(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  if (body.actor !== me) throw new ApiError(401, 'Аккаунт изменился');
  if (typeof body.muted !== 'boolean')
    throw new ApiError(400, 'Выбери настройку уведомлений');
  const peer = peerId(body.peer);
  await readChatNotifications(me, peer);
  // Repeat access checks at commit. Repeated requests must not move the cutoff
  // or silence messages that arrived after notifications were already enabled.
  await db()
    .prepare(`INSERT INTO direct_chat_notifications(userId,peerId,muted,updated)
    SELECT actor.id,peer.id,?,? FROM users actor,users peer WHERE ${access}
      AND (?=1 OR EXISTS(SELECT 1 FROM direct_chat_notifications p WHERE p.userId=actor.id AND p.peerId=peer.id))
    ON CONFLICT(userId,peerId) DO UPDATE SET muted=excluded.muted,updated=MAX(direct_chat_notifications.updated,excluded.updated)
    WHERE direct_chat_notifications.muted<>excluded.muted`)
    .bind(body.muted ? 1 : 0, now, me, peer, body.muted ? 1 : 0)
    .run();
  return readChatNotifications(me, peer);
}
