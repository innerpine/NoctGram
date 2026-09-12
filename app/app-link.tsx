'use client';
import type { ComponentProps } from 'react';

// Real URLs retain browser link behavior; ordinary clicks use the existing
// application navigation so the persistent music player is never remounted.
export function AppLink({
  onNavigate,
  onClick,
  href,
  children,
  className = '',
  ...props
}: ComponentProps<'a'> & { href: string; onNavigate: () => void }) {
  return (
    <a
      {...props}
      href={href}
      className={'app-link ' + className}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey ||
          (event.currentTarget.target &&
            event.currentTarget.target !== '_self') ||
          event.currentTarget.hasAttribute('download')
        )
          return;
        event.preventDefault();
        onNavigate();
      }}
    >
      {children}
    </a>
  );
}
