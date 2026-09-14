import { stableLyricDuration, type TrackLyrics } from './music-player';

export const LYRICS_MAX_BYTES = 512000;
export const LYRICS_RETENTION = 30 * 86400000;

/** Validate parsed lyrics coming from the API or persistent storage. */
export function validTrackLyrics(value: unknown): value is TrackLyrics {
  if (!value || typeof value !== 'object') return false;
  const data = value as TrackLyrics;
  return (
    typeof data.plain === 'string' &&
    data.plain.length <= 80000 &&
    typeof data.instrumental === 'boolean' &&
    Array.isArray(data.lines) &&
    data.lines.length <= 1000 &&
    (data.instrumental || !!data.plain || data.lines.length > 0) &&
    data.lines.every(
      (line, index) =>
        line &&
        Number.isFinite(line.time) &&
        line.time >= 0 &&
        typeof line.text === 'string' &&
        line.text.length <= 80000 &&
        (!index || line.time >= data.lines[index - 1].time),
    ) &&
    JSON.stringify(data).length <= LYRICS_MAX_BYTES / 2
  );
}

export async function lyricCacheKey(identity: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identity),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export interface LyricsStore {
  read(trackKey: string, duration: number): Promise<TrackLyrics | null>;
  write(trackKey: string, duration: number, lyrics: TrackLyrics): Promise<void>;
}

// CacheStorage is optional (private browsing/storage pressure). Its failure must
// never prevent playback or a fresh lookup. Only successful, public lyrics live here.
export function browserLyricsStore(
  open = async () =>
    typeof window === 'undefined' ? null : window.caches.open('noct-lyrics-v1'),
  now = () => Date.now(),
): LyricsStore {
  const key = async (trackKey: string) =>
    'https://noctgram.com/__lyrics/browser/' + (await lyricCacheKey(trackKey));
  return {
    async read(trackKey, duration) {
      try {
        const cache = await open();
        const url = await key(trackKey);
        const response = await cache?.match(url);
        if (!response) return null;
        const raw = await response.text();
        if (raw.length > LYRICS_MAX_BYTES) return null;
        const data = JSON.parse(raw);
        if (
          data.until > now() &&
          data.trackKey === trackKey &&
          Number.isFinite(data.duration) &&
          data.duration > 0 &&
          stableLyricDuration(data.duration, duration) === data.duration &&
          validTrackLyrics(data.lyrics)
        )
          return data.lyrics;
        // A different recording duration can be useful on the next play.
        if (!(data.until > now())) await cache?.delete(url);
      } catch {
        /* Storage is best effort. */
      }
      return null;
    },
    async write(trackKey, duration, lyrics) {
      try {
        if (!validTrackLyrics(lyrics)) return;
        const cache = await open();
        if (!cache) return;
        const url = await key(trackKey);
        await cache.delete(url);
        await cache.put(
          url,
          Response.json({
            trackKey,
            duration,
            lyrics,
            until: now() + LYRICS_RETENTION,
          }),
        );
        const keys = await cache.keys();
        for (const old of keys.slice(0, Math.max(0, keys.length - 50)))
          await cache.delete(old);
      } catch {
        /* Storage is best effort. */
      }
    },
  };
}
