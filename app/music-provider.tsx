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
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import {
  formatMusicTime,
  musicLabel,
  musicRequest,
  parseMusicLink,
  type MusicLink,
} from '@/lib/music-links';
import {
  loadSoundCloudWidget,
  type SoundCloudSound,
  type Widget,
} from '@/lib/soundcloud-widget';
import { Slider } from '@/components/ui/slider';

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
  const stats = useRef({
    session: '',
    total: 0,
    sent: 0,
    lastPosition: -1,
    lastTime: 0,
    busy: false,
  });
  volumeRef.current = volume;
  const clearStats = () => {
    stats.current = {
      session: '',
      total: 0,
      sent: 0,
      lastPosition: -1,
      lastTime: 0,
      busy: false,
    };
  };
  const stop = useCallback(() => {
    generation.current++;
    widget.current?.pause();
    desired.current = null;
    soundUrl.current = '';
    clearStats();
    isPlaying.current = false;
    setPlaying(false);
    setLink(null);
    setSound(null);
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
    generation.current++;
    widget.current?.pause();
    clearStats();
    soundUrl.current = '';
    desired.current = valid;
    isPlaying.current = false;
    setPlaying(false);
    setReady(false);
    setError('');
    setSound(null);
    setPosition(0);
    setDuration(0);
    setPlaylistIndex(0);
    setPlaylistLength(0);
    setLink(valid);
  }, []);
  useEffect(() => {
    if (!link || !frame.current) return;
    let active = true;
    const token = ++generation.current;
    let bound: Widget | null = null;
    const timeout = setTimeout(() => {
      if (active) {
        setExpanded(true);
        setError(
          'Не удалось загрузить запись. Откройте её в SoundCloud или повторите попытку.',
        );
      }
    }, 20000);
    const beginSession = (currentUrl: string) => {
      clearStats();
      void musicRequest<{ session: string | null }>('start', {
        url: currentUrl,
      })
        .then((r) => {
          if (
            active &&
            generation.current === token &&
            soundUrl.current === currentUrl
          ) {
            clearStats();
            stats.current.session = r.session || '';
          }
        })
        .catch(() => {
          /* Playback also works without chart participation. */
        });
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
            if (current && soundUrl.current !== current.url) {
              soundUrl.current = current.url;
              clearStats();
              // Opt-in is checked server-side before metadata or listening history is stored.
              beginSession(current.url);
            }
          });
          w.getCurrentSoundIndex((i) => {
            if (active) setPlaylistIndex(i);
          });
        };
        w.bind(sc.Widget.Events.READY, () => {
          if (!active) return;
          clearTimeout(timeout);
          setReady(true);
          setError('');
          w.setVolume(volumeRef.current);
          w.getSounds((sounds) => {
            if (active) setPlaylistLength(sounds.length);
          });
          w.getDuration((ms) => {
            if (active) setDuration(ms);
          });
          // A blocked autoplay leaves the real iframe controls available.
          w.play();
        });
        w.bind(sc.Widget.Events.PLAY, () => {
          if (active) {
            isPlaying.current = true;
            setPlaying(true);
            setError('');
            stats.current.lastPosition = -1;
            syncSound();
          }
        });
        w.bind(sc.Widget.Events.PAUSE, () => {
          if (active) {
            isPlaying.current = false;
            setPlaying(false);
            stats.current.lastPosition = -1;
          }
        });
        w.bind(sc.Widget.Events.SEEK, () => {
          stats.current.lastPosition = -1;
        });
        w.bind(sc.Widget.Events.PLAY_PROGRESS, (event) => {
          if (!active || typeof event?.currentPosition !== 'number') return;
          const p = event.currentPosition,
            now = performance.now(),
            s = stats.current;
          setPosition(p);
          const delta = p - s.lastPosition,
            elapsed = now - s.lastTime;
          if (
            isPlaying.current &&
            s.lastPosition >= 0 &&
            delta > 0 &&
            delta <= 2000 &&
            elapsed < 3000
          )
            s.total += Math.min(delta, elapsed);
          s.lastPosition = p;
          s.lastTime = now;
          if (s.session && !s.busy && s.total - s.sent >= 5000) {
            s.busy = true;
            const total = Math.floor(s.total);
            void musicRequest<{ counted: boolean }>('progress', {
              session: s.session,
              totalMs: total,
            })
              .then((r) => {
                s.sent = total;
                if (r.counted) {
                  s.session = '';
                  window.dispatchEvent(new Event('noctgram:music-refresh'));
                }
              })
              .catch(() => {
                s.session = '';
              })
              .finally(() => {
                s.busy = false;
              });
          }
        });
        w.bind(sc.Widget.Events.FINISH, () => {
          if (!active) return;
          isPlaying.current = false;
          setPlaying(false);
          clearStats();
          soundUrl.current = '';
          if (desired.current?.kind === 'playlist') return; // Native widget owns playlist advancement.
          const list = queueRef.current,
            index = list.findIndex((x) => x.url === desired.current?.url);
          if (index >= 0 && index + 1 < list.length) play(list[index + 1]);
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
      clearTimeout(timeout);
      window.removeEventListener(
        'noctgram:music-preferences',
        preferenceChanged,
      );
      if (bound) {
        for (const event of Object.values(window.SC?.Widget.Events || {}))
          bound.unbind(event);
        bound.pause();
      }
      widget.current = null;
    };
  }, [link, retry, play]);
  const queueIndex = queue.findIndex((x) => x.url === link?.url);
  const previous = () => {
    if (link?.kind === 'playlist') widget.current?.prev();
    else if (queueIndex > 0) play(queue[queueIndex - 1]);
  };
  const next = () => {
    if (link?.kind === 'playlist') widget.current?.next();
    else if (queueIndex >= 0 && queueIndex + 1 < queue.length)
      play(queue[queueIndex + 1]);
  };
  const title = sound?.title || (link ? musicLabel(link) : '');
  const url = sound?.permalink_url || link?.url || '';
  const currentUrl = sound?.permalink_url || link?.url || '';
  const context = useMemo(
    () => ({ play, currentUrl, playing, stop }),
    [play, currentUrl, playing, stop],
  );
  return (
    <MusicContext.Provider value={context}>
      {children}
      {link && (
        <section
          ref={playerElement}
          className={'music-player ' + (expanded ? 'expanded' : '')}
          aria-label="Музыкальный плеер"
        >
          <div className="music-player-row">
            <div className="music-cover">
              {sound?.artwork_url ? (
                <img src={sound.artwork_url} alt="" />
              ) : (
                <Headphones size={20} />
              )}
            </div>
            <div className="music-player-title">
              <strong>{title}</strong>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {sound?.user?.username || 'SoundCloud'} · SoundCloud{' '}
                <ExternalLink size={11} />
              </a>
            </div>
            <div className="music-transport">
              <button
                className="icon-button"
                aria-label="Предыдущий трек"
                disabled={
                  !ready ||
                  (link.kind === 'playlist'
                    ? playlistIndex <= 0
                    : queueIndex <= 0)
                }
                onClick={previous}
              >
                <SkipBack size={18} />
              </button>
              <button
                className="music-play"
                aria-label={playing ? 'Пауза' : 'Воспроизвести'}
                disabled={!ready || !!error}
                onClick={() =>
                  playing ? widget.current?.pause() : widget.current?.play()
                }
              >
                {!ready && !error ? (
                  <LoaderCircle className="spin" size={18} />
                ) : playing ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} />
                )}
              </button>
              <button
                className="icon-button"
                aria-label="Следующий трек"
                disabled={
                  !ready ||
                  (link.kind === 'playlist'
                    ? playlistIndex + 1 >= playlistLength
                    : queueIndex < 0 || queueIndex + 1 >= queue.length)
                }
                onClick={next}
              >
                <SkipForward size={18} />
              </button>
            </div>
            <button
              className="icon-button"
              aria-label={expanded ? 'Свернуть плеер' : 'Развернуть плеер'}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </button>
            <button
              className="icon-button"
              aria-label="Остановить и закрыть плеер"
              onClick={stop}
            >
              <X size={18} />
            </button>
          </div>
          <div className="music-progress">
            <span>{formatMusicTime(position)}</span>
            <Slider
              aria-label="Позиция воспроизведения"
              min={0}
              max={Math.max(duration, 1)}
              step={1000}
              value={[Math.min(position, duration)]}
              disabled={!ready || !duration || !!error}
              onValueChange={(values) => {
                const value = Array.isArray(values) ? values[0] : values;
                stats.current.lastPosition = -1;
                widget.current?.seekTo(value);
              }}
            />
            <span>{formatMusicTime(duration)}</span>
          </div>
          {error && (
            <div className="music-error" role="alert">
              {error}{' '}
              <button
                onClick={() => {
                  setError('');
                  setReady(false);
                  setRetry((v) => v + 1);
                }}
              >
                Повторить
              </button>
            </div>
          )}
          {!playing && ready && !expanded && !error && (
            <button className="music-muted" onClick={() => setExpanded(true)}>
              Открыть плеер SoundCloud
            </button>
          )}
          <div className="music-widget-area" hidden={!expanded}>
            <div className="music-volume">
              <span>Громкость</span>
              <Slider
                aria-label="Громкость"
                min={0}
                max={100}
                value={[volume]}
                onValueChange={(values) => {
                  const v = Array.isArray(values) ? values[0] : values;
                  setVolume(v);
                  widget.current?.setVolume(v);
                }}
              />
            </div>
            <iframe
              key={link.url + ':' + retry}
              ref={frame}
              title="Официальный плеер SoundCloud"
              width="100%"
              height="166"
              allow="autoplay"
              src={
                'https://w.soundcloud.com/player/?' +
                new URLSearchParams({
                  url: link.url,
                  auto_play: 'false',
                  color: '#eeeeee',
                  show_artwork: 'true',
                  show_user: 'true',
                })
              }
            />
            {!playing && ready && !error && (
              <p className="music-muted">
                Если браузер блокирует запуск, нажмите Play в плеере SoundCloud.
              </p>
            )}
          </div>
        </section>
      )}
    </MusicContext.Provider>
  );
}
