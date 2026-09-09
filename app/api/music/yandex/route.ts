import { viewer, failure, ApiError } from '@/lib/server';
import { assertReadable, assertWritable } from '@/lib/account-access';
import { readJsonBody } from '@/lib/request-body';
import {
  connectYandex,
  checkYandexAccess,
  disconnectYandex,
  syncYandex,
  yandexPlaylists,
  yandexStatus,
  yandexTracks,
} from '@/lib/yandex-music';
export const dynamic = 'force-dynamic';
function privateResponse(response: Response) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
export async function GET(req: Request) {
  try {
    const user = await viewer();
    await assertReadable(user);
    const query = new URL(req.url).searchParams;
    if (query.get('action') === 'check')
      return privateResponse(Response.json(await checkYandexAccess(user)));
    const id = query.get('playlist');
    return privateResponse(
      Response.json(
        id
          ? await yandexTracks(user, id)
          : {
              status: await yandexStatus(user),
              items: await yandexPlaylists(user),
            },
      ),
    );
  } catch (error) {
    return privateResponse(failure(error));
  }
}
export async function POST(req: Request) {
  try {
    if (
      req.headers.get('origin') !== new URL(req.url).origin ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new ApiError(403, 'Недопустимый источник запроса.');
    if (!req.headers.get('content-type')?.startsWith('application/json'))
      throw new ApiError(415, 'Ожидается JSON.');
    const body = await readJsonBody(req, 8192),
      user = await viewer();
    await assertReadable(user);
    if (body.action === 'disconnect')
      return privateResponse(Response.json(await disconnectYandex(user)));
    await assertWritable(user);
    if (body.action === 'connect')
      return privateResponse(
        Response.json(await connectYandex(user, body.token)),
      );
    if (body.action === 'sync')
      return privateResponse(Response.json(await syncYandex(user)));
    throw new ApiError(400, 'Неизвестное действие.');
  } catch (error) {
    return privateResponse(failure(error));
  }
}
