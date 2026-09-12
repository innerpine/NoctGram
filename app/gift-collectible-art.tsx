'use client';
import type { CSSProperties, ReactNode } from 'react';
import type { GiftAttributes } from '@/lib/gift-collectibles';
import { GiftAnimation } from './gift-animation';

// Radial rows leave the center clear for the model, as in Telegram's gift header.
const positions = [
  [10, 14, 24],
  [29, 7, 20],
  [50, 3, 16],
  [71, 7, 20],
  [90, 14, 24],
  [3, 37, 20],
  [20, 31, 23],
  [37, 22, 17],
  [63, 22, 17],
  [80, 31, 23],
  [97, 37, 20],
  [8, 61, 25],
  [27, 54, 20],
  [73, 54, 20],
  [92, 61, 25],
  [1, 84, 18],
  [20, 84, 22],
  [38, 74, 18],
  [62, 74, 18],
  [80, 84, 22],
  [99, 84, 18],
  [39, 99, 21],
  [61, 99, 21],
];
export function GiftCollectibleArt({
  family,
  attributes,
  animate = true,
  children,
}: {
  family: string;
  attributes: GiftAttributes;
  animate?: boolean;
  children?: ReactNode;
}) {
  const { backdrop, model, symbol } = attributes;
  return (
    <div
      className="gift-collectible-scene"
      style={
        {
          '--collectible-center': backdrop.centerColor,
          '--collectible-edge': backdrop.edgeColor,
          '--collectible-pattern': backdrop.patternColor,
          '--collectible-text': backdrop.textColor,
        } as CSSProperties
      }
    >
      <div
        className="gift-collectible-pattern"
        aria-hidden="true"
        key={symbol.asset}
      >
        {positions.map(([x, y, size], index) => (
          <i
            key={index}
            style={{
              left: x + '%',
              top: y + '%',
              width: size,
              height: size,
              maskImage: `url(/assets/gifts/${symbol.asset}.webp)`,
            }}
          />
        ))}
      </div>
      <div className="gift-collectible-model">
        <GiftAnimation id={family} asset={model.asset} animate={animate} />
      </div>
      {children}
    </div>
  );
}
