'use client';
/* eslint-disable react/react-compiler, jsx-a11y/media-has-caption, jsx-a11y/prefer-tag-over-role */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronUp,
  Lock,
  Mic,
  Pause,
  Play,
  Send,
  Square,
  SwitchCamera,
  Trash2,
  Video,
} from 'lucide-react';
import {
  MediaRecording,
  ROUND_LIMIT_MS,
  recordingError,
  recordingSupport,
  type RecordingKind,
  type RecordingResult,
} from '@/lib/media-recorder';
import {
  decodeWaveform,
  formatRecordingTime,
  resampleWaveform,
} from '@/lib/voice-waveform';
import {
  claimMediaPlayback,
  preferredRecordMode,
  rememberRecordMode,
} from '@/lib/media-playback';

type Phase = 'idle' | 'starting' | 'recording' | 'locked' | 'preview';
const HOLD_MS = 180,
  CANCEL_PX = 110,
  LOCK_PX = 70,
  RING = 2 * Math.PI * 176;

// Telegram-style recording: tap switches between voice and round video, hold
// records, slide left cancels, slide up locks. Locked recordings can be
// stopped for a preview before sending.
export function ChatRecorder({
  disabled,
  onRecorded,
  onError,
  onActiveChange,
}: {
  disabled: boolean;
  onRecorded: (result: RecordingResult) => void;
  onError: (message: string) => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const [mode, setMode] = useState<RecordingKind>('voice');
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0),
    [level, setLevel] = useState(0),
    [shift, setShift] = useState({ x: 0, y: 0 }),
    [result, setResult] = useState<RecordingResult | null>(null),
    [previewPlaying, setPreviewPlaying] = useState(false),
    [previewPosition, setPreviewPosition] = useState(0),
    [cameraStream, setCameraStream] = useState<MediaStream | null>(null),
    [mirrored, setMirrored] = useState(true),
    [live, setLive] = useState<number[]>([]);
  const session = useRef<MediaRecording | null>(null),
    phaseRef = useRef<Phase>('idle'),
    hold = useRef(0),
    ticker = useRef(0),
    pointer = useRef<{ id: number; x: number; y: number } | null>(null),
    released = useRef(false),
    alive = useRef(true),
    previewMedia = useRef<HTMLMediaElement | null>(null),
    resultRef = useRef<RecordingResult | null>(null);
  const setStage = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  useEffect(() => {
    setMode(preferredRecordMode());
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(hold.current);
      window.clearInterval(ticker.current);
      session.current?.cancel();
      session.current = null;
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.preview);
    };
  }, []);
  const active = phase !== 'idle';
  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);
  const clearResult = () => {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.preview);
    resultRef.current = null;
    setResult(null);
    setPreviewPlaying(false);
    setPreviewPosition(0);
  };
  const reset = () => {
    window.clearInterval(ticker.current);
    session.current = null;
    pointer.current = null;
    released.current = false;
    setCameraStream(null);
    setShift({ x: 0, y: 0 });
    setLevel(0);
    setElapsed(0);
    setLive([]);
    setStage('idle');
  };
  const cancel = () => {
    window.clearTimeout(hold.current);
    session.current?.cancel();
    clearResult();
    reset();
  };
  const finish = async (send: boolean) => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    window.clearInterval(ticker.current);
    const recorded = await current.stop().catch(() => null);
    if (!alive.current) return;
    setCameraStream(null);
    if (!recorded) {
      reset();
      onError(
        mode === 'voice'
          ? 'Удерживайте кнопку, чтобы записать голосовое сообщение'
          : 'Удерживайте кнопку, чтобы записать видеосообщение',
      );
      return;
    }
    if (send) {
      URL.revokeObjectURL(recorded.preview);
      reset();
      onRecorded(recorded);
      return;
    }
    resultRef.current = recorded;
    setResult(recorded);
    setShift({ x: 0, y: 0 });
    setStage('preview');
  };
  const begin = async (kind: RecordingKind, locked: boolean) => {
    if (disabled || phaseRef.current !== 'idle') return;
    const unsupported = recordingSupport(kind);
    if (unsupported) {
      onError(unsupported);
      return;
    }
    released.current = false;
    setStage('starting');
    let recording: MediaRecording;
    try {
      recording = await MediaRecording.start(kind);
    } catch (error) {
      if (alive.current) {
        reset();
        onError(recordingError(error, kind));
      }
      return;
    }
    if (!alive.current || (phaseRef.current as Phase) !== 'starting') {
      recording.cancel();
      return;
    }
    if (released.current && !locked) {
      // The button was released while permissions were being granted.
      recording.cancel();
      reset();
      onError('Удерживайте кнопку во время записи');
      return;
    }
    session.current = recording;
    recording.onLevel = (value) => {
      setLevel(value);
      if (kind === 'voice')
        setLive((previous) => [...previous.slice(-47), Math.round(value * 31)]);
    };
    if (kind === 'round') {
      setCameraStream(recording.stream);
      setMirrored(true);
    }
    setStage(locked ? 'locked' : 'recording');
    ticker.current = window.setInterval(() => {
      const current = session.current;
      if (!current) return;
      const time = current.elapsed();
      setElapsed(time);
      if (kind === 'round' && time >= ROUND_LIMIT_MS)
        void finish(phaseRef.current === 'recording');
    }, 100);
  };
  useEffect(() => {
    if (!active) return;
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      } else if (
        event.key === 'Enter' &&
        (phaseRef.current === 'locked' || phaseRef.current === 'preview')
      ) {
        event.preventDefault();
        if (phaseRef.current === 'locked') void finish(true);
        else if (resultRef.current) sendPreview();
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });
  const sendPreview = () => {
    const recorded = resultRef.current;
    if (!recorded) return;
    previewMedia.current?.pause();
    resultRef.current = null;
    setResult(null);
    URL.revokeObjectURL(recorded.preview);
    reset();
    onRecorded(recorded);
  };
  const toggleMode = () => {
    const next = mode === 'voice' ? 'round' : 'voice';
    setMode(next);
    rememberRecordMode(next);
  };
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    if (phaseRef.current === 'locked') {
      event.preventDefault();
      void finish(true);
      return;
    }
    if (phaseRef.current === 'preview') {
      event.preventDefault();
      sendPreview();
      return;
    }
    if (phaseRef.current !== 'idle') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    const kind = mode;
    hold.current = window.setTimeout(() => {
      hold.current = 0;
      void begin(kind, false);
    }, HOLD_MS);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId) return;
    if (phaseRef.current !== 'recording') return;
    const x = Math.min(0, event.clientX - start.x),
      y = Math.min(0, event.clientY - start.y);
    setShift({ x, y });
    if (x < -CANCEL_PX) cancel();
    else if (y < -LOCK_PX) {
      pointer.current = null;
      setShift({ x: 0, y: 0 });
      setStage('locked');
    }
  };
  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId) return;
    pointer.current = null;
    if (hold.current) {
      // A short tap switches between voice and round video, like Telegram.
      window.clearTimeout(hold.current);
      hold.current = 0;
      toggleMode();
      return;
    }
    if (phaseRef.current === 'starting') released.current = true;
    else if (phaseRef.current === 'recording') void finish(true);
  };
  const onPointerCancel = () => {
    if (hold.current) {
      window.clearTimeout(hold.current);
      hold.current = 0;
    }
    pointer.current = null;
    if (phaseRef.current === 'recording') cancel();
    else if (phaseRef.current === 'starting') released.current = true;
  };
  const kind = session.current?.kind ?? result?.kind ?? mode;
  const previewBars =
    result?.kind === 'voice'
      ? resampleWaveform(decodeWaveform(result.waveform), 48)
      : [];
  const liveBars = resampleWaveform(live, 48);
  const bars = phase === 'preview' ? previewBars : liveBars;
  const previewProgress =
    result && result.duration ? previewPosition / result.duration : 0;
  const togglePreview = () => {
    const media = previewMedia.current;
    if (!media) return;
    if (media.paused) {
      claimMediaPlayback(media);
      void media.play().catch(() => {});
    } else media.pause();
  };
  const buttonLabel =
    phase === 'locked' || phase === 'preview'
      ? 'Отправить запись'
      : mode === 'voice'
        ? 'Голосовое сообщение: удерживайте для записи, нажмите для видеосообщения'
        : 'Видеосообщение: удерживайте для записи, нажмите для голосового';
  return (
    <>
      {active && (
        <div
          className={'chat-recording-bar ' + phase + ' ' + kind}
          style={
            {
              '--record-shift': `${shift.x}px`,
            } as React.CSSProperties
          }
        >
          {phase === 'locked' || phase === 'preview' ? (
            <button
              type="button"
              className="chat-recording-trash"
              aria-label="Удалить запись"
              onClick={cancel}
            >
              <Trash2 size={19} />
            </button>
          ) : (
            <span className="chat-recording-dot" aria-hidden="true" />
          )}
          {phase === 'preview' && result ? (
            <div className="chat-recording-preview">
              <button
                type="button"
                className="chat-recording-play"
                aria-label={previewPlaying ? 'Пауза' : 'Прослушать запись'}
                onClick={togglePreview}
              >
                {previewPlaying ? (
                  <Pause size={16} fill="currentColor" />
                ) : (
                  <Play size={16} fill="currentColor" />
                )}
              </button>
              {result.kind === 'voice' && (
                <span className="chat-recording-wave" aria-hidden="true">
                  {bars.map((value, index) => (
                    <i
                      key={index}
                      className={
                        (index + 0.5) / bars.length <= previewProgress
                          ? 'played'
                          : undefined
                      }
                      style={{ height: 4 + (value / 31) * 18 + 'px' }}
                    />
                  ))}
                </span>
              )}
              <span className="chat-recording-time">
                {formatRecordingTime(
                  previewPlaying ? previewPosition : result.duration,
                )}
              </span>
              {result.kind === 'voice' && (
                <audio
                  ref={(node) => {
                    previewMedia.current = node;
                  }}
                  src={result.preview}
                  onPlay={() => setPreviewPlaying(true)}
                  onPause={() => setPreviewPlaying(false)}
                  onEnded={() => {
                    setPreviewPlaying(false);
                    setPreviewPosition(0);
                  }}
                  onTimeUpdate={(event) =>
                    setPreviewPosition(event.currentTarget.currentTime * 1000)
                  }
                />
              )}
            </div>
          ) : (
            <>
              <span className="chat-recording-time" aria-live="off">
                {phase === 'starting'
                  ? 'Подготовка…'
                  : formatRecordingTime(elapsed, true)}
              </span>
              {kind === 'voice' && phase !== 'starting' && (
                <span className="chat-recording-wave live" aria-hidden="true">
                  {bars.map((value, index) => (
                    <i key={index} style={{ height: 4 + (value / 31) * 18 + 'px' }} />
                  ))}
                </span>
              )}
              {phase === 'recording' && (
                <span className="chat-recording-hint">
                  <ChevronLeft size={15} /> Влево — отмена
                </span>
              )}
              {phase === 'locked' && (
                <button
                  type="button"
                  className="chat-recording-stop"
                  aria-label="Остановить и прослушать"
                  onClick={() => void finish(false)}
                >
                  <Square size={14} fill="currentColor" />
                </button>
              )}
            </>
          )}
        </div>
      )}
      {phase === 'recording' && (
        <span
          className="chat-recording-lock"
          aria-hidden="true"
          style={
            {
              '--lock-shift': `${Math.max(-LOCK_PX, shift.y)}px`,
            } as React.CSSProperties
          }
        >
          <Lock size={15} />
          <ChevronUp size={14} />
        </span>
      )}
      <button
        type="button"
        className={
          'chat-record-button ' +
          (active ? 'active ' + phase : '') +
          (mode === 'round' ? ' round-mode' : '')
        }
        style={{ '--level': level } as React.CSSProperties}
        disabled={disabled && !active}
        aria-label={buttonLabel}
        title={
          active
            ? undefined
            : mode === 'voice'
              ? 'Удерживайте для записи голосового. Нажмите, чтобы переключиться на видеосообщение'
              : 'Удерживайте для записи видеосообщения. Нажмите, чтобы переключиться на голосовое'
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (
            (event.key === 'Enter' || event.key === ' ') &&
            !event.repeat &&
            phaseRef.current === 'idle'
          ) {
            event.preventDefault();
            void begin(mode, true);
          }
        }}
      >
        {phase === 'locked' || phase === 'preview' ? (
          <Send size={21} fill="currentColor" strokeWidth={1.5} />
        ) : kind === 'round' ? (
          <Video size={22} />
        ) : (
          <Mic size={22} />
        )}
      </button>
      {kind === 'round' &&
        active &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="round-recorder" role="dialog" aria-label="Запись видеосообщения">
            <div className="round-recorder-stage">
              {phase === 'preview' && result ? (
                <video
                  ref={(node) => {
                    previewMedia.current = node;
                  }}
                  src={result.preview}
                  playsInline
                  autoPlay
                  loop
                  onPlay={() => setPreviewPlaying(true)}
                  onPause={() => setPreviewPlaying(false)}
                  onClick={togglePreview}
                />
              ) : (
                cameraStream && (
                  <video
                    className={mirrored ? 'mirrored' : undefined}
                    ref={(node) => {
                      if (node && node.srcObject !== cameraStream) {
                        node.srcObject = cameraStream;
                        void node.play().catch(() => {});
                      }
                    }}
                    muted
                    playsInline
                    autoPlay
                  />
                )
              )}
              <svg className="round-recorder-ring" viewBox="0 0 360 360" aria-hidden="true">
                <circle
                  cx="180"
                  cy="180"
                  r="176"
                  strokeDasharray={RING}
                  strokeDashoffset={
                    RING *
                    (1 -
                      Math.min(
                        1,
                        (phase === 'preview' && result
                          ? result.duration
                          : elapsed) / ROUND_LIMIT_MS,
                      ))
                  }
                />
              </svg>
            </div>
            {phase === 'locked' && (
              <button
                type="button"
                className="round-recorder-flip"
                aria-label="Сменить камеру"
                onClick={() => {
                  const current = session.current;
                  if (!current) return;
                  void current
                    .flipCamera()
                    .then(() => {
                      setMirrored(current.facingMode === 'user');
                      setCameraStream(new MediaStream(current.stream.getTracks()));
                    })
                    .catch((error) => onError(recordingError(error, 'round')));
                }}
              >
                <SwitchCamera size={20} />
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
