import { bucket, db, viewer, ApiError, failure } from '@/lib/server';
import { assertReadable, assertWritable } from '@/lib/account-access';
import { audioRange, MAX_MUSIC_AUDIO, musicAudioType } from '@/lib/music-audio';

type Params = { params: Promise<{ id: string }> };
type Audio = { objectKey: string; mime: string; size: number };
async function audioForm(req: Request) {
  if (!req.body) throw new ApiError(400, 'Выберите аудиофайл.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MUSIC_AUDIO + 16384) {
      await reader.cancel();
      throw new ApiError(413, 'Аудиофайл должен быть не больше 25 МБ.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new Response(bytes, {
    headers: { 'Content-Type': req.headers.get('content-type') || '' },
  }).formData();
}
export async function GET(req: Request, { params }: Params) {
  try {
    const me = await viewer();
    await assertReadable(me);
    const { id } = await params;
    const audio = await db()
      .prepare(
        'SELECT a.objectKey,a.mime,a.size FROM music_audio a JOIN music_library l ON l.userId=a.userId AND l.trackId=a.trackId WHERE a.userId=? AND a.trackId=?',
      )
      .bind(me, id)
      .first<Audio>();
    if (!audio) throw new ApiError(404, 'Аудиофайл не найден в вашей музыке.');
    const range = audioRange(req.headers.get('range'), audio.size);
    if (!range)
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${audio.size}`,
          'Cache-Control': 'private, no-store',
        },
      });
    const object = await bucket().get(
      audio.objectKey,
      range.partial
        ? { range: { offset: range.offset, length: range.length } }
        : undefined,
    );
    if (!object) throw new ApiError(404, 'Аудиофайл не найден.');
    const headers = new Headers({
      'Content-Type': audio.mime,
      'Content-Length': String(range.length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (range.partial)
      headers.set(
        'Content-Range',
        `bytes ${range.offset}-${range.offset + range.length - 1}/${audio.size}`,
      );
    return new Response(object.body, {
      status: range.partial ? 206 : 200,
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request, { params }: Params) {
  let pendingKey = '';
  try {
    if (
      (req.headers.get('origin') &&
        req.headers.get('origin') !== new URL(req.url).origin) ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new ApiError(403, 'Недопустимый источник');
    const me = await viewer();
    await assertWritable(me);
    const { id } = await params;
    const owned = await db()
      .prepare(
        "SELECT t.id FROM music_library l JOIN music_tracks t ON t.id=l.trackId WHERE l.userId=? AND t.id=? AND t.provider='spotify'",
      )
      .bind(me, id)
      .first();
    if (!owned)
      throw new ApiError(404, 'Сначала добавьте трек Spotify в свою музыку.');
    if (Number(req.headers.get('content-length')) > MAX_MUSIC_AUDIO + 16384)
      throw new ApiError(413, 'Аудиофайл должен быть не больше 25 МБ.');
    const form = await audioForm(req);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > MAX_MUSIC_AUDIO)
      throw new ApiError(400, 'Выберите аудиофайл размером до 25 МБ.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = musicAudioType(bytes);
    if (!mime)
      throw new ApiError(
        400,
        'Поддерживаются аудиофайлы MP3, WAV, OGG и FLAC.',
      );
    const previous = await db()
      .prepare('SELECT objectKey FROM music_audio WHERE userId=? AND trackId=?')
      .bind(me, id)
      .first<{ objectKey: string }>();
    pendingKey = 'music/' + crypto.randomUUID();
    await bucket().put(pendingKey, bytes, {
      httpMetadata: { contentType: mime },
    });
    const stored = await db()
      .prepare(`INSERT INTO music_audio(userId,trackId,objectKey,mime,size,created)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM music_library WHERE userId=? AND trackId=?)
      AND NOT EXISTS(SELECT 1 FROM account_restrictions WHERE userId=? AND (expiresAt IS NULL OR expiresAt>strftime('%s','now')*1000))
      ON CONFLICT(userId,trackId) DO UPDATE SET objectKey=excluded.objectKey,mime=excluded.mime,size=excluded.size,created=excluded.created WHERE music_audio.objectKey=? RETURNING objectKey`)
      .bind(
        me,
        id,
        pendingKey,
        mime,
        file.size,
        Date.now(),
        me,
        id,
        me,
        previous?.objectKey || '',
      )
      .first();
    if (!stored)
      throw new ApiError(
        409,
        'Трек уже изменился. Обновите музыку и попробуйте ещё раз.',
      );
    pendingKey = '';
    if (previous) await bucket().delete(previous.objectKey);
    return Response.json(
      { audioUrl: '/api/music/audio/' + id },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    if (pendingKey)
      await bucket()
        .delete(pendingKey)
        .catch(() => {});
    return failure(error);
  }
}
