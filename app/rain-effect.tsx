'use client';
import { memo, useEffect, useRef, useState } from 'react';
import { useRainPreference, rainEnabled } from '@/lib/rain-preference';
import { attachRain, type RainScope, type RainHandle } from '@/lib/rain-engine';

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
  const [forceMain, setForceMain] = useState(false);
  const engine = useRef<RainHandle | null>(null);
  const { fps, intensity, speed, brightness } = preference;
  useEffect(() => {
    if (!enabled || !canvas.current) return;
    const handle = attachRain(canvas.current, scope, {
      forceMain,
      failed: () => setForceMain(true),
    });
    engine.current = handle;
    return () => {
      handle();
      engine.current = null;
    };
  }, [enabled, scope, forceMain]);
  useEffect(() => {
    engine.current?.update({ fps, intensity, speed, brightness });
  }, [enabled, scope, forceMain, fps, intensity, speed, brightness]);
  return enabled ? (
    <canvas
      key={forceMain ? 'main' : 'worker'}
      ref={canvas}
      className="noct-rain"
      data-rain-surface={scope}
      aria-hidden="true"
    />
  ) : null;
});
