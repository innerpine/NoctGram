'use client';
/* eslint-disable react/react-compiler, next/no-img-element */
import { memo, useEffect, useRef, useState } from 'react';
import { giftDefinition } from '@/lib/gift-catalog';
import { mountGiftAnimation } from '@/lib/gift-animation-runtime';

export const GiftAnimation = memo(function GiftAnimation({
  id,
  asset,
  animate = true,
}: {
  id: string;
  asset?: string;
  animate?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState(false);
  const gift = giftDefinition(id);
  const art =
    asset && /^collectible-[a-z_]+-[a-f0-9]{12}$/.test(asset) ? asset : id;
  useEffect(() => {
    setLoaded(false);
    if (!host.current || !gift || !animate) return;
    return mountGiftAnimation(host.current, art, setLoaded);
  }, [art, gift, animate]);
  if (!gift) return null;
  return (
    <span className="gift-art" data-animated={loaded} aria-hidden="true">
      <img
        src={`/assets/gifts/${art}.webp`}
        alt=""
        loading="lazy"
        decoding="async"
      />
      <span ref={host} className="gift-animation" />
    </span>
  );
});
