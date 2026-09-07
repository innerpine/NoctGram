/* The supplied PNG is shared by the badge and its animated particles. */
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
      src="/assets/noct-premium.png"
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
