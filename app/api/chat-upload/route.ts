import { viewer, failure, ApiError } from '@/lib/server';
import { readJsonBody } from '@/lib/request-body';
import { CHAT_FILE_LIMIT } from '@/lib/chat-files';
import { storeChatUpload, discardChatUpload } from '@/lib/chat-uploads';

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
    const max = CHAT_FILE_LIMIT + 65536;
    if (Number(req.headers.get('content-length')) > max)
      throw new ApiError(413, 'Файл должен быть меньше 25 МБ');
    // Enforce the bound for chunked bodies too, before parsing multipart data.
    const reader = req.body?.getReader();
    if (!reader) throw new ApiError(400, 'Выбери файл');
    const parts: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) {
        await reader.cancel();
        throw new ApiError(413, 'Файл должен быть меньше 25 МБ');
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    let form: FormData;
    try {
      form = await new Response(bytes, {
        headers: { 'Content-Type': req.headers.get('content-type') || '' },
      }).formData();
    } catch {
      throw new ApiError(400, 'Некорректная загрузка файла');
    }
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
