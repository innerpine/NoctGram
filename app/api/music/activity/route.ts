import { viewer, failure, ApiError } from '@/lib/server';
import { assertReadable } from '@/lib/account-access';
import { readJsonBody } from '@/lib/request-body';
import {
  musicActivityEnabled,
  setMusicActivityEnabled,
  readMusicActivity,
  publishMusicActivity,
} from '@/lib/music-activity';

export const dynamic = 'force-dynamic';
const reply = (value: unknown) =>
  Response.json(value, { headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: Request) {
  try {
    const me = await viewer();
    await assertReadable(me);
    const params = new URL(req.url).searchParams;
    if (params.get('settings') === '1')
      return reply({ enabled: await musicActivityEnabled(me) });
    const id = params.get('id') || me;
    if (id.length > 200) throw new ApiError(400, 'Некорректный профиль');
    const now = Date.now();
    return reply({
      activity: await readMusicActivity(me, id, now),
      serverTime: now,
    });
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
    await assertReadable(me);
    const body = await readJsonBody(req, 8192);
    if (body.action === 'settings')
      return reply(await setMusicActivityEnabled(me, body.enabled));
    if (body.action !== 'publish')
      throw new ApiError(400, 'Неизвестное действие');
    return reply(await publishMusicActivity(me, body));
  } catch (error) {
    return failure(error);
  }
}
