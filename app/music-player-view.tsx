'use client';
/* Playback is owned by MusicProvider; opening this view never recreates the audio engine. */
/* The lyric scroll region intentionally accepts keyboard focus. */
/* eslint-disable react/react-compiler, next/no-img-element, jsx-a11y/no-noninteractive-tabindex */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  Headphones,
  ListMusic,
  LoaderCircle,
  Mic2,
  Pause,
  Play,
  Settings2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatMusicTime } from '@/lib/music-links';
import {
  currentLyric,
  defaultAppearance,
  playerArtwork,
  readAppearance,
  readLyrics,
  type PlayerAppearance,
  type TrackLyrics,
} from '@/lib/music-player';

export type PlayerTrack = {
  url: string;
  title: string;
  artist: string;
  artwork: string;
};
type Props = {
  track: PlayerTrack;
  queue: PlayerTrack[];
  queueIndex: number;
  expanded: boolean;
  onExpanded: (open: boolean) => void;
  playing: boolean;
  ready: boolean;
  error: string;
  position: number;
  duration: number;
  volume: number;
  previousEnabled: boolean;
  nextEnabled: boolean;
  playerRef: RefObject<HTMLElement | null>;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (ms: number) => void;
  onVolume: (volume: number) => void;
  onSelect: (index: number) => void;
  onStop: () => void;
  onRetry: () => void;
};

const lyricCache = new Map<
  string,
  { lyrics: TrackLyrics | null; until: number }
>();
let lyricCooldown = 0;

function Lyrics({
  track,
  duration,
  position,
  enabled,
  appearance,
  offset,
  onQueue,
  onSeek,
}: {
  track: PlayerTrack;
  duration: number;
  position: number;
  enabled: boolean;
  appearance: PlayerAppearance;
  offset: number;
  onQueue: () => void;
  onSeek: (time: number) => void;
}) {
  const [result, setResult] = useState<{
    key: string;
    lyrics: TrackLyrics | null;
    error?: boolean;
  } | null>(null);
  const [follow, setFollow] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const activeLine = useRef<HTMLButtonElement>(null);
  const key = `${track.url}:${track.artist}:${track.title}:${Math.round(duration)}`;
  const lyrics = result?.key === key ? result.lyrics : null;
  const active = currentLyric(lyrics?.lines || [], position + offset);
  useEffect(() => {
    if (!enabled || !duration || !track.artist) return;
    setFollow(true);
    const cached = lyricCache.get(key);
    if (cached && cached.until > Date.now()) {
      setResult({ key, lyrics: cached.lyrics });
      return;
    }
    if (lyricCooldown > Date.now()) {
      setResult({ key, lyrics: null, error: true });
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let cancelled = false;
    // Only metadata for the open lyrics pane is sent. No library, account or tokens.
    void fetch(
      'https://lrclib.net/api/get?' +
        new URLSearchParams({
          track_name: track.title,
          artist_name: track.artist,
          duration: String(duration / 1000),
        }),
      {
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
    )
      .then(async (response) => {
        if (response.status === 429) {
          const header = response.headers.get('Retry-After') || '60';
          const seconds = Number(header);
          lyricCooldown = Math.max(
            Date.now() + 60000,
            Number.isFinite(seconds)
              ? Date.now() + seconds * 1000
              : Date.parse(header) || 0,
          );
        }
        if (!response.ok && response.status !== 404)
          throw new Error('Lyrics unavailable');
        const found =
          response.status === 404
            ? null
            : readLyrics(await response.json(), duration);
        if (cancelled) return;
        if (lyricCache.size >= 30)
          lyricCache.delete(lyricCache.keys().next().value!);
        lyricCache.set(key, { lyrics: found, until: Date.now() + 600000 });
        setResult({ key, lyrics: found });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, lyrics: null, error: true });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [key, enabled, duration, track.artist, track.title]);

  useEffect(() => {
    if (!enabled || !follow || !container.current || !activeLine.current)
      return;
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    container.current.scrollTo({
      top:
        activeLine.current.offsetTop -
        container.current.clientHeight / 2 +
        activeLine.current.clientHeight / 2,
      behavior: appearance.motion && !reduced ? 'smooth' : 'instant',
    });
  }, [active, follow, enabled, key, appearance.textSize, appearance.motion]);

  if (!duration || !track.artist || result?.key !== key)
    return (
      <output className="music-stage-empty">
        <LoaderCircle className="spin" size={26} />
        <span>Ищем текст песни…</span>
      </output>
    );
  if (!lyrics || lyrics.instrumental)
    return (
      <div className="music-stage-empty">
        <Mic2 size={32} strokeWidth={1.25} />
        <h3>
          {lyrics?.instrumental
            ? 'Без слов'
            : result.error
              ? 'Текст сейчас недоступен'
              : 'Текст пока не найден'}
        </h3>
        <p>
          {lyrics?.instrumental
            ? 'У этой композиции нет вокальной партии.'
            : 'Можно продолжить слушать и выбрать следующий трек.'}
        </p>
        <button onClick={onQueue}>
          <ListMusic size={17} /> Открыть очередь
        </button>
      </div>
    );
  return (
    <div className="music-lyrics-pane">
      {/* This scroll region needs keyboard focus, including for plain, untimed lyrics. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
      <section
        ref={container}
        className={
          'music-lyrics-scroll' + (appearance.softLyrics ? ' soft-lines' : '')
        }
        onWheel={() => setFollow(false)}
        onTouchStart={() => setFollow(false)}
        onKeyDown={(e) => {
          if (
            [
              'ArrowDown',
              'ArrowUp',
              'PageDown',
              'PageUp',
              'Home',
              'End',
              'Tab',
            ].includes(e.key)
          )
            setFollow(false);
        }}
        tabIndex={0}
        aria-label="Текст песни"
      >
        {lyrics.lines.length ? (
          lyrics.lines.map((line, index) => (
            <button
              key={`${line.time}:${index}`}
              ref={index === active ? activeLine : undefined}
              className={
                'music-lyric-line' + (index === active ? ' current' : '')
              }
              aria-current={index === active ? 'true' : undefined}
              aria-label={`${formatMusicTime(line.time)} — ${line.text || 'Проигрыш'}`}
              onClick={() => {
                onSeek(Math.max(0, line.time - offset));
                setFollow(true);
              }}
            >
              {line.text || '•••'}
            </button>
          ))
        ) : (
          <p className="music-lyrics-plain">{lyrics.plain}</p>
        )}
      </section>
      <div className="music-lyrics-footer">
        <a href="https://lrclib.net" target="_blank" rel="noopener noreferrer">
          Текст · LRCLIB
        </a>
        {!follow && lyrics.lines.length > 0 ? (
          <button onClick={() => setFollow(true)}>К текущей строке</button>
        ) : (
          <span>
            {lyrics.lines.length ? 'По строкам' : 'Без синхронизации'}
          </span>
        )}
      </div>
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="music-setting-range">
      <div>
        <span>{label}</span>
        <output>
          {value}
          {suffix}
        </output>
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(values) =>
          onChange(Array.isArray(values) ? values[0] : values)
        }
      />
    </div>
  );
}

export function MusicPlayerView(p: Props) {
  const [appearance, setAppearance] = useState(defaultAppearance);
  const [pane, setPane] = useState('lyrics');
  const [offset, setOffset] = useState(0);
  const coverButton = useRef<HTMLButtonElement>(null);
  const lastVolume = useRef(70);
  useEffect(() => {
    try {
      setAppearance(
        readAppearance(
          JSON.parse(
            localStorage.getItem('noctgram:player-appearance') || 'null',
          ),
        ),
      );
    } catch {
      /* Device storage is optional. */
    }
  }, []);
  useEffect(() => {
    setOffset(0);
  }, [p.track.url]);
  const updateAppearance = (value: Partial<PlayerAppearance>) => {
    const next = readAppearance({ ...appearance, ...value });
    setAppearance(next);
    try {
      localStorage.setItem('noctgram:player-appearance', JSON.stringify(next));
    } catch {
      /* Still works without storage. */
    }
  };
  const artwork = playerArtwork(p.track.artwork, true);
  const toggleVolume = () => {
    if (p.volume > 0) {
      lastVolume.current = p.volume;
      p.onVolume(0);
    } else p.onVolume(lastVolume.current);
  };
  const progress = (full = false) => (
    <div className="music-progress">
      <span>{formatMusicTime(p.position)}</span>
      <Slider
        aria-label={
          full ? 'Позиция в большом плеере' : 'Позиция воспроизведения'
        }
        min={0}
        max={Math.max(p.duration, 1)}
        step={1000}
        value={[Math.min(p.position, p.duration)]}
        disabled={!p.ready || !p.duration || !!p.error}
        onValueChange={(values) =>
          p.onSeek(Array.isArray(values) ? values[0] : values)
        }
      />
      <span>{formatMusicTime(p.duration)}</span>
    </div>
  );
  const transport = () => (
    <div className="music-transport">
      <button
        className="icon-button"
        aria-label="Предыдущий трек"
        disabled={!p.ready || !p.previousEnabled}
        onClick={p.onPrevious}
      >
        <SkipBack size={21} />
      </button>
      <button
        className="music-play"
        aria-label={p.playing ? 'Пауза' : 'Воспроизвести'}
        disabled={!p.ready || !!p.error}
        onClick={p.onToggle}
      >
        {!p.ready && !p.error ? (
          <LoaderCircle className="spin" size={22} />
        ) : p.playing ? (
          <Pause size={22} fill="currentColor" />
        ) : (
          <Play size={22} fill="currentColor" />
        )}
      </button>
      <button
        className="icon-button"
        aria-label="Следующий трек"
        disabled={!p.ready || !p.nextEnabled}
        onClick={p.onNext}
      >
        <SkipForward size={21} />
      </button>
    </div>
  );
  const error = p.error && (
    <div className="music-error" role="alert">
      {p.error} <button onClick={p.onRetry}>Повторить</button>
    </div>
  );
  const source = (
    <a
      className="music-source-credit"
      href={p.track.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Источник трека: SoundCloud"
    >
      SoundCloud
    </a>
  );
  return (
    <>
      <section
        ref={p.playerRef}
        className="music-player"
        aria-label="Музыкальный плеер"
      >
        <div className="music-player-row">
          <button
            ref={coverButton}
            className="music-cover"
            aria-label="Развернуть плеер"
            aria-haspopup="dialog"
            aria-expanded={p.expanded}
            onClick={() => p.onExpanded(true)}
          >
            {p.track.artwork ? (
              <img src={playerArtwork(p.track.artwork)} alt="" />
            ) : (
              <Headphones size={21} />
            )}
            <span>
              <ChevronUp size={20} />
            </span>
          </button>
          <div className="music-player-title">
            <button onClick={() => p.onExpanded(true)} title={p.track.title}>
              {p.track.title}
            </button>
            <div>
              <span>{p.track.artist || 'Музыка'}</span>
              <span aria-hidden="true"> · </span>
              {source}
            </div>
          </div>
          {transport()}
          <button
            className="icon-button music-expand-button"
            aria-label="Развернуть плеер"
            aria-haspopup="dialog"
            onClick={() => p.onExpanded(true)}
          >
            <ChevronUp size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Остановить и закрыть плеер"
            onClick={p.onStop}
          >
            <X size={18} />
          </button>
        </div>
        {progress()}
        {!p.expanded && error}
      </section>

      <Dialog open={p.expanded} onOpenChange={p.onExpanded}>
        <DialogContent
          showCloseButton={false}
          finalFocus={coverButton}
          className="music-stage"
          data-motion={appearance.motion ? 'on' : 'off'}
          data-playing={p.playing}
          style={
            {
              '--music-darkness': appearance.darkness / 100,
              '--music-blur': `${appearance.blur}px`,
              '--music-text-size': `${appearance.textSize}px`,
            } as CSSProperties
          }
        >
          <div className="music-stage-atmosphere" aria-hidden="true">
            {artwork && <img key={artwork} src={artwork} alt="" />}
          </div>
          <header className="music-stage-header">
            <DialogClose
              className="music-stage-icon"
              aria-label="Свернуть плеер"
            >
              <ChevronDown size={25} />
            </DialogClose>
            <div className="music-stage-label">
              <span className="music-live-mark">
                <i />
                <i />
                <i />
              </span>{' '}
              NOCTGRAM <span>/ МУЗЫКА</span>
            </div>
            <Popover>
              <PopoverTrigger
                className="music-stage-icon"
                aria-label="Настройки плеера"
              >
                <Settings2 size={21} />
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={12}
                className="music-player-settings"
              >
                <PopoverTitle>Оформление плеера</PopoverTitle>
                <fieldset
                  className="music-text-sizes"
                  aria-label="Размер текста песни"
                >
                  {[24, 28, 32, 40].map((size) => (
                    <button
                      key={size}
                      style={{ fontSize: 14 + (size - 24) / 2 }}
                      aria-label={`Текст ${size} пикселя`}
                      aria-pressed={appearance.textSize === size}
                      onClick={() => updateAppearance({ textSize: size })}
                    >
                      А
                    </button>
                  ))}
                </fieldset>
                <Range
                  label="Затемнение"
                  value={appearance.darkness}
                  min={30}
                  max={85}
                  suffix="%"
                  onChange={(darkness) => updateAppearance({ darkness })}
                />
                <Range
                  label="Размытие фона"
                  value={appearance.blur}
                  min={24}
                  max={120}
                  onChange={(blur) => updateAppearance({ blur })}
                />
                <div className="music-setting-switch">
                  <label htmlFor="music-soft-lyrics">
                    Размывать соседние строки
                  </label>
                  <Switch
                    id="music-soft-lyrics"
                    checked={appearance.softLyrics}
                    onCheckedChange={(softLyrics) =>
                      updateAppearance({ softLyrics })
                    }
                  />
                </div>
                <div className="music-setting-switch">
                  <label htmlFor="music-player-motion">Плавная анимация</label>
                  <Switch
                    id="music-player-motion"
                    checked={appearance.motion}
                    onCheckedChange={(motion) => updateAppearance({ motion })}
                  />
                </div>
                <Range
                  label="Сдвиг текста"
                  value={offset / 1000}
                  min={-5}
                  max={5}
                  step={0.1}
                  suffix=" с"
                  onChange={(seconds) => setOffset(Math.round(seconds * 1000))}
                />
                <button
                  className="music-settings-reset"
                  onClick={() => {
                    updateAppearance(defaultAppearance);
                    setOffset(0);
                  }}
                >
                  Сбросить настройки
                </button>
              </PopoverContent>
            </Popover>
          </header>
          <DialogDescription className="sr-only">
            Плеер Noctgram. Воспроизведение, очередь и текст песни. Escape
            сворачивает окно, музыка продолжает играть.
          </DialogDescription>
          <div
            className={
              'music-stage-body' + (pane === 'cover' ? ' cover-only' : '')
            }
          >
            <div className="music-stage-main">
              <div className="music-stage-artwork">
                {artwork ? (
                  <img
                    key={artwork}
                    src={artwork}
                    alt={`Обложка ${p.track.title}`}
                    onError={(event) => {
                      if (event.currentTarget.src !== p.track.artwork)
                        event.currentTarget.src = p.track.artwork;
                    }}
                  />
                ) : (
                  <Headphones size={88} strokeWidth={0.8} />
                )}
              </div>
              <div className="music-stage-track">
                <DialogTitle>{p.track.title}</DialogTitle>
                <p>
                  {p.track.artist || 'Музыка'}
                  <span> · </span>
                  {source}
                </p>
              </div>
              {progress(true)}
              <div className="music-stage-controls">
                <button
                  className="music-stage-icon"
                  aria-label={p.volume ? 'Выключить звук' : 'Включить звук'}
                  onClick={toggleVolume}
                >
                  {p.volume ? <Volume2 size={21} /> : <VolumeX size={21} />}
                </button>
                {transport()}
                <button
                  className="music-stage-icon"
                  aria-label="Показать очередь"
                  aria-pressed={pane === 'queue'}
                  onClick={() => setPane(pane === 'queue' ? 'lyrics' : 'queue')}
                >
                  <ListMusic size={22} />
                </button>
              </div>
              <div className="music-stage-volume">
                <Volume2 size={15} />
                <Slider
                  aria-label="Громкость"
                  min={0}
                  max={100}
                  value={[p.volume]}
                  onValueChange={(values) =>
                    p.onVolume(Array.isArray(values) ? values[0] : values)
                  }
                />
                <span>{p.volume}%</span>
              </div>
              {error}
            </div>
            {pane !== 'cover' && (
              <aside className="music-stage-aside">
                {pane === 'lyrics' ? (
                  <Lyrics
                    track={p.track}
                    duration={p.duration}
                    position={p.position}
                    enabled={p.expanded && p.ready && !p.error}
                    appearance={appearance}
                    offset={offset}
                    onQueue={() => setPane('queue')}
                    onSeek={p.onSeek}
                  />
                ) : (
                  <div className="music-stage-queue">
                    <div className="music-queue-heading">
                      <h3>Очередь</h3>
                      <span>{p.queue.length}</span>
                    </div>
                    <div className="music-queue-scroll">
                      {p.queue.map((track, index) => (
                        <button
                          key={`${track.url}:${index}`}
                          className={
                            'music-queue-track' +
                            (index === p.queueIndex ? ' current' : '')
                          }
                          aria-current={
                            index === p.queueIndex ? 'true' : undefined
                          }
                          disabled={!p.ready}
                          onClick={() => p.onSelect(index)}
                        >
                          <span className="music-queue-number">
                            {index === p.queueIndex && p.playing ? (
                              <span className="music-live-mark">
                                <i />
                                <i />
                                <i />
                              </span>
                            ) : (
                              String(index + 1).padStart(2, '0')
                            )}
                          </span>
                          <span className="music-queue-artwork">
                            {track.artwork ? (
                              <img
                                src={playerArtwork(track.artwork)}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              <Headphones size={18} />
                            )}
                          </span>
                          <span className="music-queue-title">
                            <strong>{track.title}</strong>
                            <small>{track.artist || 'SoundCloud'}</small>
                          </span>
                          <Play size={16} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            )}
          </div>
          <footer className="music-stage-footer">
            <Tabs
              value={pane}
              onValueChange={(value) => setPane(String(value))}
            >
              <TabsList aria-label="Вид плеера">
                <TabsTrigger value="cover">
                  <Headphones size={16} /> Обложка
                </TabsTrigger>
                <TabsTrigger value="lyrics">
                  <Mic2 size={16} /> Текст
                </TabsTrigger>
                <TabsTrigger value="queue">
                  <ListMusic size={16} /> Очередь
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
}
