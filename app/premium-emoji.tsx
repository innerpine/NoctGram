'use client';
/* eslint-disable react/react-compiler, next/no-img-element */
import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import { Smile, LockKeyhole } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  emojiParts,
  emojiToken,
  hasPremiumEmoji,
  premiumEmoji,
  premiumEmojiPacks,
  type PremiumEmoji as Emoji,
} from '@/lib/premium-emoji';
import { mountGiftAnimation } from '@/lib/gift-animation-runtime';
import { posterFor } from '@/lib/sticker-catalog';
import { CustomEmoji } from './sticker-view';

export function PremiumEmoji({ emoji }: { emoji: Emoji }) {
  const host = useRef<HTMLSpanElement>(null),
    [ready, setReady] = useState(false);
  const animated = !emoji.format || emoji.format === 'lottie';
  useEffect(() => {
    if (!animated || !host.current) return;
    return mountGiftAnimation(host.current, 'emoji:' + emoji.id, setReady);
  }, [emoji.id, animated]);
  // Emoji imported from Telegram may be a picture or a short video.
  if (!animated && emoji.asset)
    return (
      <span className="premium-emoji" data-raw={emojiToken(emoji)}>
        {emoji.format === 'webm' ? (
          <video
            src={emoji.asset}
            aria-label={emoji.fallback}
            muted
            loop
            autoPlay
            playsInline
          />
        ) : (
          <img src={emoji.asset} alt={emoji.fallback} loading="lazy" />
        )}
      </span>
    );
  return (
    <span className="premium-emoji" data-raw={emojiToken(emoji)}>
      <img
        src={
          emoji.asset
            ? posterFor(emoji.asset)
            : '/assets/emoji/' + emoji.id + '.preview.webp'
        }
        alt={emoji.fallback}
        loading="lazy"
        style={{ opacity: ready ? 0 : 1 }}
      />
      <span className="premium-emoji-animation" ref={host} aria-hidden="true" />
    </span>
  );
}
export function EmojiText({ text }: { text: string }) {
  return (
    <>
      {emojiParts(text).map((p, i) =>
        p.emoji ? (
          <PremiumEmoji key={i} emoji={p.emoji} />
        ) : p.custom ? (
          <CustomEmoji key={i} id={p.custom} />
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
export function EmojiPreview({ text }: { text: string }) {
  return hasPremiumEmoji(text) ? (
    <div className="emoji-draft-preview" aria-label="Предпросмотр сообщения">
      <EmojiText text={text} />
    </div>
  ) : null;
}
export function EmojiPicker({
  premium,
  text,
  onText,
  field,
  onInsert,
  onPrepareOpen,
  disabled = false,
}: {
  premium: boolean;
  text: string;
  onText: (text: string) => void;
  field?: RefObject<HTMLTextAreaElement | null>;
  onInsert?: (token: string) => void;
  onPrepareOpen?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="icon-button emoji-picker-trigger"
        aria-label="Premium-эмодзи"
        title="Premium-эмодзи"
        disabled={disabled}
        onPointerDown={onPrepareOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onPrepareOpen?.();
        }}
      >
        <Smile size={20} />
      </PopoverTrigger>
      <PopoverContent
        className="emoji-picker"
        side="top"
        align="start"
        finalFocus={onInsert ? false : undefined}
      >
        <div className="emoji-picker-heading">
          <strong>Noct Emoji</strong>
          <span>Premium</span>
        </div>
        {!premium && (
          <p className="emoji-picker-lock">
            <LockKeyhole size={13} />
            Для отправки нужен Noct Premium
          </p>
        )}
        {premiumEmojiPacks.map(({ id: pack, title }) => (
          <div className="emoji-pack" key={pack}>
            <small>{title}</small>
            <div>
              {premiumEmoji
                .filter((e) => e.pack === pack)
                .map((emoji) => (
                  <button
                    key={emoji.id}
                    disabled={!premium}
                    aria-label={emoji.fallback + ' · ' + title}
                    title={emoji.fallback}
                    onClick={() => {
                      if (onInsert) {
                        onInsert(emojiToken(emoji));
                        setOpen(false);
                        return;
                      }
                      const el = field?.current,
                        start = el?.selectionStart ?? text.length,
                        end = el?.selectionEnd ?? text.length,
                        token = emojiToken(emoji);
                      onText(text.slice(0, start) + token + text.slice(end));
                      setOpen(false);
                      requestAnimationFrame(() => {
                        el?.focus({ preventScroll: true });
                        el?.setSelectionRange(
                          start + token.length,
                          start + token.length,
                        );
                      });
                    }}
                  >
                    <PremiumEmoji emoji={emoji} />
                  </button>
                ))}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
