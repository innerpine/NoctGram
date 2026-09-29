import { db, bucket } from './storage';
import { ApiError } from './api-error';
import { assertWritable, visibleAccount } from './account-access';
import { directMessageAllowed } from './privacy';
import { reserveUpload } from './upload-storage';
import { canSend } from './room-access';
import {
  CHAT_FILE_LIMIT,
  chatFileKind,
  normalizeChatType,
  validChatMedia,
  validRecording,
  type ChatAttachment,
  type ChatRecordingIntent,
} from './chat-files';

export type ChatUploadTarget = { peer: string } | { room: string };
// Voice and round video recordings keep their real media type and metadata.
export type ChatRecording = {
  intent: ChatRecordingIntent;
  duration: number;
  waveform: string;
};

function checkedFile(file: File) {
  if (!file.size || file.size > CHAT_FILE_LIMIT)
    throw new ApiError(400, 'Выберите файл до 25 МБ');
}
function storedName(file: File) {
  // File names cannot carry path separators or HTTP control characters.
  // eslint-disable-next-line no-control-regex
  return file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 200);
}
async function persist(
  me: string,
  file: File,
  bytes: Uint8Array,
  register: (id: string, kind: ChatAttachment['kind']) => D1PreparedStatement,
  recording?: ChatRecording,
): Promise<ChatAttachment> {
  const input = normalizeChatType(file.type);
  if (recording && !validRecording(recording.intent, input, bytes))
    throw new ApiError(
      400,
      recording.intent === 'voice'
        ? 'Голосовое сообщение повреждено или записано в неподдерживаемом формате'
        : 'Видеосообщение повреждено или записано в неподдерживаемом формате',
    );
  if (!recording && !validChatMedia(input, bytes))
    throw new ApiError(
      400,
      'Формат фото или видео не соответствует содержимому',
    );
  const kind = recording ? recording.intent : chatFileKind(input),
    type = kind === 'file' ? 'application/octet-stream' : input,
    name = storedName(file) || 'Файл',
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
      register(id, kind),
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
  return {
    id,
    type,
    name,
    size: file.size,
    kind,
    ...(recording
      ? { duration: recording.duration, waveform: recording.waveform }
      : {}),
  };
}

export async function storeChatUpload(
  me: string,
  peer: string,
  file: File,
  recording?: ChatRecording,
): Promise<ChatAttachment> {
  await assertWritable(me);
  if (!peer || peer.length > 100)
    throw new ApiError(400, 'Выбери собеседника');
  checkedFile(file);
  const access = await db()
    .prepare(`SELECT 1 FROM users s,users r WHERE s.id=? AND r.id=?
    AND s.kind='person' AND r.kind='person' AND ${visibleAccount('r')} AND ${directMessageAllowed}`)
    .bind(me, peer)
    .first();
  if (!access)
    throw new ApiError(403, 'Прикрепление файлов недоступно в этом диалоге');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return persist(
    me,
    file,
    bytes,
    (id, kind) =>
      db()
        .prepare(
          'INSERT INTO chat_uploads(uploadId,recipient,size,kind,duration,waveform) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          id,
          peer,
          file.size,
          kind,
          recording?.duration ?? 0,
          recording?.waveform ?? '',
        ),
    recording,
  );
}

// Drafts are scoped to one ordinary group; encrypted rooms never store files.
export async function storeRoomUpload(
  me: string,
  roomId: string,
  file: File,
  recording?: ChatRecording,
): Promise<ChatAttachment> {
  await assertWritable(me);
  if (!roomId || roomId.length > 100) throw new ApiError(400, 'Выберите чат');
  checkedFile(file);
  const access = await db()
    .prepare(
      `WITH input AS (SELECT ? AS actor) SELECT 1 FROM chat_rooms r,input i WHERE r.id=? AND r.kind='group' AND ${canSend('r', 'i.actor')}`,
    )
    .bind(me, roomId)
    .first();
  if (!access)
    throw new ApiError(403, 'Прикрепление файлов недоступно в этом чате');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return persist(
    me,
    file,
    bytes,
    (id, kind) =>
      db()
        .prepare(
          'INSERT INTO chat_room_uploads(uploadId,roomId,size,kind,duration,waveform) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          id,
          roomId,
          file.size,
          kind,
          recording?.duration ?? 0,
          recording?.waveform ?? '',
        ),
    recording,
  );
}

export async function discardChatUpload(me: string, id: string) {
  const removed = await db()
    .prepare(`UPDATE uploads SET state='deleting' WHERE id=? AND userId=?
    AND (EXISTS(SELECT 1 FROM chat_uploads c WHERE c.uploadId=uploads.id AND c.messageId IS NULL)
      OR EXISTS(SELECT 1 FROM chat_room_uploads c WHERE c.uploadId=uploads.id AND c.messageId IS NULL))
    AND NOT EXISTS(SELECT 1 FROM chat_media_refs ref WHERE ref.uploadId=uploads.id) RETURNING id`)
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
