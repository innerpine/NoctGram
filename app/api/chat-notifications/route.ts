import { viewer, failure, ApiError } from '@/lib/server';
import { readJsonBody } from '@/lib/request-body';
import {
  readChatNotifications,
  saveChatNotifications,
} from '@/lib/chat-notifications';
export const dynamic = 'force-dynamic';
const reply = (data: unknown) =>
  Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: Request) {
  try {
    const me = await viewer(),
      params = new URL(req.url).searchParams;
    if (params.get('actor') !== me)
      throw new ApiError(401, 'Аккаунт изменился');
    return reply(await readChatNotifications(me, params.get('peer')));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    if (
      (req.headers.get('origin') &&
        req.headers.get('origin') !== new URL(req.url).origin) ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new ApiError(403, 'Недопустимый источник');
    const me = await viewer();
    return reply(
      await saveChatNotifications(me, await readJsonBody(req, 1024)),
    );
  } catch (error) {
    return failure(error);
  }
}
