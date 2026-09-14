import { LyricsRateLimit, LyricsUnavailable } from './music-lyrics-search';
import { requestTrackLyrics } from './music-lyrics-client';
import { browserLyricsStore, type LyricsStore } from './lyrics-storage';
import { stableLyricDuration, type TrackLyrics } from './music-player';

type Recording = { title: string; artist: string; duration: number };
export type CachedLyrics = {
  lyrics: TrackLyrics | null;
  error?: boolean;
  retryAt?: number;
};
type Entry = {
  trackKey: string;
  duration: number;
  until: number;
  retryAt: number;
  value?: CachedLyrics;
  pending?: Promise<CachedLyrics>;
};

/** Shared across lyric views, effect restarts and repeat plays in this tab. */
export class TrackLyricsCache {
  private entries = new Map<string, Entry>();
  private cooldown = 0;
  constructor(
    private lookup = requestTrackLyrics,
    private now = () => Date.now(),
    private store?: LyricsStore,
  ) {}
  load(
    trackKey: string,
    recording: Recording,
    retry = false,
  ): Promise<CachedLyrics> {
    const now = this.now();
    const match = [...this.entries.entries()].find(
      ([, entry]) =>
        entry.trackKey === trackKey &&
        stableLyricDuration(entry.duration, recording.duration) ===
          entry.duration,
    );
    if (match) {
      const [key, entry] = match;
      this.entries.delete(key);
      this.entries.set(key, entry);
      if (entry.pending) return entry.pending;
      if (entry.value && entry.until > now && (!retry || entry.retryAt > now))
        return Promise.resolve(entry.value);
    }
    const previous = match?.[1].value?.lyrics || null;
    if (match) this.entries.delete(match[0]);
    const key = JSON.stringify([trackKey, recording.duration]);
    const entry: Entry = {
      trackKey,
      duration: recording.duration,
      until: 0,
      retryAt: now + 15000,
    };
    this.entries.set(key, entry);
    if (this.entries.size > 50)
      this.entries.delete(this.entries.keys().next().value!);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    // The lookup owns its lifetime: closing/reopening a panel must not cancel
    // the request and immediately start the same request all over again.
    entry.pending = Promise.resolve()
      .then(async () => {
        let saved = previous;
        try {
          if (!saved && this.store)
            saved = await this.store.read(trackKey, recording.duration);
        } catch {
          /* Persistence is optional. */
        }
        if (saved && !retry) return saved;
        if (this.cooldown > this.now()) {
          if (saved) return saved;
          throw new LyricsRateLimit(this.cooldown);
        }
        try {
          return (await this.lookup(recording, controller.signal)) || saved;
        } catch (error) {
          if (error instanceof LyricsRateLimit)
            this.cooldown = Math.max(this.cooldown, error.until);
          if (saved) return saved;
          throw error;
        }
      })
      .then((lyrics) => {
        entry.value = {
          lyrics,
          ...(!lyrics ? { retryAt: entry.retryAt } : {}),
        };
        entry.until = this.now() + (lyrics ? 3600000 : 900000);
        if (lyrics)
          void this.store
            ?.write(trackKey, recording.duration, lyrics)
            .catch(() => {});
        return entry.value;
      })
      .catch((error: unknown) => {
        const retryAt = Math.max(
          this.now() + 8000,
          error instanceof LyricsUnavailable ? error.until : 0,
        );
        // Only a real rate limit pauses other tracks. A transient failure is
        // local to this lookup, and its retry becomes eligible after 8 seconds.
        if (error instanceof LyricsRateLimit)
          this.cooldown = Math.max(this.cooldown, retryAt);
        entry.value = { lyrics: null, error: true, retryAt };
        entry.until = entry.retryAt = retryAt;
        return entry.value;
      })
      .finally(() => {
        clearTimeout(timeout);
        entry.pending = undefined;
      });
    return entry.pending;
  }
}

export const trackLyricsCache = new TrackLyricsCache(
  requestTrackLyrics,
  () => Date.now(),
  browserLyricsStore(),
);
