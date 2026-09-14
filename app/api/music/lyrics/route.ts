import { viewer, ApiError, failure } from '@/lib/server';
import { assertReadable } from '@/lib/account-access';
import { rateLimit } from '@/lib/rate-limit';
import { LyricsRateLimit, LyricsUnavailable } from '@/lib/music-lyrics-search';
import { serverTrackLyrics } from '@/lib/music-lyrics-server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const me = await viewer();
    await assertReadable(me);
    const params = new URL(req.url).searchParams;
    const title = (params.get('title') || '').trim();
    const artist = (params.get('artist') || '').trim();
    const duration = Number(params.get('duration'));
    if (
      !title ||
      title.length > 500 ||
      !artist ||
      artist.length > 300 ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 86400000
    )
      throw new ApiError(400, 'Не удалось определить композицию.');
    await rateLimit('music-lyrics', me, 30, 60);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const cache = (
        globalThis.caches as (CacheStorage & { default?: Cache }) | undefined
      )?.default;
      const lyrics = await serverTrackLyrics(
        { title, artist, duration },
        controller.signal,
        cache,
      );
      return Response.json(
        { lyrics },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof ApiError) return failure(error);
    return Response.json(
      { error: 'Сервис текстов временно недоступен.' },
      {
        status: error instanceof LyricsRateLimit ? 429 : 503,
        headers: {
          'Cache-Control': 'private, no-store',
          'Retry-After': String(
            Math.max(
              8,
              Math.ceil(
                ((error instanceof LyricsUnavailable
                  ? error.until
                  : Date.now() + 8000) -
                  Date.now()) /
                  1000,
              ),
            ),
          ),
        },
      },
    );
  }
}
