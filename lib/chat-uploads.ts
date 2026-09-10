import { db, bucket } from './storage';
import { ApiError } from './api-error';
import { assertWritable, visibleAccount } from './account-access';
import { messageAllowed } from './privacy';
import { reserveUpload } from './upload-storage';
import {
  CHAT_FILE_LIMIT,
  chatFileKind,
  validChatMedia,
  type ChatAttachment,
} from './chat-files';

export async function storeChatUpload(
  me: string,
  peer: string,
  file: File,
): Promise<ChatAttachment> {
  await assertWritable(me);
  if (!peer || peer.length > 100 || peer === me)
    throw new ApiError(400, 'Выбери собеседника');
  if (!file.size || file.size > CHAT_FILE_LIMIT)
    throw new ApiError(400, 'Выберите файл до 25 МБ');
  const access = await db()
    .prepare(`SELECT 1 FROM users s,users r WHERE s.id=? AND r.id=?
    AND s.kind='person' AND r.kind='person' AND ${visibleAccount('r')} AND ${messageAllowed}`)
    .bind(me, peer)
    .first();
  if (!access)
    throw new ApiError(403, 'Прикрепление файлов недоступно в этом диалоге');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validChatMedia(file.type, bytes))
    throw new ApiError(
      400,
      'Формат фото или видео не соответствует содержимому',
    );
  const kind = chatFileKind(file.type),
    type = kind === 'file' ? 'application/octet-stream' : file.type,
    name =
      // File names cannot carry path separators or HTTP control characters.
      // eslint-disable-next-line no-control-regex
      file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 200) ||
      'Файл',
    id = crypto.randomUUID();
  await reserveUpload(id, me, file);
  try {
    await bucket(me).put(id, bytes, { httpMetadata: { contentType: type } });
    const stored = await db().batch([
      db()
        .prepare(
          "UPDATE uploads SET type=?,name=?,state='ready' WHERE id=? AND state='uploading'",
        )
        .bind(type, name, id),
      db()
        .prepare(
          'INSERT INTO chat_uploads(uploadId,recipient,size,kind) VALUES(?,?,?,?)',
        )
        .bind(id, peer, file.size, kind),
    ]);
    if (!stored[0].meta.changes)
      throw new ApiError(409, 'Загрузка прервана. Попробуйте ещё раз.');
  } catch (e) {
    await db()
      .prepare("UPDATE uploads SET state='deleting' WHERE id=?")
      .bind(id)
      .run();
    throw e;
  }
  return { id, type, name, size: file.size, kind };
}
export async function discardChatUpload(me: string, id: string) {
  const removed = await db()
    .prepare(`UPDATE uploads SET state='deleting' WHERE id=? AND userId=?
    AND EXISTS(SELECT 1 FROM chat_uploads c WHERE c.uploadId=uploads.id AND c.messageId IS NULL) RETURNING id`)
    .bind(id, me)
    .first<{ id: string }>();
  if (removed) {
    try {
      await bucket().delete(removed.id);
      await db()
        .prepare("DELETE FROM uploads WHERE id=? AND state='deleting'")
        .bind(removed.id)
        .run();
    } catch {
      // Keep the charged reservation so the storage job can retry a failed R2 deletion.
    }
  }
  return { ok: true };
}
