import { viewer, ApiError, failure } from '@/lib/server';
import { readJsonBody } from '@/lib/request-body';
import { rateLimit } from '@/lib/rate-limit';
import {
  deleteFolder,
  listFolders,
  reorderFolders,
  saveFolder,
} from '@/lib/chat-folders';

export const dynamic = 'force-dynamic';
const MAX_BODY = 16000;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  try {
    const me = await viewer();
    const params = new URL(req.url).searchParams;
    if (params.has('actor') && params.get('actor') !== me)
      throw new ApiError(401, 'Аккаунт изменился. Обновите страницу.');
    return Response.json(await listFolders(me), { headers });
  } catch (error) {
    return failure(error);
  }
}
// POST {action:'save', id?, ...folder} | {action:'delete', id} | {action:'reorder', ids}
export async function POST(req: Request) {
  let consumed = false;
  try {
    const origin = req.headers.get('origin');
    if (
      (origin && origin !== new URL(req.url).origin) ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new ApiError(403, 'Недопустимый источник запроса');
    if (Number(req.headers.get('content-length')) > MAX_BODY)
      throw new ApiError(413, 'Слишком большой запрос');
    consumed = true;
    const body = await readJsonBody(req, MAX_BODY);
    const me = await viewer();
    if (body.actor !== undefined && body.actor !== me)
      throw new ApiError(401, 'Аккаунт изменился. Обновите страницу.');
    await rateLimit('chat-folders', me, 60, 60);
    const result =
      body.action === 'save'
        ? await saveFolder(me, body)
        : body.action === 'delete'
          ? await deleteFolder(me, body.id)
          : body.action === 'reorder'
            ? await reorderFolders(me, body.ids)
            : null;
    if (!result) throw new ApiError(400, 'Неизвестное действие');
    return Response.json(result, { headers });
  } catch (error) {
    if (!consumed && Number(req.headers.get('content-length')) <= MAX_BODY)
      await readJsonBody(req, MAX_BODY).catch(() => {});
    return failure(error);
  }
}
