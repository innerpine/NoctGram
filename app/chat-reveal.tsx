'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Retain a closing toolbar briefly, but remove it from focus/accessibility immediately. */
export function ChatReveal({ children }: { children: ReactNode }) {
  const open = !!children;
  const retained = useRef<ReactNode>(null);
  const [expanded, setExpanded] = useState(false);
  const [, refresh] = useState(0);
  if (open) retained.current = children;
  useEffect(() => {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (open) {
      if (reduced) setExpanded(true);
      else
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => setExpanded(true));
        });
    } else {
      setExpanded(false);
      timer = setTimeout(
        () => {
          retained.current = null;
          refresh((value) => value + 1);
        },
        reduced ? 0 : 220,
      );
    }
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [open]);
  return (
    <div
      className="chat-reveal"
      data-expanded={expanded}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="chat-reveal-inner">
        {open ? children : retained.current}
      </div>
    </div>
  );
}
