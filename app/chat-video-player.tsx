'use client';
/* Media events are the source of truth for playback and native fullscreen. */
/* eslint-disable react/react-compiler, jsx-a11y/media-has-caption */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
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
  Expand,
  X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { formatMusicTime } from '@/lib/music-links';
import {
  readVideoState,
  seekVideo,
  toggleVideoFullscreen,
  type FullscreenVideo,
  claimVideoPlayback,
  captureVideoPlayback,
  restoreVideoPosition,
  type VideoPlayback,
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
type PlayerProps = {
  src: string;
  name: string;
  metadata?: ReactNode;
  flush?: boolean;
};
export function ChatVideoPlayer(props: PlayerProps) {
  return <VideoWithViewer key={props.src} {...props} />;
}
function VideoWithViewer(props: PlayerProps) {
  const inline = useRef<FullscreenVideo | null>(null);
  const viewer = useRef<FullscreenVideo | null>(null);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<VideoPlayback | null>(null);
  const [accent, setAccent] = useState('#d0b8ed');
  const [aspect, setAspect] = useState(16 / 9);
  function expand() {
    if (!inline.current) return;
    setSnapshot(captureVideoPlayback(inline.current));
    setAspect(inline.current.videoWidth / inline.current.videoHeight || 16 / 9);
    setAccent(
      getComputedStyle(inline.current.parentElement!)
        .getPropertyValue('--video-accent')
        .trim(),
    );
    inline.current.pause();
    setOpen(true);
  }
  function close() {
    if (inline.current && viewer.current) {
      const playback =
        viewer.current.readyState >= 1
          ? captureVideoPlayback(viewer.current)
          : snapshot;
      viewer.current.pause();
      if (playback) {
        restoreVideoPosition(inline.current, playback);
        if (playback.playing) void inline.current.play().catch(() => {});
      }
    }
    setOpen(false);
  }
  return (
    <>
      <VideoPlayer {...props} mediaRef={inline} onExpand={expand} />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        onOpenChangeComplete={(next) => {
          if (!next) setSnapshot(null);
        }}
      >
        <DialogContent
          className="noct-video-viewer"
          style={
            {
              '--chat-accent': accent,
              '--video-aspect': aspect,
            } as CSSProperties
          }
          overlayClassName="noct-video-backdrop"
          showCloseButton={false}
        >
          <div className="noct-video-viewer-header">
            <DialogTitle>{props.name}</DialogTitle>
            <button type="button" onClick={close} aria-label="Закрыть видео">
              <X size={20} />
            </button>
          </div>
          {snapshot && (
            <VideoPlayer
              src={props.src}
              name={props.name}
              viewer
              mediaRef={viewer}
              initialPlayback={snapshot}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function VideoPlayer({
  src,
  name,
  metadata,
  flush = false,
  viewer = false,
  mediaRef,
  initialPlayback,
  onExpand,
}: PlayerProps & {
  viewer?: boolean;
  mediaRef?: RefObject<FullscreenVideo | null>;
  initialPlayback?: VideoPlayback;
  onExpand?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    video = useRef<FullscreenVideo>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true),
    playPending = useRef(false);
  const playRequest = useRef(0);
  const scrubbing = useRef(false),
    resumeAfterSeek = useRef(false);
  const controlsHovered = useRef(false);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
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
    if (
      video.current &&
      !video.current.paused &&
      !scrubbing.current &&
      !controlsHovered.current
    ) {
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
    if (mediaRef) mediaRef.current = element;
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
    let restored = false;
    const restore = () => {
      if (!element || !initialPlayback || restored) return;
      restored = true;
      restoreVideoPosition(element, initialPlayback);
      sync();
      if (initialPlayback.playing) void togglePlay();
    };
    if (element && element.readyState >= 1) restore();
    element?.addEventListener('loadedmetadata', restore);
    return () => {
      alive.current = false;
      playRequest.current++;
      playPending.current = false;
      stopHideTimer();
      element?.pause();
      if (mediaRef) mediaRef.current = null;
      element?.removeEventListener('loadedmetadata', restore);
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
      playRequest.current++;
      playPending.current = false;
      element.pause();
      return;
    }
    if (playPending.current) return;
    if (element.ended) seekVideo(element, 0);
    playPending.current = true;
    const request = ++playRequest.current;
    try {
      if (element.error) element.load();
      await element.play();
    } catch (cause) {
      if (
        alive.current &&
        request === playRequest.current &&
        (cause as Error).name !== 'AbortError'
      ) {
        setBuffering(false);
        setError('Не удалось воспроизвести видео. Попробуйте ещё раз.');
      }
    } finally {
      if (request === playRequest.current) playPending.current = false;
    }
  }
  function seek(position: number) {
    if (video.current) seekVideo(video.current, position);
    sync();
    showControls();
  }
  function finishSeek(value: string) {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    seek(Number(value));
    setSeekPreview(null);
    if (resumeAfterSeek.current && video.current?.paused) void togglePlay();
    resumeAfterSeek.current = false;
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
  const position = seekPreview ?? state.position;
  const percent = state.duration ? (position / state.duration) * 100 : 0;
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
      data-controls={
        visible || !playing || !!error || buffering || seekPreview !== null
      }
      data-flush={flush}
      data-viewer={viewer}
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
          if (onExpand) onExpand();
          else void toggleFullscreen();
        }
      }}
    >
      <video
        ref={video}
        src={src}
        playsInline
        preload="metadata"
        aria-label={name}
        onClick={(event) => {
          // The first touch reveals controls without unexpectedly pausing the clip.
          if (
            (event.nativeEvent as PointerEvent).pointerType === 'touch' &&
            playing
          )
            showControls();
          else void togglePlay();
        }}
        onLoadedMetadata={sync}
        onDurationChange={sync}
        onTimeUpdate={sync}
        onProgress={sync}
        onVolumeChange={sync}
        onPlay={() => {
          if (video.current) claimVideoPlayback(video.current);
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
          setBuffering(!!video.current && !video.current.paused);
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
        href={src + (src.includes('?') ? '&' : '?') + 'download=1'}
        download={name}
        title="Скачать видео"
        aria-label={'Скачать видео ' + name}
      >
        <Download size={16} />
      </a>
      {buffering && playing ? (
        <span
          className="chat-video-center"
          role="status"
          aria-label="Загрузка видео"
        >
          <LoaderCircle size={25} className="spin" />
        </span>
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
      <div
        className="chat-video-controls"
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') {
            controlsHovered.current = true;
            stopHideTimer();
          }
        }}
        onPointerLeave={() => {
          controlsHovered.current = false;
          showControls();
        }}
      >
        <input
          className="chat-video-seek"
          type="range"
          min={0}
          max={state.duration || 1}
          step={0.1}
          value={position}
          disabled={!state.duration}
          aria-label="Перемотка видео"
          aria-valuetext={
            formatMusicTime(position * 1000) +
            ' из ' +
            formatMusicTime(state.duration * 1000)
          }
          style={
            {
              '--video-progress': `${percent}%`,
              '--video-buffered': `${buffered}%`,
            } as CSSProperties
          }
          onPointerDown={(event) => {
            scrubbing.current = true;
            resumeAfterSeek.current = !!video.current && !video.current.paused;
            video.current?.pause();
            stopHideTimer();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => finishSeek(event.currentTarget.value)}
          onPointerCancel={(event) => finishSeek(event.currentTarget.value)}
          onLostPointerCapture={(event) =>
            finishSeek(event.currentTarget.value)
          }
          onChange={(event) => {
            if (scrubbing.current) setSeekPreview(Number(event.target.value));
            else seek(Number(event.target.value));
          }}
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
            {formatMusicTime(position * 1000)}
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
              onExpand
                ? 'Раскрыть видео'
                : fullscreen
                  ? 'Выйти из полного экрана'
                  : 'Видео на весь экран'
            }
            onClick={() => {
              if (onExpand) onExpand();
              else void toggleFullscreen();
            }}
          >
            {onExpand ? (
              <Expand size={18} />
            ) : fullscreen ? (
              <Minimize size={18} />
            ) : (
              <Maximize size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
