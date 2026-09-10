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
  type PremiumEmoji as Emoji,
} from '@/lib/premium-emoji';
import { mountGiftAnimation } from '@/lib/gift-animation-runtime';

export function PremiumEmoji({ emoji }: { emoji: Emoji }) {
  const host = useRef<HTMLSpanElement>(null),
    [ready, setReady] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    return mountGiftAnimation(host.current, 'emoji:' + emoji.id, setReady);
  }, [emoji.id]);
  return (
    <span className="premium-emoji">
      <img
        src={'/assets/emoji/' + emoji.id + '.preview.webp'}
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
  disabled = false,
}: {
  premium: boolean;
  text: string;
  onText: (text: string) => void;
  field?: RefObject<HTMLTextAreaElement | null>;
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
      >
        <Smile size={20} />
      </PopoverTrigger>
      <PopoverContent className="emoji-picker" side="top" align="start">
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
        {['RestrictedEmoji', 'CreepyEmoji', 'NewsEmoji'].map((pack) => (
          <div className="emoji-pack" key={pack}>
            <small>{pack}</small>
            <div>
              {premiumEmoji
                .filter((e) => e.pack === pack)
                .map((emoji) => (
                  <button
                    key={emoji.id}
                    disabled={!premium}
                    aria-label={emoji.fallback + ' · ' + pack}
                    title={emoji.fallback}
                    onClick={() => {
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
