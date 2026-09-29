'use client';
/* eslint-disable jsx-a11y/media-has-caption, jsx-a11y/prefer-tag-over-role */
import { useMemo, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';
import type { ChatAttachment } from '@/lib/chat-files';
import {
  decodeWaveform,
  formatRecordingTime,
  resampleWaveform,
  waveformBarCount,
} from '@/lib/voice-waveform';
import {
  claimMediaPlayback,
  nextVoiceRate,
  voiceRate,
} from '@/lib/media-playback';

const BAR = 2,
  GAP = 2,
  MIN_BAR = 4,
  MAX_BAR = 23;

// A Telegram-style voice message: play button, waveform with seeking, time,
// playback speed and a dot until the recipient has listened to it.
export function VoiceMessage({
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
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [rate, setRate] = useState(voiceRate),
    [failed, setFailed] = useState(false),
    [played, setPlayed] = useState(false);
  const heard = listened || played;
  const duration = Math.max(0, file.duration || 0);
  const count = waveformBarCount(duration);
  const bars = useMemo(
    () => resampleWaveform(decodeWaveform(file.waveform || ''), count),
    [file.waveform, count],
  );
  const width = count * (BAR + GAP) - GAP;
  const progress = duration ? Math.min(1, position / duration) : 0;
  const supported = useMemo(
    () =>
      typeof document === 'undefined' ||
      document.createElement('audio').canPlayType(file.type) !== '',
    [file.type],
  );
  const play = () => {
    const media = audio.current;
    if (!media) return;
    claimMediaPlayback(media);
    media.playbackRate = rate;
    void media.play().catch(() => setFailed(true));
    if (!heard) {
      setPlayed(true);
      onListened?.();
    }
  };
  const toggle = () => {
    const media = audio.current;
    if (!media) return;
    if (media.paused) play();
    else media.pause();
  };
  const seekTo = (event: React.PointerEvent<SVGSVGElement>) => {
    const media = audio.current;
    const box = event.currentTarget.getBoundingClientRect();
    if (!media || !box.width || !duration) return;
    const fraction = Math.max(
      0,
      Math.min(1, (event.clientX - box.left) / box.width),
    );
    media.currentTime = (fraction * duration) / 1000;
    setPosition(fraction * duration);
    if (media.paused) play();
  };
  if (!supported || failed)
    return (
      <a
        className="voice-message voice-message-fallback"
        href={src + '?download=1'}
        download
        data-chat-menu-exempt
      >
        <span className="voice-play" aria-hidden="true">
          <Download size={18} />
        </span>
        <span>
          <strong>Голосовое сообщение</strong>
          <small>
            {formatRecordingTime(duration)} · браузер не воспроизводит этот
            формат, скачайте файл
          </small>
        </span>
      </a>
    );
  return (
    <div
      className={
        'voice-message' + (own ? ' own' : '') + (playing ? ' playing' : '')
      }
      data-chat-menu-exempt
    >
      <button
        type="button"
        className="voice-play"
        aria-label={playing ? 'Пауза' : 'Прослушать голосовое сообщение'}
        onClick={toggle}
      >
        {playing ? (
          <Pause size={19} fill="currentColor" />
        ) : (
          <Play size={19} fill="currentColor" />
        )}
      </button>
      <div className="voice-body">
        <svg
          className="voice-waveform"
          width={width}
          height={MAX_BAR}
          viewBox={`0 0 ${width} ${MAX_BAR}`}
          role="slider"
          aria-label="Перемотка голосового сообщения"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration / 1000)}
          aria-valuenow={Math.round(position / 1000)}
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekTo(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons) seekTo(event);
          }}
          onKeyDown={(event) => {
            const media = audio.current;
            if (!media || !duration) return;
            const step =
              event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : 0;
            if (!step) return;
            event.preventDefault();
            media.currentTime = Math.max(
              0,
              Math.min(duration / 1000, media.currentTime + step),
            );
            setPosition(media.currentTime * 1000);
          }}
        >
          {bars.map((value, index) => {
            const height = Math.max(
              MIN_BAR,
              MIN_BAR + (value / 31) * (MAX_BAR - MIN_BAR),
            );
            return (
              <rect
                key={index}
                className={
                  (index + 0.5) / count <= progress ? 'played' : undefined
                }
                x={index * (BAR + GAP)}
                y={MAX_BAR - height}
                width={BAR}
                height={height}
                rx={1}
              />
            );
          })}
        </svg>
        <div className="voice-meta">
          <span className="voice-time">
            {formatRecordingTime(playing || position ? position : duration)}
          </span>
          {!heard && (
            <span className="voice-unlistened" aria-label="Не прослушано" />
          )}
          {(playing || position > 0) && (
            <button
              type="button"
              className="voice-rate"
              aria-label="Скорость воспроизведения"
              onClick={() => {
                const next = nextVoiceRate(rate);
                setRate(next);
                if (audio.current) audio.current.playbackRate = next;
              }}
            >
              {String(rate).replace('.', ',')}×
            </button>
          )}
          {metadata}
        </div>
      </div>
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) =>
          setPosition(event.currentTarget.currentTime * 1000)
        }
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
