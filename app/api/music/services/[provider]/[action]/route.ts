import { viewer, ApiError, failure } from '@/lib/server';
import { assertReadable, assertWritable } from '@/lib/account-access';
import { readJsonBody } from '@/lib/request-body';
import { oauthService } from '@/lib/music-service-types';
import {
  connectMusic,
  finishMusicConnection,
  disconnectMusic,
  servicePlaylists,
  importedPlaylists,
  importServicePlaylist,
  searchServiceTracks,
  spotifyPlaybackToken,
} from '@/lib/music-services';
export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ provider: string; action: string }> };
function privateResponse(response: Response) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
async function selected(params: Params['params']) {
  const value = await params;
  try {
    return { provider: oauthService(value.provider), action: value.action };
  } catch {
    throw new ApiError(404, 'Подключение этого сервиса пока недоступно.');
  }
}
export async function GET(req: Request, { params }: Params) {
  try {
    const { provider, action } = await selected(params),
      user = await viewer();
    await assertReadable(user);
    const query = new URL(req.url).searchParams;
    if (action === 'callback') {
      await assertWritable(user);
      try {
        return privateResponse(
          await finishMusicConnection(req, user, provider),
        );
      } catch {
        return privateResponse(
          new Response(null, {
            status: 303,
            headers: {
              Location:
                '/music/services?provider=' + provider + '&result=failed',
            },
          }),
        );
      }
    }
    if (action === 'playlists')
      return privateResponse(
        Response.json(
          await servicePlaylists(
            user,
            provider,
            (query.get('cursor') || '').slice(0, 12000),
          ),
        ),
      );
    if (action === 'imports')
      return privateResponse(
        Response.json({ items: await importedPlaylists(user, provider) }),
      );
    if (action === 'search')
      return privateResponse(
        Response.json({
          items: await searchServiceTracks(
            user,
            provider,
            query.get('q') || '',
          ),
        }),
      );
    throw new ApiError(404, 'Не найдено');
  } catch (error) {
    return privateResponse(failure(error));
  }
}
export async function POST(req: Request, { params }: Params) {
  try {
    if (
      req.headers.get('origin') !== new URL(req.url).origin ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new ApiError(403, 'Недопустимый источник запроса.');
    if (!req.headers.get('content-type')?.startsWith('application/json'))
      throw new ApiError(415, 'Ожидается JSON.');
    const body = await readJsonBody(req, 4096),
      { provider, action } = await selected(params),
      user = await viewer();
    await assertReadable(user);
    // Read-only users can disconnect and erase their imported account data.
    if (action === 'disconnect')
      return privateResponse(
        Response.json(await disconnectMusic(user, provider)),
      );
    await assertWritable(user);
    if (provider === 'spotify' && action === 'playback-token')
      return privateResponse(Response.json(await spotifyPlaybackToken(user)));
    if (action === 'connect')
      return privateResponse(await connectMusic(req, user, provider));
    if (action === 'import')
      return privateResponse(
        Response.json(await importServicePlaylist(user, provider, body.id)),
      );
    throw new ApiError(404, 'Не найдено');
  } catch (error) {
    return privateResponse(failure(error));
  }
}
