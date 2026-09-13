'use client';
import {
  ContextMenuGroup,
  ContextMenuItem,
} from '@/components/ui/context-menu';
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
  if (!reactions.length) return null;
  const own = reactions.find((reaction) => reaction.own)?.emoji;
  const unavailable = disabled || !!pending;
  const choose = (emoji: ReactionEmoji) => {
    if (unavailable) return;
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
    </div>
  );
}

export function MessageReactionMenu({
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
  const own = reactions.find((reaction) => reaction.own)?.emoji;
  const unavailable = disabled || !!pending;
  return (
    <ContextMenuGroup
      className="message-reaction-bar"
      aria-label="Реакции на сообщение"
      aria-busy={!!pending}
    >
      {MESSAGE_REACTIONS.map(({ emoji, label }) => (
        <ContextMenuItem
          key={emoji}
          className="message-reaction-option"
          aria-label={own === emoji ? `${label}, твоя реакция. Убрать` : label}
          title={label}
          data-selected={own === emoji ? '' : undefined}
          disabled={unavailable}
          onClick={() => {
            if (!unavailable) void onReact(own === emoji ? null : emoji);
          }}
        >
          <ChatEmojiText text={emoji} mentions={false} />
        </ContextMenuItem>
      ))}
    </ContextMenuGroup>
  );
}
