'use client';
/* Provider subscriptions update state from real SoundCloud events. */
/* eslint-disable react/react-compiler, next/no-img-element */
import {
  createContext,
  useCallback,
  useContext,
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
  type SoundCloudSound,
  type Widget,
} from '@/lib/soundcloud-widget';
import { MusicPlayerView, type PlayerTrack } from './music-player-view';
import {
  MusicListenTracker,
  adjacentPlayable,
  type ListenState,
} from '@/lib/music-listening';

type Context = {
  play: (link: MusicLink, queue?: MusicLink[]) => void;
  currentUrl: string;
  playing: boolean;
  stop: () => void;
};
const MusicContext = createContext<Context | null>(null);
export function useMusic() {
  return useContext(MusicContext);
}
export function MusicAccountGuard({ blocked }: { blocked: boolean }) {
  const stop = useMusic()?.stop;
  useEffect(() => {
    if (blocked) stop?.();
  }, [blocked, stop]);
  return null;
}
export function MusicProvider({ children }: { children: ReactNode }) {
  const [link, setLink] = useState<MusicLink | null>(null);
  const [sound, setSound] = useState<SoundCloudSound | null>(null);
  const [localTrack, setLocalTrack] = useState<MusicTrack | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false);
  const [error, setError] = useState(''),
    [position, setPosition] = useState(0),
    [duration, setDuration] = useState(0);
  const [expanded, setExpanded] = useState(false),
    [volume, setVolume] = useState(70),
    [retry, setRetry] = useState(0);
  const [playlistIndex, setPlaylistIndex] = useState(0),
    [playlistLength, setPlaylistLength] = useState(0);
  const [playlistSounds, setPlaylistSounds] = useState<SoundCloudSound[]>([]);
  const [queue, setQueue] = useState<MusicLink[]>([]);
  const frame = useRef<HTMLIFrameElement>(null),
    widget = useRef<Widget | null>(null);
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
  }, [hasPlayer]);
  const desired = useRef<MusicLink | null>(null),
    queueRef = useRef<MusicLink[]>([]),
    soundUrl = useRef('');
  const generation = useRef(0),
    isPlaying = useRef(false),
    volumeRef = useRef(volume);
  const tracker = useRef<MusicListenTracker | null>(null);
  const [listening, setListening] = useState<ListenState>({
    status: 'idle',
    seconds: 0,
  });
  volumeRef.current = volume;
  useEffect(() => {
    try {
      const saved = localStorage.getItem('noctgram:music-volume');
      const value = Number(saved);
      if (saved !== null && Number.isFinite(value))
        setVolume(Math.max(0, Math.min(100, Math.round(value))));
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
    generation.current++;
    widget.current?.pause();
    audio.current?.pause();
    desired.current = null;
    soundUrl.current = '';
    clearStats();
    isPlaying.current = false;
    setPlaying(false);
    setLink(null);
    setExpanded(false);
    setSound(null);
    setLocalTrack(null);
    setError('');
    setReady(false);
  }, []);
  const play = useCallback((next: MusicLink, nextQueue?: MusicLink[]) => {
    const valid = parseMusicLink(next.url);
    if (!valid) return;
    if (nextQueue) {
      queueRef.current = nextQueue;
      setQueue(nextQueue);
    } else if (!queueRef.current.some((item) => item.url === valid.url)) {
      queueRef.current = [valid];
      setQueue([valid]);
    }
    if (desired.current?.url === valid.url && widget.current) {
      widget.current.play();
      return;
    }
    if (
      desired.current?.url === valid.url &&
      valid.provider === 'spotify' &&
      audio.current?.currentSrc
    ) {
      void audio.current
        .play()
        .catch(() =>
          setError('Не удалось запустить аудио. Нажмите «Повторить».'),
        );
      return;
    }
    generation.current++;
    widget.current?.pause();
    audio.current?.pause();
    clearStats();
    soundUrl.current = '';
    desired.current = valid;
    isPlaying.current = false;
    setPlaying(false);
    setReady(false);
    setError('');
    setSound(null);
    setLocalTrack(null);
    setPosition(0);
    setDuration(0);
    setPlaylistIndex(0);
    setPlaylistLength(0);
    setPlaylistSounds([]);
    setLink(valid);
  }, []);
  useEffect(() => {
    if (link?.provider !== 'soundcloud' || !frame.current) return;
    soundUrl.current = '';
    clearStats();
    let active = true;
    const token = ++generation.current;
    let bound: Widget | null = null;
    const timeout = setTimeout(() => {
      if (active) {
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
          if (active && generation.current === token) setListening(state);
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
        if (!active || !frame.current) return;
        const w = sc.Widget(frame.current);
        bound = w;
        widget.current = w;
        const syncSound = () => {
          w.getCurrentSound((value) => {
            if (!active || !value) return;
            const current = parseMusicLink(value.permalink_url);
            setSound(value);
            setDuration(value.duration || 0);
            if (
              current?.provider === 'soundcloud' &&
              soundUrl.current !== current.url
            ) {
              soundUrl.current = current.url;
              clearStats();
              // Opt-in is checked server-side before metadata or listening history is stored.
              beginSession(current.url);
            }
          });
          w.getCurrentSoundIndex((i) => {
            if (active) {
              nativeIndex = i;
              setPlaylistIndex(i);
            }
          });
        };
        w.bind(sc.Widget.Events.READY, () => {
          if (!active) return;
          clearTimeout(timeout);
          setReady(true);
          setError('');
          w.setVolume(volumeRef.current);
          w.getSounds((sounds) => {
            if (active) {
              nativeLength = sounds.length;
              setPlaylistLength(sounds.length);
              setPlaylistSounds(sounds);
            }
          });
          w.getDuration((ms) => {
            if (active) setDuration(ms);
          });
          syncSound();
          // If autoplay is blocked, our Play control lets the user try again.
          w.play();
        });
        w.bind(sc.Widget.Events.PLAY, () => {
          if (active) {
            isPlaying.current = true;
            setPlaying(true);
            setError('');
            tracker.current?.resetPosition();
            syncSound();
          }
        });
        w.bind(sc.Widget.Events.PAUSE, () => {
          if (active) {
            isPlaying.current = false;
            setPlaying(false);
            tracker.current?.resetPosition();
          }
        });
        w.bind(sc.Widget.Events.SEEK, () => {
          tracker.current?.resetPosition();
        });
        w.bind(sc.Widget.Events.PLAY_PROGRESS, (event) => {
          if (!active || typeof event?.currentPosition !== 'number') return;
          setPosition(event.currentPosition);
          tracker.current?.sample(event.currentPosition, isPlaying.current);
        });
        w.bind(sc.Widget.Events.FINISH, () => {
          if (!active) return;
          isPlaying.current = false;
          setPlaying(false);
          tracker.current?.resetPosition();
          if (
            desired.current?.kind === 'playlist' &&
            nativeIndex + 1 < nativeLength
          )
            return;
          const next = adjacentPlayable(
            queueRef.current,
            desired.current?.url || '',
          );
          if (next) play(next);
          else {
            // At the end of either queue, keep the current song playing.
            w.seekTo(0);
            w.play();
          }
        });
        w.bind(sc.Widget.Events.ERROR, () => {
          if (!active) return;
          clearTimeout(timeout);
          isPlaying.current = false;
          setPlaying(false);
          clearStats();
          setError(
            'SoundCloud не может воспроизвести эту запись. Она может быть удалена или недоступна в вашем регионе.',
          );
        });
      })
      .catch((e) => {
        if (active) {
          clearTimeout(timeout);
          setError((e as Error).message);
        }
      });
    return () => {
      active = false;
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
    if (link?.provider !== 'spotify' || !audio.current) return;
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
      void element.play().catch((error: DOMException) => {
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
      attemptPlay();
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
    element.volume = volumeRef.current / 100;
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
        element.src = data.audioUrl;
        element.load();
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
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [link, retry, play]);
  const queueIndex = queue.findIndex((x) => x.url === link?.url);
  const previous = () => {
    if (link?.kind === 'playlist') widget.current?.prev();
    else {
      const item = adjacentPlayable(queue, link?.url || '', -1);
      if (item) play(item);
    }
  };
  const next = () => {
    if (link?.kind === 'playlist') widget.current?.next();
    else {
      const item = adjacentPlayable(queue, link?.url || '');
      if (item) play(item);
    }
  };
  const currentUrl = sound?.permalink_url || link?.url || '';
  const context = useMemo(
    () => ({ play, currentUrl, playing, stop }),
    [play, currentUrl, playing, stop],
  );
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
  const displayQueue =
    link?.kind === 'playlist'
      ? playlistSounds.map((item) => ({
          url: item.permalink_url,
          title: item.title,
          artist: item.user?.username || '',
          artwork: item.artwork_url || '',
        }))
      : queue.map((item) => (item.url === currentUrl ? track : metadata(item)));
  const select = (index: number) => {
    if (link?.kind === 'playlist') {
      if (index >= 0 && index < playlistSounds.length) {
        widget.current?.skip(index);
        widget.current?.play();
      }
    } else if (queue[index]) play(queue[index]);
  };
  return (
    <MusicContext.Provider value={context}>
      {children}
      {link && (
        <>
          <MusicPlayerView
            track={track}
            queue={displayQueue}
            queueIndex={link.kind === 'playlist' ? playlistIndex : queueIndex}
            expanded={expanded}
            onExpanded={setExpanded}
            playing={playing}
            ready={ready}
            error={error}
            position={position}
            duration={duration}
            volume={volume}
            listening={listening}
            playerRef={playerElement}
            previousEnabled={
              link.kind === 'playlist'
                ? playlistIndex > 0
                : !!adjacentPlayable(queue, link.url, -1)
            }
            nextEnabled={
              link.kind === 'playlist'
                ? playlistIndex + 1 < playlistLength
                : !!adjacentPlayable(queue, link.url)
            }
            onPrevious={previous}
            onNext={next}
            onSelect={select}
            onToggle={() => {
              if (link.provider === 'spotify' && audio.current) {
                if (playing) audio.current.pause();
                else
                  void audio.current
                    .play()
                    .catch(() =>
                      setError(
                        'Не удалось запустить файл. Попробуйте ещё раз.',
                      ),
                    );
              } else if (playing) widget.current?.pause();
              else widget.current?.play();
            }}
            onSeek={(ms) => {
              const value = Math.max(0, Math.min(ms, duration));
              tracker.current?.resetPosition();
              setPosition(value);
              if (link.provider === 'spotify' && audio.current)
                audio.current.currentTime = value / 1000;
              else widget.current?.seekTo(value);
            }}
            onVolume={(value) => {
              setVolume(value);
              try {
                localStorage.setItem('noctgram:music-volume', String(value));
              } catch {
                /* Optional. */
              }
              if (link.provider === 'spotify' && audio.current)
                audio.current.volume = value / 100;
              else widget.current?.setVolume(value);
            }}
            onStop={stop}
            onRetry={() => {
              setError('');
              setReady(false);
              setRetry((value) => value + 1);
            }}
          />
          {/* Keep one engine mounted outside the dialog: collapsing never restarts audio. */}
          {link.provider === 'spotify' ? (
            // Lyrics, when available, are rendered in the accessible Text pane.
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio ref={audio} preload="metadata" />
          ) : (
            <iframe
              key={link.url + ':' + retry}
              ref={frame}
              className="music-audio-engine"
              title="Аудиодвижок SoundCloud"
              tabIndex={-1}
              aria-hidden="true"
              allow="autoplay"
              src={
                'https://w.soundcloud.com/player/?' +
                new URLSearchParams({
                  url: link.url,
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
          )}
        </>
      )}
    </MusicContext.Provider>
  );
}
