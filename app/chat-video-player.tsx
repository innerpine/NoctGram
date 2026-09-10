'use client';
/* The focusable composite player groups native controls and exposes Space/arrow
   shortcuts; a button wrapper would illegally nest its buttons and sliders. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role */
/* Media events are the source of truth for playback and native fullscreen. */
/* eslint-disable react/react-compiler, jsx-a11y/media-has-caption */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  Download,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatMusicTime } from '@/lib/music-links';
import {
  readVideoState,
  seekVideo,
  toggleVideoFullscreen,
  type FullscreenVideo,
} from '@/lib/chat-video';

const initialState = {
  duration: 0,
  position: 0,
  buffered: 0,
  paused: true,
  ended: false,
  muted: false,
  volume: 1,
};
export function ChatVideoPlayer({
  src,
  name,
  metadata,
  flush = false,
}: {
  src: string;
  name: string;
  metadata?: ReactNode;
  flush?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    video = useRef<FullscreenVideo>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true),
    playPending = useRef(false);
  const [state, setState] = useState(initialState);
  const [visible, setVisible] = useState(true),
    [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(''),
    [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const playing = !state.paused;
  function stopHideTimer() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }
  function showControls() {
    stopHideTimer();
    setVisible(true);
    if (video.current && !video.current.paused) {
      hideTimer.current = setTimeout(() => {
        if (
          !root.current?.matches(':focus-visible') &&
          !root.current?.querySelector(':focus-visible')
        )
          setVisible(false);
      }, 2400);
    }
  }
  function sync() {
    if (video.current) setState(readVideoState(video.current));
  }
  useEffect(() => {
    alive.current = true;
    const element = video.current,
      container = root.current;
    sync();
    const updateFullscreen = () =>
      setFullscreen(
        container?.ownerDocument.fullscreenElement === container ||
          !!element?.webkitDisplayingFullscreen,
      );
    container?.ownerDocument.addEventListener(
      'fullscreenchange',
      updateFullscreen,
    );
    element?.addEventListener('webkitbeginfullscreen', updateFullscreen);
    element?.addEventListener('webkitendfullscreen', updateFullscreen);
    return () => {
      alive.current = false;
      stopHideTimer();
      element?.pause();
      container?.ownerDocument.removeEventListener(
        'fullscreenchange',
        updateFullscreen,
      );
      element?.removeEventListener('webkitbeginfullscreen', updateFullscreen);
      element?.removeEventListener('webkitendfullscreen', updateFullscreen);
    };
  }, []);
  async function togglePlay() {
    const element = video.current;
    if (!element) return;
    showControls();
    setError('');
    if (!element.paused) {
      element.pause();
      return;
    }
    if (playPending.current) return;
    if (element.ended) seekVideo(element, 0);
    playPending.current = true;
    try {
      if (element.error) element.load();
      await element.play();
    } catch (cause) {
      if (alive.current && (cause as Error).name !== 'AbortError') {
        setBuffering(false);
        setError('Не удалось воспроизвести видео. Попробуйте ещё раз.');
      }
    } finally {
      playPending.current = false;
    }
  }
  function seek(position: number) {
    if (video.current) seekVideo(video.current, position);
    sync();
    showControls();
  }
  async function toggleFullscreen() {
    if (!root.current || !video.current) return;
    setFullscreenError('');
    showControls();
    try {
      await toggleVideoFullscreen(root.current, video.current);
    } catch {
      if (alive.current)
        setFullscreenError('Полный экран недоступен в этом браузере.');
    }
  }
  function toggleMute() {
    if (!video.current) return;
    const silent = video.current.muted || video.current.volume === 0;
    if (video.current.volume === 0) video.current.volume = 1;
    video.current.muted = !silent;
    sync();
    showControls();
  }
  const percent = state.duration ? (state.position / state.duration) * 100 : 0;
  const buffered = state.duration ? (state.buffered / state.duration) * 100 : 0;
  const playLabel = state.ended
    ? 'Повторить видео'
    : playing
      ? 'Приостановить видео'
      : 'Воспроизвести видео';
  return (
    <div
      ref={root}
      className="chat-video-player"
      data-chat-menu-exempt
      data-controls={visible || !playing || !!error || buffering}
      data-flush={flush}
      tabIndex={0}
      role="group"
      aria-label={'Видеоплеер: ' + name}
      onPointerMove={showControls}
      onPointerDown={showControls}
      onFocusCapture={() => {
        stopHideTimer();
        setVisible(true);
      }}
      onBlurCapture={showControls}
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        if (event.key === ' ' || event.key.toLowerCase() === 'k') {
          event.preventDefault();
          void togglePlay();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          seek(state.position + (event.key === 'ArrowLeft' ? -5 : 5));
        } else if (event.key.toLowerCase() === 'm') {
          event.preventDefault();
          toggleMute();
        } else if (event.key.toLowerCase() === 'f') {
          event.preventDefault();
          void toggleFullscreen();
        }
      }}
    >
      <video
        ref={video}
        src={src}
        playsInline
        preload="metadata"
        aria-label={name}
        onClick={() => void togglePlay()}
        onLoadedMetadata={sync}
        onDurationChange={sync}
        onTimeUpdate={sync}
        onProgress={sync}
        onVolumeChange={sync}
        onPlay={() => {
          sync();
          showControls();
        }}
        onPlaying={() => {
          setBuffering(false);
          setError('');
          sync();
          showControls();
        }}
        onPause={() => {
          setBuffering(false);
          sync();
          showControls();
        }}
        onEnded={() => {
          setBuffering(false);
          sync();
          showControls();
        }}
        onWaiting={() => {
          setBuffering(true);
          showControls();
        }}
        onCanPlay={() => {
          setBuffering(false);
          sync();
        }}
        onError={() => {
          setBuffering(false);
          setError('Не удалось загрузить видео. Попробуйте ещё раз.');
          showControls();
        }}
      />
      {metadata}
      <a
        className="chat-video-save"
        href={src + '?download=1'}
        download={name}
        title="Скачать видео"
        aria-label={'Скачать видео ' + name}
      >
        <Download size={16} />
      </a>
      {buffering ? (
        <output className="chat-video-center" aria-label="Загрузка видео">
          <LoaderCircle size={25} className="spin" />
        </output>
      ) : (
        (!playing || error) && (
          <button
            type="button"
            className="chat-video-center"
            aria-label={error ? 'Повторить загрузку видео' : playLabel}
            onClick={() => void togglePlay()}
          >
            {state.ended || error ? (
              <RotateCcw size={24} />
            ) : (
              <Play size={25} fill="currentColor" />
            )}
          </button>
        )
      )}
      {(error || fullscreenError) && (
        <div className="chat-video-error" role="alert">
          {error || fullscreenError}
        </div>
      )}
      <div className="chat-video-controls">
        <input
          className="chat-video-seek"
          type="range"
          min={0}
          max={state.duration || 1}
          step={0.1}
          value={state.position}
          disabled={!state.duration}
          aria-label="Перемотка видео"
          aria-valuetext={
            formatMusicTime(state.position * 1000) +
            ' из ' +
            formatMusicTime(state.duration * 1000)
          }
          style={
            {
              '--video-progress': `${percent}%`,
              '--video-buffered': `${buffered}%`,
            } as CSSProperties
          }
          onChange={(event) => seek(Number(event.target.value))}
        />
        <div className="chat-video-control-row">
          <button
            type="button"
            className="chat-video-toggle"
            aria-label={playLabel}
            onClick={() => void togglePlay()}
          >
            {playing ? (
              <Pause size={17} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" />
            )}
          </button>
          <span className="chat-video-time" aria-label="Время видео">
            {formatMusicTime(state.position * 1000)}
            <span> / {formatMusicTime(state.duration * 1000)}</span>
          </span>
          <div className="chat-video-volume">
            <button
              type="button"
              aria-label={
                state.muted || state.volume === 0
                  ? 'Включить звук видео'
                  : 'Выключить звук видео'
              }
              onClick={toggleMute}
            >
              {state.muted || state.volume === 0 ? (
                <VolumeX size={18} />
              ) : (
                <Volume2 size={18} />
              )}
            </button>
            <div className="chat-video-volume-popup">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={state.muted ? 0 : state.volume}
                aria-label="Громкость видео"
                aria-valuetext={
                  Math.round((state.muted ? 0 : state.volume) * 100) + '%'
                }
                onChange={(event) => {
                  if (!video.current) return;
                  video.current.volume = Number(event.target.value);
                  video.current.muted = video.current.volume === 0;
                  sync();
                  showControls();
                }}
              />
            </div>
          </div>
          <button
            type="button"
            aria-label={
              fullscreen ? 'Выйти из полного экрана' : 'Видео на весь экран'
            }
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}
