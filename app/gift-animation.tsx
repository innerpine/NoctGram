'use client';
/* eslint-disable react/react-compiler, next/no-img-element */
import { memo, useEffect, useRef, useState } from 'react';
import { giftDefinition } from '@/lib/gift-catalog';
import { mountGiftAnimation } from '@/lib/gift-animation-runtime';

export const GiftAnimation = memo(function GiftAnimation({
  id,
}: {
  id: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState(false);
  const gift = giftDefinition(id);
  useEffect(() => {
    setLoaded(false);
    if (!host.current || !gift) return;
    return mountGiftAnimation(host.current, id, setLoaded);
  }, [id, gift]);
  if (!gift) return null;
  return (
    <span className="gift-art" data-animated={loaded} aria-hidden="true">
      <img
        src={`/assets/gifts/${id}.webp`}
        alt=""
        loading="lazy"
        decoding="async"
      />
      <span ref={host} className="gift-animation" />
    </span>
  );
});
