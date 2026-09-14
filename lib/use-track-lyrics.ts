'use client';
/* Async results intentionally update React state; no React compiler is enabled. */
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import { trackLyricsCache } from './track-lyrics-cache';
import { stableLyricDuration, type TrackLyrics } from './music-player';

// One lookup belongs to the player, shared by its full and docked lyric views.
export function useTrackLyrics(
  track: { url: string; artist: string; title: string },
  duration: number,
  enabled: boolean,
) {
  const trackKey = JSON.stringify([track.url, track.artist, track.title]);
  const [recording, setRecording] = useState(() => ({
    trackKey,
    duration: stableLyricDuration(0, duration),
  }));
  const lookupDuration = stableLyricDuration(
    recording.trackKey === trackKey ? recording.duration : 0,
    duration,
  );
  // Update before committing the render so another track never shows the old
  // lyrics. Minor duration corrections must not unmount the scroll region.
  if (recording.trackKey !== trackKey || recording.duration !== lookupDuration)
    setRecording({ trackKey, duration: lookupDuration });
  const key = `${trackKey}:${lookupDuration}`;
  const [result, setResult] = useState<{
    key: string;
    lyrics: TrackLyrics | null;
    error?: boolean;
    retryAt?: number;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const forceRetry = useRef(false);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!enabled || !lookupDuration || !track.artist) return;
    const retry = forceRetry.current;
    forceRetry.current = false;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The same-origin endpoint sends only public track metadata to LRCLIB.
    const load = (manual: boolean, remaining: number) =>
      void trackLyricsCache
        .load(
          trackKey,
          {
            title: track.title,
            artist: track.artist,
            duration: lookupDuration,
          },
          manual,
        )
        .then((value) => {
          if (cancelled) return;
          setClock(Date.now());
          setResult({ key, ...value });
          if (value.error && value.retryAt && remaining > 0) {
            timer = setTimeout(
              () => {
                if (!cancelled) load(false, remaining - 1);
              },
              Math.min(
                2147483647,
                Math.max(1000, value.retryAt - Date.now() + 50),
              ),
            );
          }
        });
    load(retry, 2);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    key,
    trackKey,
    enabled,
    lookupDuration,
    track.artist,
    track.title,
    attempt,
  ]);
  const retryAt = result?.key === key ? result.retryAt || 0 : 0;
  useEffect(() => {
    if (!enabled || retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [enabled, retryAt]);
  const retryIn = Math.max(0, Math.ceil((retryAt - clock) / 1000));
  return {
    key,
    lyrics: result?.key === key ? result.lyrics : null,
    loading: !lookupDuration || !track.artist || result?.key !== key,
    error: result?.key === key && !!result.error,
    retryIn,
    retry: () => {
      if (retryAt > Date.now()) return;
      forceRetry.current = true;
      setResult(null);
      setAttempt((value) => value + 1);
    },
  };
}

export type LyricLookup = ReturnType<typeof useTrackLyrics>;
