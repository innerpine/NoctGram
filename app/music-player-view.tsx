'use client';
/* Playback is owned by MusicProvider; opening this view never recreates the audio engine. */
/* The lyric scroll region intentionally accepts keyboard focus. */
/* eslint-disable react/react-compiler, next/no-img-element, jsx-a11y/no-noninteractive-tabindex */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
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
  PanelRightOpen,
  Pause,
  Play,
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
import { Popover, PopoverContent, PopoverTitle } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  formatMusicTime,
  musicProviderName,
  type MusicProviderId,
} from '@/lib/music-links';
import type { ListenState } from '@/lib/music-listening';
import Link from 'next/link';
import {
  currentLyric,
  defaultAppearance,
  playerArtwork,
  readAppearance,
  type PlayerAppearance,
} from '@/lib/music-player';
import { useTrackLyrics, type LyricLookup } from '@/lib/use-track-lyrics';
import { MusicSeekControl } from './music-seek-control';
import { MusicFavorite } from './music-favorite';
import { MusicReorderList } from './music-reorder-list';

export type PlayerTrack = {
  url: string;
  provider?: MusicProviderId;
  title: string;
  artist: string;
  artwork: string;
};
type Props = {
  roomName?: string;
  roomError?: string;
  onLeaveRoom?: () => void;
  track: PlayerTrack;
  queue: PlayerTrack[];
  queueIndex: number;
  expanded: boolean;
  onExpanded: (open: boolean) => void;
  playing: boolean;
  ready: boolean;
  error: string;
  needsGesture?: boolean;
  position: number;
  duration: number;
  volume: number;
  listening: ListenState;
  previousEnabled: boolean;
  nextEnabled: boolean;
  playerRef: RefObject<HTMLElement | null>;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (ms: number) => void;
  onVolume: (volume: number) => void;
  onSelect: (index: number) => void;
  onReorder?: (fromUrl: string, toUrl: string) => Promise<void>;
  onStop: () => void;
  onRetry: () => void;
};

const LyricLines = memo(function LyricLines({
  lines,
  active,
  activeLine,
  onChoose,
}: {
  lines: { time: number; text: string }[];
  active: number;
  activeLine: RefObject<HTMLButtonElement | null>;
  onChoose: (time: number) => void;
}) {
  return lines.map((line, index) => (
    <button
      key={`${line.time}:${index}`}
      ref={index === active ? activeLine : undefined}
      className={'music-lyric-line' + (index === active ? ' current' : '')}
      aria-current={index === active ? 'true' : undefined}
      aria-label={`${formatMusicTime(line.time)} — ${line.text || 'Проигрыш'}`}
      onClick={() => onChoose(line.time)}
    >
      {line.text || '•••'}
    </button>
  ));
});

function Lyrics({
  lookup,
  position,
  enabled,
  appearance,
  offset,
  onQueue,
  onSeek,
}: {
  lookup: LyricLookup;
  position: number;
  enabled: boolean;
  appearance: PlayerAppearance;
  offset: number;
  onQueue: () => void;
  onSeek: (time: number) => void;
}) {
  const { key, lyrics } = lookup;
  const [follow, setFollow] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const activeLine = useRef<HTMLButtonElement>(null);
  const latestSeek = useRef({ onSeek, offset });
  latestSeek.current = { onSeek, offset };
  const chooseLine = useCallback((time: number) => {
    latestSeek.current.onSeek(Math.max(0, time - latestSeek.current.offset));
    setFollow(true);
  }, []);
  const active = currentLyric(lyrics?.lines || [], position + offset);
  useEffect(() => {
    setFollow(true);
  }, [key, enabled]);
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

  if (lookup.loading)
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
            : lookup.error
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
        {!lyrics?.instrumental && (
          <button onClick={lookup.retry}>Повторить поиск текста</button>
        )}
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
          <LyricLines
            lines={lyrics.lines}
            active={active}
            activeLine={activeLine}
            onChoose={chooseLine}
          />
        ) : (
          <p className="music-lyrics-plain">{lyrics.plain}</p>
        )}
      </section>
      <div className="music-lyrics-footer">
        <span>Текст · LRCLIB</span>
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
  const [dockOpen, setDockOpen] = useState(false);
  const [dockAvailable, setDockAvailable] = useState(false);
  const dockButton = useRef<HTMLButtonElement>(null);
  const [miniCollapsed, setMiniCollapsed] = useState(false);
  const [sheetDragging, setSheetDragging] = useState(false);
  const sheetHandle = useRef<HTMLButtonElement>(null);
  const sheetDrag = useRef<{ id: number; y: number } | null>(null);
  const suppressSheetClickUntil = useRef(0);
  const changeMini = (collapsed: boolean) => {
    setMiniCollapsed(collapsed);
    sheetHandle.current?.focus({ preventScroll: true });
    try {
      localStorage.setItem('noctgram:player-collapsed', String(collapsed));
    } catch {
      /* The sheet works without device storage. */
    }
  };
  const resetSheetDrag = () => {
    sheetDrag.current = null;
    setSheetDragging(false);
    p.playerRef.current?.style.removeProperty('--music-sheet-drag');
  };
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1100px)');
    const update = () => setDockAvailable(query.matches);
    update();
    query.addEventListener('change', update);
    try {
      const savedDock = localStorage.getItem('noctgram:lyrics-dock') === 'true';
      setDockOpen(savedDock);
      const savedMini = localStorage.getItem('noctgram:player-collapsed');
      setMiniCollapsed(savedMini === null ? savedDock : savedMini === 'true');
    } catch {
      /* Device storage is optional. */
    }
    return () => query.removeEventListener('change', update);
  }, []);
  const changeDock = (open: boolean) => {
    setDockOpen(open);
    if (open) changeMini(true);
    try {
      localStorage.setItem('noctgram:lyrics-dock', String(open));
    } catch {
      /* The panel still works without storage. */
    }
  };
  const closeDock = () => {
    changeDock(false);
    (miniCollapsed ? sheetHandle : dockButton).current?.focus({
      preventScroll: true,
    });
  };
  const dockVisible = dockOpen && dockAvailable && !p.expanded;
  const lyricLookup = useTrackLyrics(
    p.track,
    p.duration,
    (dockVisible || (p.expanded && pane === 'lyrics')) && p.ready && !p.error,
  );
  const [offset, setOffset] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 });
  const settingsFocus = useRef<HTMLElement | null>(null);
  const menuAnchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        DOMRect.fromRect({
          x: menuPoint.x,
          y: menuPoint.y,
          width: 1,
          height: 1,
        }),
    }),
    [menuPoint],
  );
  const showSettings = (x: number, y: number) => {
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    settingsFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setMenuPoint({ x, y });
    setSettingsOpen(true);
  };
  useEffect(() => {
    if (!p.expanded) setSettingsOpen(false);
  }, [p.expanded]);
  useEffect(() => {
    if (!settingsOpen) return;
    const close = (event: MouseEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setSettingsOpen(false);
    };
    document.addEventListener('contextmenu', close, true);
    return () => document.removeEventListener('contextmenu', close, true);
  }, [settingsOpen]);
  const coverButton = useRef<HTMLButtonElement>(null);
  const lastVolume = useRef(25);
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
  const volumeControl = (location: 'mini' | 'dock') => (
    <div
      className={
        'music-mini-volume' + (location === 'dock' ? ' music-dock-volume' : '')
      }
    >
      <button
        className="icon-button"
        aria-label={p.volume ? 'Выключить звук' : 'Включить звук'}
        title={p.volume ? 'Выключить звук' : 'Включить звук'}
        onClick={toggleVolume}
      >
        {p.volume ? <Volume2 size={17} /> : <VolumeX size={17} />}
      </button>
      <Slider
        aria-label={
          location === 'dock'
            ? 'Громкость в боковом плеере'
            : 'Громкость в компактном плеере'
        }
        min={0}
        max={100}
        step={1}
        value={[p.volume]}
        onValueChange={(value) =>
          p.onVolume(Array.isArray(value) ? value[0] : value)
        }
      />
      <span>{p.volume}%</span>
    </div>
  );
  const progress = (location: 'mini' | 'full' | 'dock' = 'mini') => (
    <MusicSeekControl
      key={p.track.url}
      label={
        location === 'full'
          ? 'Позиция в большом плеере'
          : location === 'dock'
            ? 'Позиция в боковом плеере'
            : 'Позиция воспроизведения'
      }
      position={p.position}
      duration={p.duration}
      disabled={!p.ready || !p.duration || !!p.error}
      onSeek={p.onSeek}
    />
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
  const error = p.error ? (
    <div className="music-error" role="alert">
      {p.error} <button onClick={p.onRetry}>Повторить</button>
      {p.track.provider === 'spotify' && (
        <Link href="/music/services?provider=spotify">Подключение Spotify</Link>
      )}
    </div>
  ) : p.needsGesture && p.ready ? (
    <button className="music-activation" onClick={p.onToggle}>
      Нажмите ▶, чтобы включить звук
    </button>
  ) : null;
  const sourceName = musicProviderName(p.track.provider);
  const source = (
    <a
      className="music-source-credit"
      href={p.track.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={'Сведения о треке: ' + sourceName}
    >
      {sourceName}
    </a>
  );
  return (
    <>
      <section
        ref={p.playerRef}
        className="music-player music-sheet"
        aria-label="Музыкальный плеер"
        data-collapsed={miniCollapsed}
        data-dragging={sheetDragging}
        data-motion={appearance.motion ? 'on' : 'off'}
      >
        <button
          ref={sheetHandle}
          className="music-sheet-handle"
          aria-label={
            miniCollapsed ? 'Раскрыть нижний плеер' : 'Свернуть нижний плеер'
          }
          aria-expanded={!miniCollapsed}
          aria-controls="music-sheet-controls"
          title={
            miniCollapsed
              ? 'Раскрыть плеер — нажми или потяни вверх'
              : 'Свернуть плеер — нажми или потяни вниз'
          }
          onClick={(event) => {
            if (
              event.detail > 0 &&
              Date.now() < suppressSheetClickUntil.current
            )
              return;
            changeMini(!miniCollapsed);
          }}
          onKeyDown={(event) => {
            if (['ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) {
              event.preventDefault();
              changeMini(event.key !== 'ArrowUp');
            }
          }}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            sheetDrag.current = { id: event.pointerId, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
            setSheetDragging(true);
          }}
          onPointerMove={(event) => {
            if (sheetDrag.current?.id !== event.pointerId) return;
            const delta = event.clientY - sheetDrag.current.y;
            p.playerRef.current?.style.setProperty(
              '--music-sheet-drag',
              `${Math.max(-14, Math.min(24, delta * 0.3))}px`,
            );
          }}
          onPointerUp={(event) => {
            if (sheetDrag.current?.id !== event.pointerId) return;
            const delta = event.clientY - sheetDrag.current.y;
            if (Math.abs(delta) >= 24) {
              suppressSheetClickUntil.current = Date.now() + 400;
              changeMini(delta > 0);
            }
            resetSheetDrag();
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={resetSheetDrag}
          onLostPointerCapture={resetSheetDrag}
        >
          <span className="music-sheet-grip" aria-hidden="true" />
          <span className="music-sheet-peek" aria-hidden="true">
            <span>{p.error ? 'Плеер · нужна проверка' : p.track.title}</span>
            <ChevronUp size={15} />
          </span>
        </button>
        <div
          id="music-sheet-controls"
          className="music-sheet-content"
          aria-hidden={miniCollapsed}
          inert={miniCollapsed}
        >
          <div className="music-sheet-inner">
            {p.roomName && (
              <div className="music-room-strip">
                <Headphones size={14} />
                <span>Вместе · {p.roomName}</span>
                <button onClick={p.onLeaveRoom}>Выйти</button>
              </div>
            )}
            {p.roomError && (
              <p className="music-error" role="alert">
                {p.roomError}
              </p>
            )}
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
                <button
                  onClick={() => p.onExpanded(true)}
                  title={p.track.title}
                >
                  {p.track.title}
                </button>
                <div>
                  <span>{p.track.artist || 'Музыка'}</span>
                  <span aria-hidden="true"> · </span>
                  {source}
                </div>
              </div>
              <MusicFavorite track={p.track} />
              {transport()}
              <button
                ref={dockButton}
                className="icon-button music-dock-toggle"
                aria-label="Текст справа"
                title={
                  dockOpen
                    ? 'Скрыть текст справа'
                    : 'Текст справа — слушай и общайся'
                }
                aria-pressed={dockOpen}
                aria-expanded={dockVisible}
                aria-controls="music-lyrics-dock"
                onClick={() => changeDock(!dockOpen)}
              >
                <PanelRightOpen size={19} />
                <span>Текст</span>
              </button>
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
            <div className="music-mini-footer">
              <Link
                className="music-listen-status"
                href="/music?tab=charts"
                title="Открыть чарт прослушиваний"
              >
                {p.listening.status === 'counted'
                  ? 'Учтено в чарте сегодня'
                  : p.listening.status === 'tracking'
                    ? `В чарт · ${p.listening.seconds} / 30 с`
                    : p.listening.status === 'error'
                      ? 'Учёт недоступен'
                      : p.listening.status === 'checking'
                        ? 'Проверяем учёт…'
                        : p.listening.status === 'excluded'
                          ? `${sourceName} · без учёта в чарте`
                          : 'Чарт прослушиваний'}
              </Link>
              {volumeControl('mini')}
            </div>
            {!p.expanded && error}
          </div>
        </div>
      </section>

      {/* Escape bubbles from the panel's controls; the panel never traps focus. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <aside
        id="music-lyrics-dock"
        className="music-lyrics-dock"
        aria-label="Текст песни справа"
        data-open={dockVisible}
        data-playing={p.playing}
        data-motion={appearance.motion ? 'on' : 'off'}
        aria-hidden={!dockVisible}
        inert={!dockVisible}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            closeDock();
          }
        }}
        style={
          {
            '--music-darkness': Math.max(appearance.darkness / 100, 0.65),
            '--music-blur': `${appearance.blur}px`,
            '--music-text-size': `${Math.max(20, Math.min(28, appearance.textSize * 0.75))}px`,
          } as CSSProperties
        }
      >
        <div className="music-stage-atmosphere" aria-hidden="true">
          {artwork && <img key={artwork} src={artwork} alt="" />}
        </div>
        <header className="music-dock-header">
          <div>
            <span className="music-live-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>ТЕКСТ РЯДОМ</span>
          </div>
          <button
            className="music-stage-icon"
            aria-label="Скрыть текст справа"
            onClick={closeDock}
          >
            <X size={18} />
          </button>
        </header>
        <button
          className="music-dock-track"
          onClick={() => {
            setPane('lyrics');
            p.onExpanded(true);
          }}
          aria-label={'Открыть полный плеер: ' + p.track.title}
          aria-haspopup="dialog"
        >
          <span className="music-dock-artwork">
            {artwork ? (
              <img key={artwork} src={artwork} alt="" />
            ) : (
              <Headphones size={24} />
            )}
          </span>
          <span className="music-dock-track-copy" key={p.track.url}>
            <strong>{p.track.title}</strong>
            <small>{p.track.artist || sourceName}</small>
          </span>
          <ChevronUp size={16} />
        </button>
        <div className="music-dock-lyrics">
          {p.error ? (
            error
          ) : (
            <Lyrics
              lookup={lyricLookup}
              position={p.position}
              enabled={dockVisible}
              appearance={appearance}
              offset={offset}
              onQueue={() => {
                setPane('queue');
                p.onExpanded(true);
              }}
              onSeek={p.onSeek}
            />
          )}
        </div>
        <footer className="music-dock-footer">
          {progress('dock')}
          <div className="music-dock-now">
            <span>
              {p.error
                ? 'Воспроизведение недоступно'
                : !p.ready
                  ? 'Подключаем…'
                  : p.playing
                    ? 'Сейчас играет'
                    : 'На паузе'}
            </span>
            {transport()}
          </div>
          {volumeControl('dock')}
        </footer>
      </aside>

      <Dialog open={p.expanded} onOpenChange={p.onExpanded}>
        <Popover
          open={settingsOpen}
          onOpenChange={(open, details) => {
            // Keep the menu until contextmenu so the same right click cannot reopen it.
            if (
              !open &&
              details.reason === 'outside-press' &&
              'button' in details.event &&
              details.event.button === 2
            ) {
              details.cancel();
              return;
            }
            setSettingsOpen(open);
          }}
        >
          <DialogContent
            showCloseButton={false}
            finalFocus={miniCollapsed ? sheetHandle : coverButton}
            className="music-stage"
            onContextMenu={(event) => {
              event.preventDefault();
              showSettings(event.clientX, event.clientY);
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'ContextMenu' ||
                (event.shiftKey && event.key === 'F10')
              ) {
                event.preventDefault();
                const rect = (
                  event.target as HTMLElement
                ).getBoundingClientRect();
                showSettings(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2,
                );
              }
            }}
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
              <button
                className="music-stage-icon music-dock-toggle"
                aria-label="Показать текст справа и вернуться к переписке"
                title="Текст справа"
                onClick={() => {
                  changeDock(true);
                  p.onExpanded(false);
                }}
              >
                <PanelRightOpen size={22} />
              </button>
              <span className="music-dock-mobile-spacer" aria-hidden="true" />
            </header>
            <DialogDescription className="sr-only">
              Плеер Noctgram. Настройки открываются правой кнопкой мыши или
              Shift+F10. Воспроизведение, очередь и текст песни. Escape
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
                  <MusicFavorite track={p.track} />
                </div>
                {progress('full')}
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
                    onClick={() =>
                      setPane(pane === 'queue' ? 'lyrics' : 'queue')
                    }
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
              <aside
                className="music-stage-aside"
                aria-hidden={pane === 'cover'}
                inert={pane === 'cover'}
              >
                <div
                  className="music-mode-panel"
                  data-active={pane === 'lyrics'}
                  aria-hidden={pane !== 'lyrics'}
                  inert={pane !== 'lyrics'}
                >
                  <Lyrics
                    lookup={lyricLookup}
                    position={p.position}
                    enabled={
                      p.expanded && pane === 'lyrics' && p.ready && !p.error
                    }
                    appearance={appearance}
                    offset={offset}
                    onQueue={() => setPane('queue')}
                    onSeek={p.onSeek}
                  />
                </div>
                <div
                  className="music-mode-panel"
                  data-active={pane === 'queue'}
                  aria-hidden={pane !== 'queue'}
                  inert={pane !== 'queue'}
                >
                  <div className="music-stage-queue">
                    <div className="music-queue-heading">
                      <h3>Очередь</h3>
                      <span>{p.queue.length}</span>
                    </div>
                    <MusicReorderList
                      className="music-queue-scroll"
                      onMove={p.onReorder}
                      rows={p.queue.map((track, index) => ({
                        id: track.url,
                        label: track.title,
                        content: (
                          <button
                            key={track.url}
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
                        ),
                      }))}
                    />
                  </div>
                </div>
              </aside>
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
          <PopoverContent
            align="start"
            anchor={menuAnchor}
            initialFocus={true}
            finalFocus={settingsFocus}
            sideOffset={6}
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
      </Dialog>
    </>
  );
}
