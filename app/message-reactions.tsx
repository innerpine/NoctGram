'use client';
import { useState } from 'react';
import { LoaderCircle, SmilePlus } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  MESSAGE_REACTIONS,
  type MessageReaction,
  type ReactionEmoji,
} from '@/lib/message-reactions';
import { ChatEmojiText } from './chat-emoji-text';

export function MessageReactions({
  reactions = [],
  disabled,
  pending,
  onReact,
}: {
  reactions?: MessageReaction[];
  disabled: boolean;
  pending?: boolean;
  onReact: (emoji: ReactionEmoji | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const own = reactions.find((reaction) => reaction.own)?.emoji;
  const unavailable = disabled || !!pending;
  if (unavailable && open) setOpen(false);
  const choose = (emoji: ReactionEmoji) => {
    if (unavailable) return;
    setOpen(false);
    void onReact(own === emoji ? null : emoji);
  };
  return (
    <div
      className="message-reactions"
      data-chat-menu-exempt
      aria-label="Реакции на сообщение"
      aria-busy={!!pending}
    >
      {reactions.map((reaction) => (
        <button
          type="button"
          key={reaction.emoji}
          className="message-reaction-chip"
          aria-pressed={reaction.own}
          disabled={unavailable}
          aria-label={`${MESSAGE_REACTIONS.find((item) => item.emoji === reaction.emoji)?.label}: ${reaction.count}${reaction.own ? ', твоя реакция. Нажми, чтобы убрать' : '. Поставить реакцию'}`}
          onClick={() => choose(reaction.emoji)}
        >
          <ChatEmojiText text={reaction.emoji} mentions={false} />
          <span className="message-reaction-count">
            {reaction.count.toLocaleString('ru-RU')}
          </span>
        </button>
      ))}
      <Popover
        open={open && !unavailable}
        onOpenChange={(value) => setOpen(value && !unavailable)}
      >
        <PopoverTrigger
          type="button"
          className="message-reaction-add"
          aria-disabled={unavailable}
          aria-label="Добавить реакцию"
          title="Добавить реакцию"
        >
          {pending ? (
            <LoaderCircle size={16} className="message-reaction-loading" />
          ) : (
            <SmilePlus size={16} />
          )}
        </PopoverTrigger>
        <PopoverContent
          className="message-reaction-picker"
          side="top"
          sideOffset={8}
          data-chat-menu-exempt
        >
          <PopoverTitle>Реакция на сообщение</PopoverTitle>
          <div className="message-reaction-options">
            {MESSAGE_REACTIONS.map(({ emoji, label }) => (
              <button
                type="button"
                key={emoji}
                aria-label={label}
                title={label}
                aria-pressed={own === emoji}
                disabled={unavailable}
                onClick={() => choose(emoji)}
              >
                <ChatEmojiText text={emoji} mentions={false} />
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
