import { viewer, failure, ApiError } from '@/lib/server';
import { assertReadable } from '@/lib/account-access';
import { rateLimit } from '@/lib/rate-limit';
import {
  soundcloudStreamingConfigured,
  soundcloudTrack,
  soundcloudStream,
} from '@/lib/soundcloud-stream';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  };
  try {
    const me = await viewer();
    await assertReadable(me);
    const params = new URL(req.url).searchParams;
    if (params.get('action') === 'status')
      return Response.json(
        { configured: soundcloudStreamingConfigured() },
        { headers },
      );
    const action = params.get('action');
    if (action !== 'track' && action !== 'stream')
      throw new ApiError(400, 'Неизвестное действие.');
    await rateLimit('soundcloud-playback', me, 120, 60);
    if (action === 'track')
      return Response.json(await soundcloudTrack(params.get('url')), {
        headers,
      });
    return new Response(null, {
      status: 302,
      headers: {
        ...headers,
        Location: await soundcloudStream(params.get('url')),
      },
    });
  } catch (error) {
    const response = failure(error);
    for (const [name, value] of Object.entries(headers))
      response.headers.set(name, value);
    return response;
  }
}
