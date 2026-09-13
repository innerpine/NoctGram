'use client';
/* Server commands own shared playback; engine samples never echo back as commands. */
/* eslint-disable react/react-compiler */
import { useEffect, useMemo, useRef, useState } from 'react';
import { reconcileSnapshot } from './reconcile-snapshot';
import type { MusicLink } from './music-links';
import {
  playlistRequest,
  roomPosition,
  type PlaylistDetail,
} from './music-playlist-types';

type Engine = {
  url: string;
  position: number;
  duration: number;
  ready: boolean;
  playing: boolean;
  error: string;
  blocked?: boolean;
  play: (track: MusicLink, queue?: MusicLink[]) => void;
  setPlaying: (playing: boolean) => void;
  seek: (ms: number) => void;
  stop: () => void;
};
type SeekIntent = { trackId: string; positionMs: number };
type RoomCommand = {
  command: string;
  extra: Record<string, unknown>;
  version: number;
  roomId: string;
  session: string;
  seek?: SeekIntent;
};
export type MusicRoom = {
  detail: PlaylistDetail | null;
  error: string;
  busy: boolean; // Connecting only; ordinary playback commands keep controls usable.
  repeatPending: boolean;
  join: (playlist: PlaylistDetail, trackId?: string) => Promise<void>;
  leave: () => void;
  command: (command: string, extra?: Record<string, unknown>) => Promise<void>;
  reorder: (trackId: string, targetId: string) => Promise<void>;
};
export function useMusicRoom(engine: Engine): MusicRoom {
  const latest = useRef(engine);
  latest.current = engine;
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [repeatPending, setRepeatPending] = useState(false);
  const repeatRequest = useRef<RoomCommand | null>(null);
  const current = useRef<PlaylistDetail | null>(null),
    session = useRef('');
  const timing = useRef({ received: 0, server: 0 });
  const locked = useRef<RoomCommand | null>(null),
    generation = useRef(0);
  const pending = useRef<RoomCommand[]>([]);
  const seeking = useRef<SeekIntent | null>(null);
  const sync = useRef({
    url: '',
    revision: -1,
    attempt: 0,
    playback: null as PlaylistDetail['playback'] | null,
  });
  const accept = (data: PlaylistDetail) => {
    if (current.current && current.current.id !== data.id) return;
    if (
      current.current &&
      (data.playback.revision < current.current.playback.revision ||
        (data.playback.revision === current.current.playback.revision &&
          data.serverTime < current.current.serverTime))
    )
      return;
    if (data.listenSession !== session.current) {
      current.current = null;
      seeking.current = null;
      setDetail(null);
      latest.current.stop();
      setError(
        'Совместное прослушивание завершено или открыто в другой вкладке',
      );
      return;
    }
    timing.current = { received: performance.now(), server: data.serverTime };
    current.current = data;
    if (seeking.current?.trackId !== data.playback.trackId)
      seeking.current = null;
    setDetail((previous) => reconcileSnapshot(previous, data));
    setError('');
  };
  const refresh = async () => {
    const room = current.current,
      version = generation.current;
    if (!room) return;
    try {
      const data = await playlistRequest<PlaylistDetail>(
        '?id=' + encodeURIComponent(room.id),
      );
      if (version === generation.current && current.current?.id === room.id)
        accept(data);
    } catch (e) {
      if (version !== generation.current) return;
      setError((e as Error).message);
      if ([403, 404].includes((e as { status: number }).status)) {
        current.current = null;
        setDetail(null);
        latest.current.stop();
      }
    }
  };
  const run = async (request: RoomCommand) => {
    const { command, extra, version, roomId, seek } = request;
    locked.current = request;
    try {
      // Retry explicit seek/repeat intent once after a revision conflict.
      // Automatic end events must never retry and advance the room twice.
      for (let attempt = 0; attempt < 2; attempt++) {
        const room = current.current;
        if (version !== generation.current || room?.id !== roomId) return;
        if (
          seek &&
          (seek !== seeking.current || room.playback.trackId !== seek.trackId)
        )
          return;
        try {
          const data = await playlistRequest<PlaylistDetail>('', {
            action: 'control',
            id: roomId,
            session: request.session,
            revision: room.playback.revision,
            command,
            ...extra,
          });
          if (
            version === generation.current &&
            current.current?.id === roomId
          ) {
            accept(data);
            // The local engine already sought immediately. An acknowledgement
            // alone must not seek it a second time or restart playback.
            if (
              seek === seeking.current &&
              current.current?.playback.revision === data.playback.revision
            ) {
              sync.current.revision = data.playback.revision;
              sync.current.playback = data.playback;
            }
          }
          return;
        } catch (e) {
          if (version !== generation.current) return;
          if ((e as { status: number }).status !== 409) throw e;
          await refresh();
          if ((!seek && command !== 'repeat') || attempt > 0) return;
        }
      }
    } catch (e) {
      if (version !== generation.current) return;
      setError((e as Error).message);
    } finally {
      if (repeatRequest.current === request) {
        repeatRequest.current = null;
        setRepeatPending(false);
      }
      if (seek === seeking.current) seeking.current = null;
      if (locked.current === request) {
        locked.current = null;
        const next = pending.current.shift();
        if (next?.version === generation.current)
          void actions.current.run(next);
      }
    }
  };
  const command = async (
    command: string,
    extra: Record<string, unknown> = {},
  ) => {
    const room = current.current;
    if (!room) return;
    const request: RoomCommand = {
      command,
      extra,
      roomId: room.id,
      session: session.current,
      version: generation.current,
    };
    if (command === 'repeat') {
      if (repeatRequest.current || typeof extra.enabled !== 'boolean') return;
      repeatRequest.current = request;
      setRepeatPending(true);
    }
    // A local pause should stop the audio immediately, even on a slow network.
    // Reconciliation resumes after the command succeeds or fails.
    if (command === 'pause' && latest.current.playing)
      latest.current.setPlaying(false);
    if (command === 'seek') {
      const track = room.tracks.find((t) => t.id === room.playback.trackId);
      const engine = latest.current;
      if (
        !track ||
        engine.url !== track.url ||
        !engine.ready ||
        engine.error ||
        typeof extra.positionMs !== 'number' ||
        !Number.isFinite(extra.positionMs)
      )
        return;
      const positionMs = Math.max(
        0,
        Math.min(extra.positionMs, engine.duration),
      );
      request.seek = { trackId: track.id, positionMs };
      request.extra = { ...extra, positionMs };
      seeking.current = request.seek;
      engine.seek(positionMs);
    }
    if (locked.current) {
      if (command === 'duration' || command === 'advance') return;
      const tail = pending.current.at(-1);
      if (request.seek && tail?.seek?.trackId === request.seek.trackId)
        pending.current[pending.current.length - 1] = request;
      else pending.current.push(request);
      return;
    }
    await run(request);
  };
  const leave = () => {
    const room = current.current,
      token = session.current;
    generation.current++;
    pending.current = [];
    locked.current = null;
    repeatRequest.current = null;
    setRepeatPending(false);
    seeking.current = null;
    current.current = null;
    setDetail(null);
    setBusy(false);
    setError('');
    sync.current = { url: '', revision: -1, attempt: 0, playback: null };
    if (room)
      void playlistRequest('', {
        action: 'detach',
        id: room.id,
        session: token,
      }).catch(() => {});
  };
  const join = async (playlist: PlaylistDetail, trackId?: string) => {
    leave();
    const version = generation.current;
    const token = crypto.randomUUID();
    session.current = token;
    setBusy(true);
    try {
      const data = await playlistRequest<PlaylistDetail>('', {
        action: 'join',
        id: playlist.id,
        session: token,
      });
      if (version !== generation.current) return;
      accept(data);
      const target =
        trackId || (!data.playback.trackId ? data.tracks[0]?.id : undefined);
      if (target) await command('play', { trackId: target });
      else if (
        !data.playback.playing &&
        data.members.filter((m) => m.listening).length === 1
      )
        await command('resume');
    } catch (e) {
      if (version === generation.current) setError((e as Error).message);
    } finally {
      if (version === generation.current) setBusy(false);
    }
  };
  const reorder = async (trackId: string, targetId: string) => {
    const room = current.current,
      version = generation.current;
    if (!room) return;
    try {
      const data = await playlistRequest<PlaylistDetail>('', {
        action: 'reorder',
        id: room.id,
        trackId,
        targetId,
      });
      if (version === generation.current && current.current?.id === room.id)
        accept(data);
      window.dispatchEvent(new Event('noctgram:music-refresh'));
    } catch (e) {
      if (version === generation.current) setError((e as Error).message);
      throw e;
    }
  };
  const actions = useRef({ refresh, command, run, join, leave, reorder });
  actions.current = { refresh, command, run, join, leave, reorder };
  const controls = useMemo(
    () => ({
      join: (...args: Parameters<MusicRoom['join']>) =>
        actions.current.join(...args),
      leave: () => actions.current.leave(),
      command: (...args: Parameters<MusicRoom['command']>) =>
        actions.current.command(...args),
      reorder: (...args: Parameters<MusicRoom['reorder']>) =>
        actions.current.reorder(...args),
    }),
    [],
  );
  useEffect(() => {
    let disposed = false,
      polling = false,
      heartbeat = 0;
    const poll = async () => {
      const room = current.current,
        token = session.current,
        version = generation.current;
      if (!room || polling || disposed) return;
      polling = true;
      try {
        if (performance.now() - heartbeat > 20000) {
          heartbeat = performance.now();
          await playlistRequest('', {
            action: 'heartbeat',
            id: room.id,
            session: token,
          });
        }
        if (!disposed && version === generation.current)
          await actions.current.refresh();
      } catch (e) {
        if (!disposed && version === generation.current)
          setError((e as Error).message);
      } finally {
        polling = false;
      }
    };
    const apply = () => {
      const room = current.current,
        engine = latest.current;
      if (!room) return;
      if (performance.now() - timing.current.received > 15000) {
        if (engine.playing) engine.setPlaying(false);
        setError('Связь с плейлистом потеряна. Восстанавливаем синхронизацию…');
        return;
      }
      const track = room.tracks.find((t) => t.id === room.playback.trackId);
      if (!track) {
        if (engine.url) engine.stop();
        sync.current.url = '';
        return;
      }
      if (engine.url !== track.url) {
        if (sync.current.url !== track.url) {
          sync.current = {
            url: track.url,
            revision: -1,
            attempt: 0,
            playback: null,
          };
          engine.play(track, room.tracks);
        }
        return;
      }
      if (!engine.ready || engine.error || engine.blocked) return;
      // Native provider controls can already have paused/resumed locally. Do not
      // undo that action using a poll from before its command was acknowledged.
      if (locked.current && locked.current.command !== 'duration') return;
      // Polls may still contain the pre-seek position while the POST is pending.
      // Keep playing locally; resume normal reconciliation after ack or failure.
      if (seeking.current?.trackId === track.id) return;
      const now = performance.now(),
        target = roomPosition(
          room.playback,
          timing.current.server + now - timing.current.received,
        );
      if (now - sync.current.attempt < 1000) return;
      sync.current.attempt = now;
      if (room.playback.durationMs === 0 && engine.duration > 0)
        void actions.current.command('duration', {
          durationMs: engine.duration,
        });
      if (
        room.playback.playing &&
        room.playback.durationMs > 0 &&
        target >= room.playback.durationMs
      ) {
        void actions.current.command('advance');
        return;
      }
      // Revisions also change when a widget reports the duration. Compare the
      // timeline, not the revision alone: seeking an already aligned stream
      // interrupts SoundCloud audio during its first seconds. A real remote
      // seek/replay still applies even when its jump is below the drift limit.
      const previous = sync.current.playback;
      const moved =
        sync.current.revision !== room.playback.revision &&
        previous !== null &&
        (previous.trackId !== room.playback.trackId ||
          Math.abs(
            roomPosition(previous, room.playback.playbackAt) -
              room.playback.positionMs,
          ) > 1);
      const tolerance = room.playback.playing ? 2000 : 100;
      const shouldSeek =
        moved || Math.abs(engine.position - target) > tolerance;
      if (!room.playback.playing && engine.playing) engine.setPlaying(false);
      if (shouldSeek) {
        engine.seek(target);
      }
      sync.current.revision = room.playback.revision;
      sync.current.playback = room.playback;
      if (room.playback.playing && !engine.playing) engine.setPlaying(true);
    };
    const timer = setInterval(() => void poll(), 2000),
      animation = setInterval(apply, 250);
    const wake = () => {
      void poll().then(apply);
    };
    const visible = () => {
      if (!document.hidden) wake();
    };
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', visible);
    const detach = () => {
      const room = current.current;
      if (!room) return;
      const body = JSON.stringify({
        action: 'detach',
        id: room.id,
        session: session.current,
      });
      navigator.sendBeacon?.(
        '/api/music/playlists',
        new Blob([body], { type: 'application/json' }),
      );
    };
    window.addEventListener('pagehide', detach);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearInterval(animation);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pagehide', detach);
      detach();
    };
  }, []);
  return useMemo(
    () => ({ detail, error, busy, repeatPending, ...controls }),
    [detail, error, busy, repeatPending, controls],
  );
}
