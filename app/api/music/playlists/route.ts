import { viewer, failure, ApiError } from '@/lib/server';
import { assertReadable, assertWritable } from '@/lib/account-access';
import { readJsonBody } from '@/lib/request-body';
import {
  listPlaylists,
  readPlaylist,
  changePlaylist,
  trackPlaylists,
} from '@/lib/music-playlists';
export const dynamic = 'force-dynamic';
const reply = (data: unknown) =>
  Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: Request) {
  try {
    const me = await viewer();
    await assertReadable(me);
    const params = new URL(req.url).searchParams;
    const url = params.get('track');
    if (url !== null) return reply(await trackPlaylists(me, url));
    const id = params.get('id');
    if (id && id.length > 100) throw new ApiError(400, 'Некорректный плейлист');
    return reply(id ? await readPlaylist(me, id) : await listPlaylists(me));
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
    await assertWritable(me);
    return reply(await changePlaylist(me, await readJsonBody(req, 8192)));
  } catch (error) {
    return failure(error);
  }
}
