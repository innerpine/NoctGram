import { findTrackLyrics, LyricsUnavailable } from './music-lyrics-search';
import { stableLyricDuration, type TrackLyrics } from './music-player';

type Recording = { title: string; artist: string; duration: number };
export type CachedLyrics = { lyrics: TrackLyrics | null; error?: boolean };
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
    private lookup = findTrackLyrics,
    private now = () => Date.now(),
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
    // Serve already cached lyrics above, even while the service is unavailable.
    if (this.cooldown > now)
      return Promise.resolve({ lyrics: null, error: true });
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
      .then(() => this.lookup(recording, controller.signal))
      .then((lyrics) => {
        entry.value = { lyrics };
        entry.until = this.now() + (lyrics ? 3600000 : 900000);
        return entry.value;
      })
      .catch((error: unknown) => {
        this.cooldown = Math.max(
          this.cooldown,
          this.now() + 60000,
          error instanceof LyricsUnavailable ? error.until : 0,
        );
        entry.value = { lyrics: null, error: true };
        entry.until = this.cooldown;
        return entry.value;
      })
      .finally(() => {
        clearTimeout(timeout);
        entry.pending = undefined;
      });
    return entry.pending;
  }
}

export const trackLyricsCache = new TrackLyricsCache();
