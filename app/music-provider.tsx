'use client';
import { observeAppViewport } from '@/lib/app-viewport';
/* Provider subscriptions update state from real SoundCloud events. */
/* eslint-disable react/react-compiler, next/no-img-element */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  musicLabel,
  musicRequest,
  parseMusicLink,
  type MusicLink,
  type MusicTrack,
} from '@/lib/music-links';
import {
  loadSoundCloudWidget,
  releaseSoundCloudWidget,
  SoundCloudStateMonitor,
  type SoundCloudSound,
  type Widget,
} from '@/lib/soundcloud-widget';
import { MusicPlayerView, type PlayerTrack } from './music-player-view';
import { MusicActivityPublisher } from './music-activity-publisher';
import { useMusicRoom, type MusicRoom } from '@/lib/use-music-room';
import { loadSpotifySDK, SpotifyPlayback } from '@/lib/spotify-player';
import { loadYouTubeSDK, YouTubePlayback } from '@/lib/youtube-player';
import {
  DEFAULT_MUSIC_VOLUME,
  clampMusicVolume,
  readMusicVolume,
  musicGain,
  youtubeVolume,
  volumeFromYouTube,
} from '@/lib/music-volume';
import { moveMusicItem } from '@/lib/music-queue';
import {
  MusicContext,
  MusicPlaybackContext,
  useMusic,
} from '@/lib/music-context';
import {
  MusicListenTracker,
  adjacentPlayable,
  type ListenState,
} from '@/lib/music-listening';

export function MusicAccountGuard({ blocked }: { blocked: boolean }) {
  const stop = useMusic()?.stop;
  useEffect(() => {
    if (blocked) stop?.();
  }, [blocked, stop]);
  return null;
}
export function MusicProvider({ children }: { children: ReactNode }) {
  useEffect(() => observeAppViewport(), []);
  const [link, setLink] = useState<MusicLink | null>(null);
  const [sound, setSound] = useState<SoundCloudSound | null>(null);
  const [localTrack, setLocalTrack] = useState<MusicTrack | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const spotify = useRef<SpotifyPlayback | null>(null);
  const youtube = useRef<YouTubePlayback | null>(null);
  const youtubeHost = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [error, setError] = useState(''),
    [position, setPosition] = useState(0),
    [duration, setDuration] = useState(0);
  const [expanded, setExpanded] = useState(false),
    [volume, setVolume] = useState(DEFAULT_MUSIC_VOLUME),
    [retry, setRetry] = useState(0);
  const [playlistIndex, setPlaylistIndex] = useState(0),
    [playlistLength, setPlaylistLength] = useState(0);
  const [playlistSounds, setPlaylistSounds] = useState<SoundCloudSound[]>([]);
  const [queue, setQueue] = useState<MusicLink[]>([]);
  const nativeOrder = useRef<MusicLink[] | null>(null);
  const frame = useRef<HTMLIFrameElement>(null),
    widget = useRef<Widget | null>(null);
  const [soundCloudSource, setSoundCloudSource] = useState('');
  const loadedFrame = useRef<HTMLIFrameElement | null>(null);
  const loadedSounds = useRef<SoundCloudSound[]>([]);
  const soundCloudState = useRef<SoundCloudStateMonitor | null>(null);
  const playerElement = useRef<HTMLElement>(null);
  const hasPlayer = !!link;
  useEffect(() => {
    if (!hasPlayer || !playerElement.current) return;
    const element = playerElement.current;
    const reserveSpace = () =>
      document.documentElement.style.setProperty(
        '--music-player-height',
        `${element.getBoundingClientRect().height}px`,
      );
    reserveSpace();
    const observer = new ResizeObserver(reserveSpace);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--music-player-height');
    };
  }, [hasPlayer, link?.url, retry]);
  const desired = useRef<MusicLink | null>(null),
    queueRef = useRef<MusicLink[]>([]),
    soundUrl = useRef('');
  const generation = useRef(0),
    isPlaying = useRef(false),
    volumeRef = useRef(volume);
  const tracker = useRef<MusicListenTracker | null>(null);
  const roomRef = useRef<MusicRoom | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      audio.current?.pause();
      youtube.current?.dispose();
      spotify.current?.dispose();
    },
    [],
  );
  const [listening, setListening] = useState<ListenState>({
    status: 'idle',
    seconds: 0,
  });
  volumeRef.current = volume;
  useEffect(() => {
    try {
      const value = readMusicVolume(
        localStorage.getItem('noctgram:music-volume'),
      );
      volumeRef.current = value;
      setVolume(value);
    } catch {
      /* Device storage is optional. */
    }
  }, []);
  const clearStats = () => {
    tracker.current?.dispose();
    tracker.current = null;
    setListening({ status: 'idle', seconds: 0 });
  };
  const stop = useCallback(() => {
    nativeOrder.current = null;
    generation.current++;
    widget.current?.pause();
    audio.current?.pause();
    spotify.current?.dispose();
    spotify.current = null;
    youtube.current?.dispose();
    youtube.current = null;
    desired.current = null;
    soundUrl.current = '';
    clearStats();
    isPlaying.current = false;
    setPlaying(false);
    setLink(null);
    setSoundCloudSource('');
    loadedSounds.current = [];
    setExpanded(false);
    setSound(null);
    setLocalTrack(null);
    setError('');
    setReady(false);
    setNeedsGesture(false);
  }, []);
  const play = useCallback((next: MusicLink, nextQueue?: MusicLink[]) => {
    const parsed = parseMusicLink(next.url);
    if (!parsed) return;
    const valid = {
      ...next,
      ...parsed,
      playback:
        parsed.provider === 'spotify'
          ? next.playback ||
            ((next as MusicTrack).audioUrl ? 'file' : 'spotify')
          : undefined,
    } as MusicLink;
    if (nextQueue) {
      queueRef.current = nextQueue;
      setQueue(nextQueue);
    } else if (!queueRef.current.some((item) => item.url === valid.url)) {
      queueRef.current = [valid];
      setQueue([valid]);
    }
    if (
      valid.provider === 'soundcloud' &&
      desired.current?.kind === 'playlist' &&
      widget.current
    ) {
      const index = loadedSounds.current.findIndex(
        (sound) => sound.permalink_url === valid.url,
      );
      if (index >= 0) {
        soundCloudState.current?.invalidate();
        widget.current.skip(index);
        widget.current.play();
        return;
      }
    }
    if (
      desired.current?.url === valid.url &&
      valid.provider === 'youtube' &&
      youtube.current
    ) {
      youtube.current.resume();
      return;
    }
    if (
      desired.current?.url === valid.url &&
      desired.current.playback === valid.playback &&
      valid.provider === 'soundcloud' &&
      widget.current
    ) {
      soundCloudState.current?.invalidate();
      widget.current.play();
      return;
    }
    if (
      desired.current?.url === valid.url &&
      desired.current.playback === 'spotify' &&
      valid.playback === 'spotify' &&
      spotify.current
    ) {
      spotify.current.resume();
      return;
    }
    if (
      desired.current?.url === valid.url &&
      valid.provider === 'spotify' &&
      valid.playback === 'file' &&
      desired.current.playback === 'file' &&
      audio.current?.currentSrc
    ) {
      void audio.current
        .play()
        .catch(() =>
          setError('Не удалось запустить аудио. Нажмите «Повторить».'),
        );
      return;
    }
    // Keep the iframe browsing context when advancing the queue. Replacing it
    // on every URL discards the user's media activation on mobile browsers.
    if (valid.provider === 'soundcloud') {
      setSoundCloudSource((source) => source || valid.url);
    } else {
      setSoundCloudSource('');
    }
    generation.current++;
    widget.current?.pause();
    audio.current?.pause();
    spotify.current?.dispose();
    spotify.current = null;
    if (valid.provider !== 'youtube') {
      youtube.current?.dispose();
      youtube.current = null;
    }
    clearStats();
    soundUrl.current = '';
    nativeOrder.current = null;
    desired.current = valid;
    isPlaying.current = false;
    setPlaying(false);
    setReady(false);
    setNeedsGesture(true);
    setError('');
    setSound(null);
    setLocalTrack(null);
    setPosition(0);
    setDuration(0);
    setPlaylistIndex(0);
    setPlaylistLength(0);
    setPlaylistSounds([]);
    setLink(valid);
    const knownAudio = (next as MusicTrack).audioUrl;
    if (
      valid.playback === 'file' &&
      audio.current &&
      knownAudio &&
      /^\/api\/music\/audio\/[a-f0-9-]{36}$/.test(knownAudio) &&
      roomRef.current?.detail?.playback.playing !== 0
    ) {
      // Start on the existing element while a Next/queue tap is still active.
      // The effect attaches tracking and validates metadata without resetting it.
      audio.current.src = knownAudio;
      audio.current.load();
      void audio.current.play().catch(() => {
        /* The effect reports playback errors. */
      });
    }
  }, []);
  useEffect(() => {
    const disconnected = (event: Event) => {
      if (
        (event as CustomEvent).detail === 'spotify' &&
        desired.current?.playback === 'spotify'
      )
        stop();
    };
    window.addEventListener('noctgram:music-disconnect', disconnected);
    return () =>
      window.removeEventListener('noctgram:music-disconnect', disconnected);
  }, [stop]);
  useEffect(() => {
    if (link?.provider !== 'spotify' || link.playback !== 'spotify') return;
    clearStats();
    setListening({ status: 'excluded', seconds: 0 });
    let active = true;
    const token = ++generation.current;
    const current = () => active && generation.current === token;
    let engine: SpotifyPlayback | null = null;
    void loadSpotifySDK()
      .then(async (sdk) => {
        if (!current()) return;
        engine = new SpotifyPlayback(
          sdk,
          link.url,
          musicGain(volumeRef.current),
          {
            ready: () => {
              if (current()) {
                engine?.volume(musicGain(volumeRef.current));
                setReady(true);
                setError('');
              }
            },
            state: (state) => {
              if (current()) {
                setPlaying(state.playing);
                if (state.playing) setNeedsGesture(false);
                setPosition(state.position);
                setDuration(state.duration);
                setLocalTrack(state.track);
                setError('');
              }
            },
            error: (message) => {
              if (current()) {
                setPlaying(false);
                setError(message);
              }
            },
            autoplayBlocked: () => {
              if (current()) {
                setReady(true);
                setPlaying(false);
                setNeedsGesture(true);
                setError('');
              }
            },
            ended: () => {
              if (!current()) return;
              if (roomRef.current?.detail) {
                void roomRef.current.command('advance');
                return;
              }
              const next = adjacentPlayable(
                queueRef.current,
                link.url,
                1,
                true,
              );
              if (next) play({ ...next, playback: 'spotify' });
              else engine?.repeat();
            },
          },
        );
        spotify.current = engine;
        await engine.connect();
      })
      .catch((error) => {
        if (current()) setError((error as Error).message);
      });
    return () => {
      active = false;
      engine?.dispose();
      if (spotify.current === engine) spotify.current = null;
    };
  }, [link, retry, play]);
  useEffect(() => {
    if (link?.provider !== 'soundcloud' || !frame.current) return;
    soundUrl.current = '';
    clearStats();
    let active = true;
    const token = ++generation.current;
    const isCurrent = () => active && generation.current === token;
    let bound: Widget | null = null;
    let monitor: SoundCloudStateMonitor | null = null;
    let stateTimer: ReturnType<typeof setInterval> | undefined;
    let widgetReady = false;
    const confirmState = () => {
      if (isCurrent() && widgetReady) monitor?.refresh();
    };
    const onVisible = () => {
      if (!document.hidden) confirmState();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', confirmState);
    const timeout = setTimeout(() => {
      if (isCurrent()) {
        setError(
          'Не удалось загрузить запись. Проверьте соединение и повторите попытку.',
        );
      }
    }, 20000);
    let nativeIndex = 0,
      nativeLength = 0;
    const beginSession = (currentUrl: string) => {
      clearStats();
      tracker.current = new MusicListenTracker(
        musicRequest,
        (state) => {
          if (isCurrent()) setListening(state);
        },
        () => window.dispatchEvent(new Event('noctgram:music-refresh')),
      );
      void tracker.current.start(currentUrl);
    };
    const preferenceChanged = () => {
      if (soundUrl.current) beginSession(soundUrl.current);
    };
    window.addEventListener('noctgram:music-preferences', preferenceChanged);
    void loadSoundCloudWidget()
      .then((sc) => {
        if (!isCurrent() || !frame.current) return;
        const w = sc.Widget(frame.current);
        if (loadedFrame.current === frame.current) {
          // load must precede READY binding: an already-ready widget invokes
          // newly bound READY listeners immediately, with the previous sound.
          w.load(link.url, {
            auto_play: roomRef.current?.detail?.playback.playing !== 0,
            show_artwork: false,
          });
        }
        loadedFrame.current = frame.current;
        bound = w;
        widget.current = w;
        monitor = new SoundCloudStateMonitor(
          w,
          (active) => {
            if (!isCurrent()) return;
            if (isPlaying.current !== active) tracker.current?.resetPosition();
            isPlaying.current = active;
            setPlaying(active);
            if (active) setNeedsGesture(false);
          },
          (ms) => {
            if (isCurrent()) setPosition(ms);
          },
        );
        soundCloudState.current = monitor;
        const syncSound = () => {
          w.getCurrentSound((value) => {
            if (!isCurrent() || !value) return;
            const current = parseMusicLink(value.permalink_url);
            setSound(value);
            setDuration(value.duration || 0);
            if (
              current?.provider === 'soundcloud' &&
              soundUrl.current !== current.url
            ) {
              soundUrl.current = current.url;
              clearStats();
              // Account eligibility is checked again server-side before counting.
              beginSession(current.url);
            }
          });
          w.getCurrentSoundIndex((i) => {
            if (isCurrent()) {
              nativeIndex = i;
              setPlaylistIndex(i);
            }
          });
        };
        w.bind(sc.Widget.Events.READY, () => {
          if (!isCurrent()) return;
          clearTimeout(timeout);
          widgetReady = true;
          if (!stateTimer) stateTimer = setInterval(confirmState, 250);
          setReady(true);
          setError('');
          w.setVolume(musicGain(volumeRef.current) * 100);
          w.getSounds((sounds) => {
            if (isCurrent()) {
              nativeLength = sounds.length;
              loadedSounds.current = sounds;
              setPlaylistLength(sounds.length);
              setPlaylistSounds(sounds);
            }
          });
          w.getDuration((ms) => {
            if (isCurrent()) setDuration(ms);
          });
          syncSound();
          // A paused room must not briefly start playing when its frame loads.
          if (roomRef.current?.detail?.playback.playing === 0)
            setNeedsGesture(false);
          else w.play();
        });
        w.bind(sc.Widget.Events.PLAY, () => {
          if (isCurrent()) {
            monitor?.playing(true);
            setNeedsGesture(false);
            setError('');
            tracker.current?.resetPosition();
            syncSound();
          }
        });
        w.bind(sc.Widget.Events.PAUSE, () => {
          if (isCurrent()) {
            monitor?.playing(false);
            tracker.current?.resetPosition();
          }
        });
        w.bind(sc.Widget.Events.SEEK, () => {
          if (isCurrent()) {
            monitor?.invalidate();
            tracker.current?.resetPosition();
          }
        });
        w.bind(sc.Widget.Events.PLAY_PROGRESS, (event) => {
          if (!isCurrent() || typeof event?.currentPosition !== 'number')
            return;
          monitor?.position(event.currentPosition);
          tracker.current?.sample(event.currentPosition, isPlaying.current);
        });
        w.bind(sc.Widget.Events.FINISH, () => {
          if (!isCurrent()) return;
          monitor?.playing(false);
          tracker.current?.resetPosition();
          if (roomRef.current?.detail) {
            void roomRef.current.command('advance');
            return;
          }
          if (desired.current?.kind === 'playlist') {
            if (nativeOrder.current) {
              const next = adjacentPlayable(
                nativeOrder.current,
                soundUrl.current,
              );
              if (next) play(next);
              else {
                w.seekTo(0);
                w.play();
              }
              return;
            }
            if (nativeIndex + 1 >= nativeLength) {
              w.skip(0);
              w.seekTo(0);
              w.play();
            }
            return;
          }
          const next = adjacentPlayable(
            queueRef.current,
            desired.current?.url || '',
          );
          if (next) play(next);
          else {
            // A single playable song repeats itself.
            w.seekTo(0);
            w.play();
          }
        });
        w.bind(sc.Widget.Events.ERROR, () => {
          if (!isCurrent()) return;
          clearTimeout(timeout);
          monitor?.playing(false);
          monitor?.dispose();
          clearStats();
          setError(
            'SoundCloud не может воспроизвести эту запись. Она может быть удалена или недоступна в вашем регионе.',
          );
        });
      })
      .catch((e) => {
        if (isCurrent()) {
          clearTimeout(timeout);
          setError((e as Error).message);
        }
      });
    return () => {
      active = false;
      monitor?.dispose();
      if (soundCloudState.current === monitor) soundCloudState.current = null;
      clearInterval(stateTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', confirmState);
      tracker.current?.dispose();
      clearTimeout(timeout);
      window.removeEventListener(
        'noctgram:music-preferences',
        preferenceChanged,
      );
      if (bound) {
        releaseSoundCloudWidget(bound, window.SC?.Widget.Events || {});
      }
      widget.current = null;
    };
  }, [link, retry, play]);
  useEffect(() => {
    if (
      link?.provider !== 'spotify' ||
      link.playback !== 'file' ||
      !audio.current
    )
      return;
    const element = audio.current;
    const token = ++generation.current;
    const controller = new AbortController();
    let active = true;
    const current = () => active && generation.current === token;
    const beginSession = () => {
      clearStats();
      tracker.current = new MusicListenTracker(
        musicRequest,
        (state) => {
          if (current()) setListening(state);
        },
        () => window.dispatchEvent(new Event('noctgram:music-refresh')),
      );
      void tracker.current.start(link.url);
    };
    const preferenceChanged = () => {
      if (element.currentSrc) beginSession();
    };
    window.addEventListener('noctgram:music-preferences', preferenceChanged);
    const attemptPlay = () => {
      void element
        .play()
        .then(() => {
          // A queue tap can start the persistent audio element before this
          // track's listeners are attached; confirm the real state as well.
          if (current() && !element.paused) started();
        })
        .catch((error: DOMException) => {
          if (current() && error.name === 'NotAllowedError')
            setNeedsGesture(true);
          if (
            current() &&
            error.name !== 'NotAllowedError' &&
            error.name !== 'AbortError'
          )
            setError(
              'Не удалось воспроизвести файл. Попробуйте другой аудиофайл.',
            );
        });
    };
    const loaded = () => {
      if (!current()) return;
      if (!Number.isFinite(element.duration) || element.duration <= 0) {
        setError('Не удалось прочитать длительность аудио.');
        return;
      }
      setDuration(Math.round(element.duration * 1000));
      setReady(true);
      setError('');
      if (roomRef.current?.detail?.playback.playing !== 0) attemptPlay();
      else setNeedsGesture(false);
    };
    const progress = () => {
      if (current()) {
        setPosition(element.currentTime * 1000);
        tracker.current?.sample(
          element.currentTime * 1000,
          !element.paused && !element.seeking,
        );
      }
    };
    const started = () => {
      if (current()) {
        tracker.current?.resetPosition();
        setPlaying(true);
        setNeedsGesture(false);
        setError('');
      }
    };
    const paused = () => {
      if (current()) {
        tracker.current?.resetPosition();
        setPlaying(false);
      }
    };
    const failed = () => {
      if (current()) {
        setPlaying(false);
        clearStats();
        setError(
          'Аудиофайл недоступен или браузер не поддерживает его формат.',
        );
      }
    };
    const ended = () => {
      if (!current()) return;
      setPlaying(false);
      tracker.current?.resetPosition();
      if (roomRef.current?.detail) {
        void roomRef.current.command('advance');
        return;
      }
      const next = adjacentPlayable(queueRef.current, link.url);
      if (next) play(next);
      else {
        element.currentTime = 0;
        attemptPlay();
      }
    };
    const seeking = () => tracker.current?.resetPosition();
    element.addEventListener('seeking', seeking);
    element.addEventListener('loadedmetadata', loaded);
    element.addEventListener('timeupdate', progress);
    element.addEventListener('play', started);
    element.addEventListener('pause', paused);
    element.addEventListener('error', failed);
    element.addEventListener('ended', ended);
    element.volume = musicGain(volumeRef.current);
    void fetch('/api/music?action=track&url=' + encodeURIComponent(link.url), {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const data = (await response.json()) as MusicTrack & { error?: string };
        if (!response.ok)
          throw new Error(data.error || 'Не удалось загрузить трек.');
        if (!current()) return;
        setLocalTrack(data);
        setDuration(data.durationMs || 0);
        if (
          !data.audioUrl ||
          !/^\/api\/music\/audio\/[a-f0-9-]{36}$/.test(data.audioUrl)
        )
          throw new Error(
            'Добавьте аудиофайл к этому треку в «Моей музыке». Ссылка Spotify содержит сведения о песне, но не само аудио.',
          );
        beginSession();
        if (element.getAttribute('src') !== data.audioUrl) {
          element.src = data.audioUrl;
          element.load();
        }
        if (roomRef.current?.detail?.playback.playing !== 0) attemptPlay();
        if (element.readyState >= 1) loaded();
      })
      .catch((error: Error) => {
        if (current() && error.name !== 'AbortError') setError(error.message);
      });
    return () => {
      active = false;
      tracker.current?.dispose();
      window.removeEventListener(
        'noctgram:music-preferences',
        preferenceChanged,
      );
      element.removeEventListener('seeking', seeking);
      controller.abort();
      element.removeEventListener('loadedmetadata', loaded);
      element.removeEventListener('timeupdate', progress);
      element.removeEventListener('play', started);
      element.removeEventListener('pause', paused);
      element.removeEventListener('error', failed);
      element.removeEventListener('ended', ended);
      if (desired.current?.playback !== 'file') {
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
    };
  }, [link, retry, play]);
  useEffect(() => {
    if (link?.provider !== 'youtube' || !youtubeHost.current) return;
    const token = ++generation.current;
    let active = true;
    let engine: YouTubePlayback | null = null;
    const current = () => active && generation.current === token;
    clearStats();
    setListening({ status: 'excluded', seconds: 0 });
    const known = link as MusicTrack;
    if (known.title) setLocalTrack(known);
    else
      void musicRequest<MusicTrack>('resolve', { url: link.url })
        .then((track) => {
          if (current()) setLocalTrack(track);
        })
        .catch(() => {
          /* Video remains playable if metadata is temporarily unavailable. */
        });
    void loadYouTubeSDK()
      .then((sdk) => {
        if (!current() || !youtubeHost.current) return;
        const hooks: ConstructorParameters<typeof YouTubePlayback>[4] = {
          ready: () => {
            if (!current()) return;
            engine?.volume(youtubeVolume(volumeRef.current));
            setReady(true);
            setError('');
            if (roomRef.current?.detail?.playback.playing === 0)
              setNeedsGesture(false);
          },
          state: (state) => {
            if (!current()) return;
            setPlaying(state.playing);
            setPosition(state.position);
            setDuration(state.duration);
            const nextVolume = volumeFromYouTube(
              state.volume,
              volumeRef.current,
            );
            volumeRef.current = nextVolume;
            setVolume(nextVolume);
            if (state.playing) {
              setNeedsGesture(false);
              setError('');
            }
          },
          blocked: () => {
            if (current()) {
              setNeedsGesture(true);
              setPlaying(false);
            }
          },
          error: (message) => {
            if (current()) {
              setError(message);
              setPlaying(false);
            }
          },
          shouldPlay: () => roomRef.current?.detail?.playback.playing !== 0,
          control: (command, extra) => {
            if (current() && roomRef.current?.detail)
              void roomRef.current.command(command, extra);
          },
          ended: () => {
            if (!current()) return;
            if (roomRef.current?.detail) {
              void roomRef.current.command('advance');
              return;
            }
            const next = adjacentPlayable(queueRef.current, link.url);
            if (next) play(next);
            else {
              engine?.seek(0);
              engine?.resume();
            }
          },
        };
        const id = new URL(link.url).searchParams.get('v')!;
        engine = youtube.current;
        if (!engine?.load(id, hooks)) {
          engine?.dispose();
          engine = new YouTubePlayback(
            sdk,
            youtubeHost.current,
            id,
            youtubeVolume(volumeRef.current),
            hooks,
          );
        }
        youtube.current = engine;
      })
      .catch((e) => {
        if (current()) setError((e as Error).message);
      });
    return () => {
      active = false;
      if (desired.current?.provider !== 'youtube') {
        engine?.dispose();
        if (youtube.current === engine) youtube.current = null;
      }
    };
  }, [link, retry, play]);
  const queueIndex = queue.findIndex(
    (x) => x.url === (nativeOrder.current ? sound?.permalink_url : link?.url),
  );
  const adjacent = (direction = 1) => {
    return adjacentPlayable(
      queue,
      (nativeOrder.current ? sound?.permalink_url : link?.url) || '',
      direction,
      link?.playback === 'spotify',
    );
  };
  const previous = () => {
    if (roomRef.current?.detail) {
      roomStep(-1);
      return;
    }
    if (link?.kind === 'playlist' && !nativeOrder.current) {
      if (playlistIndex <= 0)
        widget.current?.skip(Math.max(0, playlistLength - 1));
      else widget.current?.prev();
      widget.current?.play();
    } else {
      const item = adjacent(-1);
      if (item) play(item);
    }
  };
  const next = () => {
    if (roomRef.current?.detail) {
      roomStep(1);
      return;
    }
    if (link?.kind === 'playlist' && !nativeOrder.current) {
      if (playlistIndex + 1 >= playlistLength) widget.current?.skip(0);
      else widget.current?.next();
      widget.current?.play();
    } else {
      const item = adjacent();
      if (item) play(item);
    }
  };
  const currentUrl = sound?.permalink_url || link?.url || '';
  const metadata = (item: MusicLink): PlayerTrack => {
    const known = item as MusicLink & {
      title?: string;
      artist?: string;
      artwork?: string;
    };
    return {
      url: item.url,
      provider: item.provider,
      title: known.title || musicLabel(item),
      artist: known.artist || '',
      artwork: known.artwork || '',
    };
  };
  const selected = queue.find((item) => item.url === link?.url);
  const track: PlayerTrack = {
    url: currentUrl,
    provider: link?.provider || 'soundcloud',
    title:
      localTrack?.title ||
      sound?.title ||
      (selected ? metadata(selected).title : link ? musicLabel(link) : ''),
    artist:
      localTrack?.artist ||
      sound?.user?.username ||
      (selected ? metadata(selected).artist : ''),
    artwork:
      localTrack?.artwork ||
      sound?.artwork_url ||
      (selected ? metadata(selected).artwork : ''),
  };
  const room = useMusicRoom({
    url: currentUrl,
    playing,
    ready,
    error,
    blocked: needsGesture,
    position,
    duration,
    play,
    stop,
    setPlaying: (active) => {
      soundCloudState.current?.invalidate();
      if (link?.provider === 'youtube') {
        if (active) youtube.current?.resume();
        else youtube.current?.pause();
      } else if (link?.playback === 'spotify') {
        if (active) spotify.current?.resume();
        else spotify.current?.pause();
      } else if (link?.provider === 'spotify' && audio.current) {
        if (active)
          void audio.current
            .play()
            .catch(() =>
              setError('Нажмите воспроизведение, чтобы разрешить звук'),
            );
        else audio.current.pause();
      } else if (active) widget.current?.play();
      else widget.current?.pause();
    },
    seek: (ms) => {
      soundCloudState.current?.invalidate();
      const value = Math.max(0, Math.min(ms, duration));
      tracker.current?.resetPosition();
      setPosition(value);
      if (link?.provider === 'youtube') youtube.current?.seek(value);
      else if (link?.playback === 'spotify') spotify.current?.seek(value);
      else if (link?.provider === 'spotify' && audio.current)
        audio.current.currentTime = value / 1000;
      else widget.current?.seekTo(value);
    },
  });
  roomRef.current = room;
  const playPersonal = useCallback(
    (next: MusicLink, nextQueue?: MusicLink[]) => {
      roomRef.current?.leave();
      play(next, nextQueue);
    },
    [play],
  );
  const stopPersonal = useCallback(() => {
    roomRef.current?.leave();
    stop();
  }, [stop]);
  const context = useMemo(
    () => ({
      play: playPersonal,
      currentUrl,
      playing,
      stop: stopPersonal,
      room,
    }),
    [playPersonal, currentUrl, playing, stopPersonal, room],
  );
  const playback = useMemo(
    () => ({ ready: ready && !error && !needsGesture, position, duration }),
    [ready, error, needsGesture, position, duration],
  );
  function roomStep(direction: number) {
    const detail = roomRef.current?.detail;
    if (!detail?.tracks.length) return;
    const index = detail.tracks.findIndex(
      (t) => t.id === detail.playback.trackId,
    );
    const target =
      detail.tracks[
        (index + direction + detail.tracks.length) % detail.tracks.length
      ];
    void roomRef.current?.command('play', { trackId: target.id });
  }
  const displayQueue = room.detail
    ? room.detail.tracks.map(metadata)
    : link?.kind === 'playlist' && !nativeOrder.current
      ? playlistSounds.map((item) => ({
          url: item.permalink_url,
          title: item.title,
          artist: item.user?.username || '',
          artwork: item.artwork_url || '',
        }))
      : queue.map((item) => (item.url === currentUrl ? track : metadata(item)));
  const select = (index: number) => {
    if (room.detail) {
      const target = room.detail.tracks[index];
      if (target) void room.command('play', { trackId: target.id });
      return;
    }
    if (link?.kind === 'playlist' && !nativeOrder.current) {
      if (index >= 0 && index < playlistSounds.length) {
        widget.current?.skip(index);
        widget.current?.play();
      }
    } else if (queue[index]) play(queue[index]);
  };
  const reorderQueue = async (fromUrl: string, toUrl: string) => {
    const activeRoom = roomRef.current;
    if (activeRoom?.detail) {
      const from = activeRoom.detail.tracks.find((t) => t.url === fromUrl);
      const to = activeRoom.detail.tracks.find((t) => t.url === toUrl);
      if (from && to) await activeRoom.reorder(from.id, to.id);
      return;
    }
    const current =
      link?.kind === 'playlist' && !nativeOrder.current
        ? playlistSounds.map((item) => ({
            url: item.permalink_url,
            kind: 'track' as const,
            provider: 'soundcloud' as const,
            title: item.title,
            artist: item.user?.username || '',
            artwork: item.artwork_url || '',
          }))
        : queueRef.current;
    const reordered = moveMusicItem(
      current,
      current.findIndex((t) => t.url === fromUrl),
      current.findIndex((t) => t.url === toUrl),
    );
    queueRef.current = reordered;
    if (link?.kind === 'playlist') nativeOrder.current = reordered;
    setQueue(reordered);
  };
  const togglePlayer = () => {
    if (!link) return;
    soundCloudState.current?.invalidate();
    if (needsGesture) {
      if (room.detail && !room.detail.playback.playing)
        void room.command('resume');
      if (link.provider === 'youtube') youtube.current?.resume();
      else if (link.playback === 'spotify') spotify.current?.resume();
      else if (link.playback === 'file')
        void audio.current?.play().catch(() => setNeedsGesture(true));
      else widget.current?.play();
      return;
    }
    if (room.detail) {
      void room.command(room.detail.playback.playing ? 'pause' : 'resume');
      return;
    }
    if (link.provider === 'youtube') {
      if (playing) youtube.current?.pause();
      else youtube.current?.resume();
    } else if (link.playback === 'spotify') spotify.current?.toggle();
    else if (link.provider === 'spotify' && audio.current) {
      if (playing) audio.current.pause();
      else
        void audio.current
          .play()
          .catch(() =>
            setError('Не удалось запустить файл. Попробуйте ещё раз.'),
          );
    } else if (playing) widget.current?.pause();
    else widget.current?.play();
  };
  const seekPlayer = (ms: number) => {
    if (!link) return;
    soundCloudState.current?.invalidate();
    if (room.detail) {
      void room.command('seek', { positionMs: ms });
      return;
    }
    const value = Math.max(0, Math.min(ms, duration));
    tracker.current?.resetPosition();
    setPosition(value);
    if (link.provider === 'youtube') youtube.current?.seek(value);
    else if (link.playback === 'spotify') spotify.current?.seek(value);
    else if (link.provider === 'spotify' && audio.current)
      audio.current.currentTime = value / 1000;
    else widget.current?.seekTo(value);
  };
  const changeVolume = (value: number) => {
    if (!link) return;
    value = clampMusicVolume(value);
    volumeRef.current = value;
    setVolume(value);
    try {
      localStorage.setItem('noctgram:music-volume', String(value));
    } catch {
      /* Optional. */
    }
    if (link.provider === 'youtube')
      youtube.current?.volume(youtubeVolume(value));
    else if (link.playback === 'spotify')
      spotify.current?.volume(musicGain(value));
    else if (link.provider === 'spotify' && audio.current)
      audio.current.volume = musicGain(value);
    else widget.current?.setVolume(musicGain(value) * 100);
  };
  return (
    <MusicContext.Provider value={context}>
      <MusicPlaybackContext.Provider value={playback}>
        {children}
      </MusicPlaybackContext.Provider>
      {link && (
        <MusicActivityPublisher
          track={track}
          playing={playing}
          ready={ready && !error && !needsGesture}
          position={position}
          duration={duration}
        />
      )}
      {link && (
        <>
          <MusicPlayerView
            roomName={room.detail?.name}
            roomError={room.error}
            onLeaveRoom={room.leave}
            track={track}
            queue={displayQueue}
            queueIndex={
              room.detail
                ? room.detail.tracks.findIndex((t) => t.url === currentUrl)
                : link.kind === 'playlist' && !nativeOrder.current
                  ? playlistIndex
                  : queueIndex
            }
            expanded={expanded}
            onExpanded={setExpanded}
            playing={playing}
            ready={ready}
            error={error}
            needsGesture={needsGesture}
            position={position}
            duration={duration}
            volume={volume}
            listening={listening}
            playerRef={playerElement}
            previousEnabled={
              room.detail
                ? room.detail.tracks.length > 0
                : link.kind === 'playlist' && !nativeOrder.current
                  ? playlistLength > 0
                  : !!adjacent(-1)
            }
            nextEnabled={
              room.detail
                ? room.detail.tracks.length > 0
                : link.kind === 'playlist' && !nativeOrder.current
                  ? playlistLength > 0
                  : !!adjacent()
            }
            onPrevious={previous}
            onNext={next}
            onSelect={select}
            onReorder={reorderQueue}
            onToggle={togglePlayer}
            onSeek={seekPlayer}
            onVolume={changeVolume}
            onStop={stopPersonal}
            onRetry={() => {
              setError('');
              setReady(false);
              setNeedsGesture(true);
              setRetry((value) => value + 1);
            }}
          />
          {/* Keep one engine mounted outside the dialog: collapsing never restarts audio. */}
          {link.provider === 'youtube' ? (
            <div
              ref={youtubeHost}
              className="music-audio-engine"
              aria-hidden="true"
              inert
            />
          ) : link.provider === 'spotify' ? (
            link.playback === 'file' ? (
              // Lyrics, when available, are rendered in the accessible Text pane.
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio ref={audio} preload="metadata" />
            ) : null
          ) : link.provider === 'soundcloud' ? (
            <iframe
              ref={frame}
              className="music-audio-engine"
              title="Аудиодвижок SoundCloud"
              tabIndex={-1}
              aria-hidden="true"
              allow="autoplay"
              src={
                'https://w.soundcloud.com/player/?' +
                new URLSearchParams({
                  url: soundCloudSource,
                  auto_play: 'false',
                  color: '#eeeeee',
                  show_artwork: 'false',
                  show_user: 'false',
                  sharing: 'false',
                  buying: 'false',
                  download: 'false',
                  show_playcount: 'false',
                })
              }
            />
          ) : null}
        </>
      )}
    </MusicContext.Provider>
  );
}
