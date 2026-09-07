/* The mascot is a decorative pull toy, so the sprite stays an <img> the gesture can
   transform directly. */
/* eslint-disable next/no-img-element */
import type { CSSProperties } from 'react';
import { landMascot, pullMascot } from './mascot-drag';

export function NoctMascot({
  size = 144,
  className = '',
  style,
}: {
  /* Whole multiple of 48 only — the sprite is 48x48 pixel art and any other size
     makes the scaler invent half pixels. 48, 96, 144, 192, 240, 288. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <img
      src="/assets/noct-mascot.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className={'noct-mascot ' + className}
      style={style}
      onPointerDown={pullMascot}
      onAnimationEnd={landMascot}
    />
  );
}
