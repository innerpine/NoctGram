/* Optimized sizes of the supplied artwork are shared by icons and particles. */
/* eslint-disable next/no-img-element */
import type { CSSProperties } from 'react';

export function PremiumIcon({
  size = 24,
  className = '',
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <img
      src="/assets/noct-premium-96.webp"
      srcSet="/assets/noct-premium-48.webp 48w, /assets/noct-premium-96.webp 96w, /assets/noct-premium-192.webp 192w"
      sizes={`${size}px`}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className={'premium-icon ' + className}
      style={style}
    />
  );
}
