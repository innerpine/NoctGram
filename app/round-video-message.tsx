'use client';
/* eslint-disable react/react-compiler, jsx-a11y/media-has-caption */
import { useEffect, useRef, useState } from 'react';
import { VolumeX } from 'lucide-react';
import type { ChatAttachment } from '@/lib/chat-files';
import { formatRecordingTime } from '@/lib/voice-waveform';
import { claimMediaPlayback } from '@/lib/media-playback';

const RING = 2 * Math.PI * 48;

// A round video message: silent loop while visible, a tap plays it from the
// start with sound and a progress ring, another tap pauses.
export function RoundVideoMessage({
  file,
  src,
  own = false,
  listened = true,
  onListened,
  metadata,
}: {
  file: ChatAttachment;
  src: string;
  own?: boolean;
  listened?: boolean;
  onListened?: () => void;
  metadata?: React.ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null),
    root = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<'preview' | 'playing' | 'paused'>(
      'preview',
    ),
    [progress, setProgress] = useState(0),
    [position, setPosition] = useState(0),
    [played, setPlayed] = useState(false),
    [failed, setFailed] = useState(false);
  const heard = listened || played;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const duration = file.duration || 0;
  useEffect(() => {
    const element = root.current,
      media = video.current;
    if (!element || !media || typeof IntersectionObserver === 'undefined')
      return;
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (modeRef.current !== 'preview') {
          if (!entry.isIntersecting && !media.paused) media.pause();
          return;
        }
        if (entry.isIntersecting && !reduced) {
          media.muted = true;
          media.loop = true;
          void media.play().catch(() => {});
        } else media.pause();
      },
      { threshold: 0.6 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const toggle = () => {
    const media = video.current;
    if (!media) return;
    if (mode === 'playing') {
      media.pause();
      setMode('paused');
      return;
    }
    if (mode === 'preview') {
      media.currentTime = 0;
      media.loop = false;
    }
    media.muted = false;
    claimMediaPlayback(media);
    void media.play().catch(() => setFailed(true));
    setMode('playing');
    if (!heard) {
      setPlayed(true);
      onListened?.();
    }
  };
  const remaining = Math.max(0, duration - position);
  return (
    <button
      ref={root}
      type="button"
      className={'round-video ' + mode + (own ? ' own' : '')}
      aria-label={
        mode === 'playing' ? 'Пауза' : 'Смотреть видеосообщение со звуком'
      }
      aria-pressed={mode === 'playing'}
      data-chat-menu-exempt
      onClick={toggle}
    >
      <video
        ref={video}
        src={src}
        muted
        playsInline
        preload="metadata"
        onPause={() => {
          if (modeRef.current === 'playing') setMode('paused');
        }}
        onTimeUpdate={(event) => {
          const media = event.currentTarget;
          if (modeRef.current === 'preview') return;
          setPosition(media.currentTime * 1000);
          setProgress(
            media.duration && Number.isFinite(media.duration)
              ? media.currentTime / media.duration
              : duration
                ? (media.currentTime * 1000) / duration
                : 0,
          );
        }}
        onEnded={(event) => {
          const media = event.currentTarget;
          setMode('preview');
          setProgress(0);
          setPosition(0);
          media.muted = true;
          media.loop = true;
          media.currentTime = 0;
          void media.play().catch(() => {});
        }}
        onError={() => setFailed(true)}
      />
      {failed && (
        <span className="round-video-error">Видео недоступно</span>
      )}
      <svg className="round-video-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle
          cx="50"
          cy="50"
          r="48"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - progress)}
        />
      </svg>
      <span className="round-video-info">
        {formatRecordingTime(mode === 'preview' ? duration : remaining)}
        {mode !== 'playing' && <VolumeX size={12} aria-hidden="true" />}
        {!heard && (
          <span className="voice-unlistened" aria-label="Не просмотрено" />
        )}
      </span>
      {metadata}
    </button>
  );
}
