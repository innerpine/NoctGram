'use client';
import { memo, useEffect, useRef } from 'react';
import { useRainPreference, rainEnabled } from '@/lib/rain-preference';
import { attachRain, type RainScope } from '@/lib/rain-engine';

export const RainEffect = memo(function RainEffect({
  scope,
  active = true,
}: {
  scope: RainScope;
  active?: boolean;
}) {
  const preference = useRainPreference();
  const enabled = active && rainEnabled(preference, scope);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!enabled || !canvas.current) return;
    return attachRain(canvas.current, scope);
  }, [enabled, scope]);
  return enabled ? (
    <canvas
      ref={canvas}
      className="noct-rain"
      data-rain-surface={scope}
      aria-hidden="true"
    />
  ) : null;
});
