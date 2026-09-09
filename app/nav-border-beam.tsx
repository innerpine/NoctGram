'use client';
import { useEffect, useRef } from 'react';
import { createBorderBeam } from '@/lib/nav-border-beam';

export function NavBorderBeam({ stars = false }: { stars?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const shell = canvas?.parentElement;
    if (!canvas || !shell) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let draw: ReturnType<typeof createBorderBeam> = null;
    let frame = 0;
    let visible = false;
    const tick = (time: number) => {
      draw?.(time);
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      if (draw && visible && !reduced.matches && !document.hidden) {
        draw(performance.now());
        frame = requestAnimationFrame(tick);
      }
    };
    const resize = new ResizeObserver(([entry]) => {
      draw = createBorderBeam(
        canvas,
        entry.contentRect.width,
        entry.contentRect.height,
        Math.min(window.devicePixelRatio || 1, 3),
        stars,
      );
      sync();
    });
    resize.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    intersection.observe(shell);
    reduced.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      reduced.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [stars]);
  return <canvas ref={ref} className="premium-nav-beam" aria-hidden="true" />;
}
