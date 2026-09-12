'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useState, type ReactNode } from 'react';

/** Load a tab on its first visit, then keep its draft across tab changes. */
export function EditorPane({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(active);
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) {
      setVisited(true);
      setPresent(true);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPresent(false);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), 220);
    return () => window.clearTimeout(timer);
  }, [active]);
  return (
    <div
      className="profile-editor-pane"
      data-active={active}
      hidden={!active && !present}
      inert={!active || undefined}
      aria-hidden={!active}
    >
      {(active || visited) && children}
    </div>
  );
}
