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
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const forceRetry = useRef(false);
  useEffect(() => {
    if (!enabled || !lookupDuration || !track.artist) return;
    const retry = forceRetry.current;
    forceRetry.current = false;
    let cancelled = false;
    // Only the selected track metadata goes to LRCLIB, without account tokens.
    void trackLyricsCache
      .load(
        trackKey,
        { title: track.title, artist: track.artist, duration: lookupDuration },
        retry,
      )
      .then((value) => {
        if (!cancelled) setResult({ key, ...value });
      });
    return () => {
      cancelled = true;
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
  return {
    key,
    lyrics: result?.key === key ? result.lyrics : null,
    loading: !lookupDuration || !track.artist || result?.key !== key,
    error: result?.key === key && !!result.error,
    retry: () => {
      forceRetry.current = true;
      setResult(null);
      setAttempt((value) => value + 1);
    },
  };
}

export type LyricLookup = ReturnType<typeof useTrackLyrics>;
