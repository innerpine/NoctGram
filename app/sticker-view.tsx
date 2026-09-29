'use client';
/* eslint-disable react/react-compiler, next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { mountGiftAnimation } from '@/lib/gift-animation-runtime';
import { lottiePoster } from '@/lib/lottie-poster';
import { posterFor } from '@/lib/sticker-catalog';
import { openStickerPack, useSticker } from '@/lib/sticker-client';
import { customEmojiToken, type StickerInfo } from '@/lib/sticker-types';
import { CUSTOM_EMOJI_FALLBACK } from '@/lib/premium-emoji';

const animationId = (sticker: StickerInfo) =>
  sticker.format === 'lottie'
    ? 'sticker:' + sticker.src
    : sticker.format === 'tgs'
      ? 'tgs:' + sticker.src.replace('/api/media/', '')
      : '';

// One sticker in a square box: a picture, or a Lottie animation drawn over
// its poster. Animations share the page-wide budget of the gift runtime.
export function StickerView({
  sticker,
  animate = true,
  className = '',
}: {
  sticker: StickerInfo;
  animate?: boolean;
  className?: string;
}) {
  const host = useRef<HTMLSpanElement>(null),
    [ready, setReady] = useState(false),
    [drawn, setDrawn] = useState<{ id: string; url: string } | null>(null);
  const id = sticker.available ? animationId(sticker) : '';
  useEffect(() => {
    if (!id.startsWith('tgs:')) return;
    let active = true;
    lottiePoster(id)
      .then((url) => {
        if (active) setDrawn({ id, url });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (!animate || !id || !host.current) return;
    return mountGiftAnimation(host.current, id, setReady);
  }, [animate, id]);
  if (!sticker.available)
    return (
      <span className={'sticker-view unavailable ' + className}>
        <span aria-hidden="true">{sticker.emoji || '🚫'}</span>
        <span className="sr-only">Стикер недоступен</span>
      </span>
    );
  if (sticker.format === 'webm')
    return (
      <span className={'sticker-view ' + className}>
        <video
          src={sticker.src}
          aria-label={'Стикер ' + sticker.emoji}
          muted
          loop
          playsInline
          autoPlay={animate}
          preload="metadata"
        />
      </span>
    );
  if (!id)
    return (
      <span className={'sticker-view ' + className}>
        <img
          src={sticker.src}
          alt={sticker.emoji}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </span>
    );
  const poster =
    sticker.format === 'lottie'
      ? posterFor(sticker.src)
      : drawn?.id === id
        ? drawn.url
        : '';
  return (
    <span className={'sticker-view ' + className}>
      {poster && (
        <img
          src={poster}
          alt={sticker.emoji}
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{ opacity: ready ? 0 : 1 }}
          onError={(event) => {
            // Imported animations may come without a poster.
            event.currentTarget.style.visibility = 'hidden';
          }}
        />
      )}
      <span className="sticker-animation" ref={host} aria-hidden="true" />
    </span>
  );
}

// A custom emoji from a pack made by a person, inside text.
export function CustomEmoji({ id }: { id: string }) {
  const { sticker, failed } = useSticker('u:' + id);
  const raw = customEmojiToken(id);
  if (failed || (sticker && !sticker.available))
    return (
      <span className="premium-emoji custom-emoji missing" data-raw={raw}>
        {CUSTOM_EMOJI_FALLBACK}
      </span>
    );
  return (
    <span className="premium-emoji custom-emoji" data-raw={raw}>
      {sticker && <StickerView sticker={sticker} />}
    </span>
  );
}

// A sticker message: no bubble, and a click opens its pack.
export function StickerMessage({ stickerRef }: { stickerRef: string }) {
  const { sticker, failed } = useSticker(stickerRef);
  const shown: StickerInfo | null =
    sticker ??
    (failed
      ? {
          ref: stickerRef,
          packRef: '',
          emoji: '',
          format: 'webp',
          src: '',
          w: 512,
          h: 512,
          available: false,
        }
      : null);
  const pack = shown?.available ? shown.packRef : '';
  return (
    <button
      type="button"
      className="chat-sticker"
      disabled={!pack}
      aria-label={
        shown?.available
          ? 'Стикер ' + shown.emoji + ': открыть набор'
          : 'Стикер'
      }
      onClick={() =>
        openStickerPack(pack.startsWith('b:') ? pack.slice(2) : pack)
      }
    >
      {shown ? (
        <StickerView sticker={shown} />
      ) : (
        <span className="sticker-view loading" aria-hidden="true" />
      )}
      {shown && !shown.available && <small>Стикер недоступен</small>}
    </button>
  );
}
