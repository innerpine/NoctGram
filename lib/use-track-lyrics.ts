'use client';
/* Async results intentionally update React state; no React compiler is enabled. */
/* eslint-disable react/react-compiler */
import { useEffect, useState } from 'react';
import { findTrackLyrics, LyricsRateLimit } from './music-lyrics-search';
import type { TrackLyrics } from './music-player';

const cache = new Map<string, { lyrics: TrackLyrics | null; until: number }>();
let cooldown = 0;

// One lookup belongs to the player, shared by its full and docked lyric views.
export function useTrackLyrics(
  track: { url: string; artist: string; title: string },
  duration: number,
  enabled: boolean,
) {
  const key = `${track.url}:${track.artist}:${track.title}:${Math.round(duration)}`;
  const [result, setResult] = useState<{
    key: string;
    lyrics: TrackLyrics | null;
    error?: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !duration || !track.artist) return;
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) {
      setResult({ key, lyrics: cached.lyrics });
      return;
    }
    if (cooldown > Date.now()) {
      setResult({ key, lyrics: null, error: true });
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let cancelled = false;
    // Only the selected track metadata goes to LRCLIB, without account tokens.
    void findTrackLyrics(
      { title: track.title, artist: track.artist, duration },
      controller.signal,
    )
      .then((lyrics) => {
        if (cancelled) return;
        if (cache.size >= 30) cache.delete(cache.keys().next().value!);
        cache.set(key, {
          lyrics,
          until: Date.now() + (lyrics ? 600000 : 60000),
        });
        setResult({ key, lyrics });
      })
      .catch((error) => {
        if (error instanceof LyricsRateLimit) cooldown = error.until;
        if (!cancelled) setResult({ key, lyrics: null, error: true });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [key, enabled, duration, track.artist, track.title, attempt]);
  return {
    key,
    lyrics: result?.key === key ? result.lyrics : null,
    loading: !duration || !track.artist || result?.key !== key,
    error: result?.key === key && !!result.error,
    retry: () => {
      cache.delete(key);
      setResult(null);
      setAttempt((value) => value + 1);
    },
  };
}

export type LyricLookup = ReturnType<typeof useTrackLyrics>;
