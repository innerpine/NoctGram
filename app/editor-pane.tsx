'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useState, type ReactNode } from 'react';

/** Keep unsaved form state; hide inactive previews after their exit completes. */
export function EditorPane({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(active);
  useEffect(() => {
    if (active) {
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
      {children}
    </div>
  );
}
