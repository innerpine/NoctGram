import {
  lyricRetryAt,
  LyricsRateLimit,
  LyricsUnavailable,
  type Recording,
} from './music-lyrics-search';
import { LYRICS_MAX_BYTES, validTrackLyrics } from './lyrics-storage';
import { readUpstreamJson } from './upstream-json';
import type { TrackLyrics } from './music-player';

export async function requestTrackLyrics(
  recording: Recording,
  signal: AbortSignal,
  request: typeof fetch = (input, init) => fetch(input, init),
): Promise<TrackLyrics | null> {
  const params = new URLSearchParams({
    title: recording.title,
    artist: recording.artist,
    duration: String(recording.duration),
  });
  const response = await request('/api/music/lyrics?' + params, {
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    const Failure =
      response.status === 429 ? LyricsRateLimit : LyricsUnavailable;
    throw new Failure(lyricRetryAt(response));
  }
  const body = await readUpstreamJson<{ lyrics: unknown }>(
    response,
    LYRICS_MAX_BYTES,
  );
  if (body.lyrics === null) return null;
  if (!validTrackLyrics(body.lyrics))
    throw new LyricsUnavailable(Date.now() + 8000);
  return body.lyrics;
}
