import { findTrackLyrics, type Recording } from './music-lyrics-search';
import {
  lyricCacheKey,
  LYRICS_MAX_BYTES,
  LYRICS_RETENTION,
  validTrackLyrics,
} from './lyrics-storage';
import { readUpstreamJson } from './upstream-json';
import type { TrackLyrics } from './music-player';

// No shared promises: Cloudflare requests cannot reuse another request's I/O.
export async function serverTrackLyrics(
  recording: Recording,
  signal: AbortSignal,
  cache?: Pick<Cache, 'match' | 'put'>,
  lookup = findTrackLyrics,
  now = () => Date.now(),
): Promise<TrackLyrics | null> {
  const key =
    'https://noctgram.com/__lyrics/server/v1/' +
    (await lyricCacheKey(JSON.stringify(recording)));
  let previous: TrackLyrics | null = null;
  try {
    const response = await cache?.match(key);
    if (response) {
      const data = await readUpstreamJson<{
        lyrics: unknown;
        freshUntil: number;
        until: number;
      }>(response, LYRICS_MAX_BYTES);
      if (data.until > now() && validTrackLyrics(data.lyrics)) {
        previous = data.lyrics;
        if (data.freshUntil > now()) return previous;
      }
    }
  } catch {
    /* A cache miss must not block the provider lookup. */
  }
  try {
    const lyrics = await lookup(recording, signal);
    if (!lyrics) return previous;
    if (validTrackLyrics(lyrics)) {
      try {
        await cache?.put(
          key,
          Response.json(
            {
              lyrics,
              freshUntil: now() + 7 * 86400000,
              until: now() + LYRICS_RETENTION,
            },
            {
              headers: {
                'Cache-Control': 'public, max-age=' + LYRICS_RETENTION / 1000,
              },
            },
          ),
        );
      } catch {
        /* Correct lyrics remain usable when storage is unavailable. */
      }
    }
    return lyrics;
  } catch (error) {
    if (previous) return previous;
    throw error;
  }
}
