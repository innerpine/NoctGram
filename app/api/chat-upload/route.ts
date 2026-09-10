import { viewer, failure, ApiError } from '@/lib/server';
import { readJsonBody } from '@/lib/request-body';
import { CHAT_FILE_LIMIT } from '@/lib/chat-files';
import { storeChatUpload, discardChatUpload } from '@/lib/chat-uploads';
import { assertWritable } from '@/lib/account-access';
import { rateLimit } from '@/lib/rate-limit';
import { readMultipart } from '@/lib/request-body';

function sameOrigin(req: Request) {
  if (
    (req.headers.get('origin') &&
      req.headers.get('origin') !== new URL(req.url).origin) ||
    req.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new ApiError(403, 'Недопустимый источник');
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const me = await viewer();
    await assertWritable(me);
    await rateLimit('uploads', me, 15, 60);
    const max = CHAT_FILE_LIMIT + 65536;
    if (Number(req.headers.get('content-length')) > max)
      throw new ApiError(413, 'Файл должен быть меньше 25 МБ');
    const form = await readMultipart(req, max, ['file', 'peer']);
    const file = form.get('file'),
      peer = form.get('peer');
    if (!(file instanceof File) || typeof peer !== 'string')
      throw new ApiError(400, 'Выбери файл и собеседника');
    return Response.json(await storeChatUpload(me, peer, file));
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    sameOrigin(req);
    const me = await viewer(),
      body = await readJsonBody(req, 1024);
    if (typeof body.id !== 'string' || body.id.length > 100)
      throw new ApiError(400, 'Некорректный файл');
    return Response.json(await discardChatUpload(me, body.id));
  } catch (e) {
    return failure(e);
  }
}
