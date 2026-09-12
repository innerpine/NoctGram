/* eslint-disable next/no-img-element */
import type { CSSProperties } from 'react';
export function StarsIcon({
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
      src="/assets/noct-stars-96.webp"
      srcSet="/assets/noct-stars-48.webp 48w, /assets/noct-stars-96.webp 96w, /assets/noct-stars-192.webp 192w"
      sizes={`${size}px`}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className={'premium-icon stars-icon ' + className}
      style={style}
    />
  );
}
export function NoctLogo({ size = 40 }: { size?: number }) {
  return (
    <img
      src="/assets/noctgram-logo-96.webp"
      srcSet="/assets/noctgram-logo-48.webp 48w, /assets/noctgram-logo-96.webp 96w, /assets/noctgram-logo-192.webp 192w, /assets/noctgram-logo-512.webp 512w"
      sizes={`${size}px`}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className="noct-logo"
    />
  );
}
