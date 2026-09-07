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
      src="/assets/noct-stars.png"
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
      src="/assets/noctgram-logo.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className="noct-logo"
    />
  );
}
