'use client';
/* eslint-disable react/react-compiler, next/no-img-element */
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Smile, LockKeyhole, LoaderCircle, Sparkles } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  emojiParts,
  emojiToken,
  hasPremiumEmoji,
  premiumEmoji,
  type PremiumEmoji as Emoji,
} from '@/lib/premium-emoji';
import { mountGiftAnimation } from '@/lib/gift-animation-runtime';

const ChatEmojiPicker = lazy(() => import('./chat-emoji-picker'));

export function PremiumEmoji({ emoji }: { emoji: Emoji }) {
  const host = useRef<HTMLSpanElement>(null),
    [ready, setReady] = useState<string | null>(null),
    [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!host.current) return;
    return mountGiftAnimation(host.current, 'emoji:' + emoji.id, (loaded) =>
      setReady(loaded ? emoji.id : null),
    );
  }, [emoji.id]);
  return (
    <span className="premium-emoji">
      {failed === emoji.id ? (
        <span
          className="premium-emoji-fallback"
          style={{ opacity: ready === emoji.id ? 0 : 1 }}
        >
          {emoji.fallback}
        </span>
      ) : (
        <img
          src={'/assets/emoji/' + emoji.id + '.preview.webp'}
          alt={emoji.fallback}
          loading="lazy"
          onError={() => setFailed(emoji.id)}
          style={{ opacity: ready === emoji.id ? 0 : 1 }}
        />
      )}
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
  onInsert,
  onPrepareOpen,
  onRestoreFocus,
  className = 'icon-button emoji-picker-trigger',
  align = 'start',
  disabled = false,
}: {
  premium: boolean;
  text: string;
  onText: (text: string) => void;
  field?: RefObject<HTMLTextAreaElement | null>;
  onInsert?: (token: string) => void;
  onPrepareOpen?: () => void;
  onRestoreFocus?: () => void;
  className?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState('');
  const selection = useRef<{ start: number; end: number } | null>(null);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const prepare = () => {
    onPrepareOpen?.();
    const el = field?.current;
    if (el)
      selection.current = { start: el.selectionStart, end: el.selectionEnd };
  };
  const restoreFocus = () => {
    if (disabled) return false;
    if (onRestoreFocus) onRestoreFocus();
    else {
      const el = field?.current;
      if (el && !el.disabled) {
        el.focus({ preventScroll: true });
        if (selection.current)
          el.setSelectionRange(selection.current.start, selection.current.end);
      }
    }
    return false;
  };
  const insert = (value: string, needsPremium = false) => {
    if (disabled || (needsPremium && !premium)) return;
    const el = field?.current;
    if (el?.disabled || el?.readOnly) return;
    if (onInsert) onInsert(value);
    else {
      const current = el?.value ?? text;
      const start = Math.min(
        selection.current?.start ?? current.length,
        current.length,
      );
      const end = Math.max(
        start,
        Math.min(selection.current?.end ?? start, current.length),
      );
      const next = current.slice(0, start) + value + current.slice(end);
      if (el && el.maxLength >= 0 && next.length > el.maxLength) {
        setError(`В этом поле может быть до ${el.maxLength} символов`);
        return;
      }
      if (emojiParts(next).filter((part) => part.emoji).length > 30) {
        setError('Можно добавить до 30 Premium-эмодзи');
        return;
      }
      selection.current = {
        start: start + value.length,
        end: start + value.length,
      };
      onText(next);
    }
    setError('');
    setOpen(false);
    requestAnimationFrame(restoreFocus);
  };
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next, details) => {
        if (next) {
          prepare();
          setError('');
        } else if (
          details.reason === 'escape-key' ||
          details.reason === 'trigger-press'
        ) {
          requestAnimationFrame(restoreFocus);
        }
        setOpen(next && !disabled);
      }}
    >
      <PopoverTrigger
        type="button"
        className={className}
        aria-label="Выбрать эмодзи"
        title="Эмодзи"
        disabled={disabled}
        onPointerDown={prepare}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') prepare();
        }}
      >
        <Smile size={20} />
      </PopoverTrigger>
      <PopoverContent
        className="chat-emoji-popover unified-emoji-picker"
        side="top"
        align={align}
        sideOffset={12}
        initialFocus={false}
        finalFocus={false}
      >
        <PopoverTitle className="sr-only">Выбор эмодзи</PopoverTitle>
        <Tabs defaultValue="emoji" className="emoji-picker-tabs">
          <TabsList className="emoji-picker-switch" aria-label="Набор эмодзи">
            <TabsTrigger value="emoji">
              <Smile size={17} />
              Эмодзи
            </TabsTrigger>
            <TabsTrigger value="premium">
              <Sparkles size={17} />
              Premium
            </TabsTrigger>
          </TabsList>
          <TabsContent value="emoji" className="emoji-picker-panel">
            <Suspense
              fallback={
                <output className="chat-emoji-loading">
                  <LoaderCircle className="spin" size={22} />
                  <span>Загружаем эмодзи…</span>
                </output>
              }
            >
              <ChatEmojiPicker onSelect={(value) => insert(value)} />
            </Suspense>
          </TabsContent>
          <TabsContent
            value="premium"
            className="emoji-picker-panel emoji-picker-premium"
          >
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
                        type="button"
                        key={emoji.id}
                        disabled={!premium}
                        aria-label={emoji.fallback + ' · ' + pack}
                        title={emoji.fallback}
                        onClick={() => insert(emojiToken(emoji), true)}
                      >
                        <PremiumEmoji emoji={emoji} />
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </TabsContent>
        </Tabs>
        {error && (
          <p className="emoji-picker-error" role="alert">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
