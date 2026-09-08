'use client';
import { useEffect, useRef, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { formatMusicTime } from '@/lib/music-links';

export function MusicSeekControl({
  position,
  duration,
  disabled,
  label,
  onSeek,
}: {
  position: number;
  duration: number;
  disabled: boolean;
  label: string;
  onSeek: (ms: number) => void;
}) {
  // Audio samples keep arriving during a drag. Preview locally and send only the
  // committed position to the engine/room, never every pointer movement.
  const [draft, setDraft] = useState<number | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    const release = () => setDraft(null);
    const cancel = () => {
      cancelled.current = true;
      setDraft(null);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('touchend', release);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchcancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('touchend', release);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchcancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, []);
  const shown = Math.max(0, Math.min(draft ?? position, duration));
  return (
    <div className="music-progress">
      <span>{formatMusicTime(shown)}</span>
      <Slider
        aria-label={label}
        min={0}
        max={Math.max(duration, 1)}
        step={1000}
        value={[shown]}
        disabled={disabled}
        onPointerDownCapture={() => {
          cancelled.current = false;
        }}
        onTouchStartCapture={() => {
          cancelled.current = false;
        }}
        onKeyDownCapture={() => {
          cancelled.current = false;
        }}
        onValueChange={(value, details) => {
          if (details.reason === 'input-change') cancelled.current = false;
          if (!cancelled.current)
            setDraft(Array.isArray(value) ? value[0] : value);
        }}
        onValueCommitted={(value) => {
          setDraft(null);
          if (!disabled && !cancelled.current)
            onSeek(
              Math.max(
                0,
                Math.min(Array.isArray(value) ? value[0] : value, duration),
              ),
            );
        }}
      />
      <span>{formatMusicTime(duration)}</span>
    </div>
  );
}
