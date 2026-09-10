import { db } from './storage';
import { ApiError } from './api-error';
import { assertReadable, visibleAccount } from './account-access';
import { messageVisible } from './chat-access';

export async function archiveDirectChat(
  me: string,
  body: Record<string, unknown>,
) {
  await assertReadable(me);
  if (body.actor !== undefined && body.actor !== me)
    throw new ApiError(401, 'Аккаунт изменился. Откройте чат снова.');
  if (typeof body.peer !== 'string' || typeof body.archived !== 'boolean')
    throw new ApiError(400, 'Некорректный запрос');
  const history = `EXISTS(SELECT 1 FROM users u WHERE u.id=? AND ${visibleAccount('u')}) AND EXISTS(SELECT 1 FROM messages m WHERE ((m.sender=? AND m.recipient=?) OR (m.sender=? AND m.recipient=?)) AND ${messageVisible('m', '?')})`;
  const d = db(),
    args = [me, me, body.peer, body.peer, me, me];
  if (
    !(await d
      .prepare(`SELECT 1 WHERE ${history}`)
      .bind(...args)
      .first())
  )
    throw new ApiError(404, 'Диалог недоступен');
  const result = await d
    .prepare(`INSERT INTO direct_chat_archives(userId,peerId,archivedAt) SELECT ?,?,? WHERE ${history}
    ON CONFLICT(userId,peerId) DO UPDATE SET archivedAt=excluded.archivedAt`)
    .bind(me, body.peer, body.archived ? Date.now() : 0, ...args)
    .run();
  if (!result.meta.changes) throw new ApiError(403, 'Диалог больше недоступен');
  return { ok: true };
}
