'use client';
/* Playback samples come from the existing audio engine, never a second player. */
/* eslint-disable react/react-compiler */
import { useEffect, useRef } from 'react';
import type { PlayerTrack } from './music-player-view';

type Sample = {
  track: PlayerTrack;
  playing: boolean;
  ready: boolean;
  position: number;
  duration: number;
};
type PlaybackState = 'playing' | 'paused' | 'stopped';
function playbackState(sample: Sample): PlaybackState {
  if (!sample.ready || sample.duration <= 0 || !sample.track.url)
    return 'stopped';
  return sample.playing ? 'playing' : 'paused';
}
export function MusicActivityPublisher(sample: Sample) {
  const latest = useRef(sample);
  const sampleChanged = useRef(() => {});
  latest.current = sample;
  useEffect(() => {
    const sessionId = crypto.randomUUID();
    let sequence = 0,
      disposed = false,
      suspended = false,
      queued = false,
      running = false;
    let settingsVersion = 0;
    let enabled: boolean | null = null,
      checked = 0,
      lastSent = 0,
      claim = true;
    let previous = {
      key: '',
      state: 'stopped' as PlaybackState,
      position: 0,
      time: performance.now(),
    };
    const notify = () =>
      window.dispatchEvent(new Event('noctgram:music-activity-changed'));
    const payload = (state: PlaybackState, takeOver = false) => {
      const value = latest.current;
      return {
        action: 'publish',
        sessionId,
        sequence: ++sequence,
        state,
        ...(state !== 'stopped'
          ? {
              url: value.track.url,
              title: value.track.title.slice(0, 300),
              artist: value.track.artist.slice(0, 200),
              artwork: value.track.artwork,
              durationMs: value.duration,
              positionMs: Math.max(0, Math.min(value.position, value.duration)),
              claim: takeOver,
            }
          : {}),
      };
    };
    const send = async () => {
      queued = true;
      if (running || enabled !== true || disposed || suspended) return;
      running = true;
      try {
        while (queued && !disposed && !suspended && enabled === true) {
          queued = false;
          const state = playbackState(latest.current);
          const takeOver = claim;
          claim = false;
          lastSent = performance.now();
          const response = await fetch('/api/music/activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload(state, takeOver)),
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) break;
          const data = (await response.json()) as { enabled?: boolean };
          if (disposed) break;
          enabled = data.enabled === true;
          notify();
        }
      } catch {
        /* Activity must never interrupt music. The next heartbeat retries. */
      } finally {
        running = false;
      }
    };
    const refreshSettings = async () => {
      const version = settingsVersion;
      checked = performance.now();
      try {
        const response = await fetch('/api/music/activity?settings=1', {
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok || disposed) return;
        const data = (await response.json()) as { enabled?: boolean };
        if (disposed || version !== settingsVersion) return;
        const changed = enabled !== data.enabled;
        enabled = data.enabled === true;
        if (changed && enabled) {
          claim = true;
          void send();
        }
      } catch {
        /* Try again later without changing playback. */
      }
    };
    const tick = () => {
      if (suspended) return;
      const value = latest.current,
        now = performance.now();
      const key = `${value.track.url}:${value.track.title}:${value.track.artist}`;
      const state = playbackState(value);
      const active = state !== 'stopped';
      const changed = previous.key !== key || previous.state !== state;
      const seek =
        active &&
        !changed &&
        Math.abs(
          value.position -
            previous.position -
            (state === 'playing' ? now - previous.time : 0),
        ) > 1800;
      if (changed && state === 'playing') claim = true;
      previous = { key, state, position: value.position, time: now };
      if (enabled === null || now - checked > 60000) {
        if (now - checked > 10000) void refreshSettings();
      }
      if (
        changed ||
        (seek && now - lastSent > 1000) ||
        (active && now - lastSent >= 20000)
      )
        void send();
    };
    const settingsChanged = (event: Event) => {
      settingsVersion++;
      enabled = (event as CustomEvent).detail?.enabled === true;
      checked = performance.now();
      if (enabled) {
        claim = true;
        void send();
      } else notify();
    };
    const clear = () => {
      if (enabled !== true) return;
      const body = JSON.stringify(payload('stopped'));
      const sent = navigator.sendBeacon?.(
        '/api/music/activity',
        new Blob([body], { type: 'application/json' }),
      );
      if (!sent)
        void fetch('/api/music/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
    };
    const hide = () => {
      suspended = true;
      queued = false;
      clear();
    };
    const resume = () => {
      suspended = false;
      claim = true;
      void refreshSettings();
      void send();
    };
    sampleChanged.current = tick;
    void refreshSettings();
    const timer = setInterval(tick, 500);
    window.addEventListener(
      'noctgram:music-activity-settings',
      settingsChanged,
    );
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', resume);
    return () => {
      disposed = true;
      sampleChanged.current = () => {};
      clearInterval(timer);
      window.removeEventListener(
        'noctgram:music-activity-settings',
        settingsChanged,
      );
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', resume);
      clear();
    };
  }, []);
  useEffect(() => {
    sampleChanged.current();
  }, [sample.track.url, sample.playing, sample.ready, sample.duration]);
  return null;
}
