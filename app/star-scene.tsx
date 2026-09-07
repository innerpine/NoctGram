'use client';
import { useState, type CSSProperties } from 'react';
import { PremiumIcon } from './premium-icon';
import { StarsIcon } from './stars-icon';
const particles = [
  [-108, -56, 15, -42, 0],
  [-58, -76, 12, 28, 0.22],
  [3, -83, 13, -24, 0.45],
  [64, -66, 18, 40, 0.13],
  [113, -36, 12, 65, 0.64],
  [120, 12, 15, -38, 0.36],
  [84, 61, 11, 54, 0.78],
  [35, 76, 14, -28, 0.28],
  [-35, 72, 11, 48, 0.92],
  [-94, 45, 17, -55, 0.53],
  [-124, 3, 11, 32, 0.82],
  [42, -38, 9, -70, 1.1],
];

export function StarScene({
  variant = 'premium',
}: {
  variant?: 'premium' | 'stars';
}) {
  const [burst, setBurst] = useState(0);
  const Icon = variant === 'stars' ? StarsIcon : PremiumIcon;
  return (
    <button
      type="button"
      className="premium-scene"
      onClick={() => setBurst((v) => v + 1)}
      aria-label={
        variant === 'stars'
          ? 'Повторить анимацию Stars'
          : 'Повторить анимацию Premium'
      }
      title="Нажми на значок"
    >
      <span className="premium-particles" key={burst} aria-hidden="true">
        {particles.map(([x, y, size, rotate, delay], i) => (
          <Icon
            key={i}
            size={size}
            className="premium-particle"
            style={
              {
                '--fly-x': x + 'px',
                '--fly-y': y + 'px',
                '--mid-x': x * 0.58 + 'px',
                '--mid-y': y * 0.58 + 'px',
                '--turn': rotate + 'deg',
                '--delay': delay + 's',
                '--size': size + 'px',
              } as CSSProperties
            }
          />
        ))}
      </span>
      <span className="premium-star-float">
        <Icon size={116} className="premium-star-main" />
      </span>
    </button>
  );
}
