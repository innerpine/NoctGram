import { viewer, ApiError, failure } from '@/lib/server';
import { readJsonBody } from '@/lib/request-body';
import { rateLimit } from '@/lib/rate-limit';
import {
  changeRoom,
  listRooms,
  readRoom,
  readRoomNotifications,
  saveRoomNotifications,
  resolveGroup,
  resolveRoomInvite,
  searchRooms,
} from '@/lib/rooms';

export const dynamic = 'force-dynamic';
const MAX_BODY = 48000;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  try {
    const me = await viewer();
    const params = new URL(req.url).searchParams;
    if (params.has('actor') && params.get('actor') !== me)
      throw new ApiError(401, 'Аккаунт изменился. Откройте чат снова.');
    const action = params.get('action') || 'list';
    let result;
    if (action === 'list')
      result = await listRooms(me, params.get('archived') === '1');
    else if (action === 'room')
      result = await readRoom(
        me,
        params.get('id') || '',
        params.get('before'),
        params.get('around'),
      );
    else if (action === 'notifications')
      result = await readRoomNotifications(me, params.get('id') || '');
    else if (action === 'search')
      result = await searchRooms(me, params.get('q') || '');
    else if (action === 'resolveGroup')
      result = await resolveGroup(me, params.get('username') || '');
    else if (action === 'resolveInvite')
      result = await resolveRoomInvite(me, params.get('token') || '');
    else throw new ApiError(404, 'Неизвестное действие');
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
}

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
      throw new ApiError(401, 'Аккаунт изменился. Откройте чат снова.');
    if (body.action === 'read') await rateLimit('room-read', me, 300, 60);
    else if (body.action === 'send')
      await rateLimit('room-message', me, 40, 60);
    else if (body.action === 'create')
      await rateLimit('room-create', me, 10, 3600);
    else await rateLimit('room-manage', me, 60, 60);
    return Response.json(
      body.action === 'notifications'
        ? await saveRoomNotifications(me, body)
        : await changeRoom(me, body),
      { headers },
    );
  } catch (error) {
    // Finish only bounded early-rejected payloads so local Worker connections
    // are not left holding a request body after an Origin/length rejection.
    if (!consumed && Number(req.headers.get('content-length')) <= MAX_BODY)
      await readJsonBody(req, MAX_BODY).catch(() => {});
    return failure(error);
  }
}
