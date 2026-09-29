'use client';
import { useRef, useState, type ReactNode } from 'react';
import {
  Copy,
  Forward,
  MessageCircle,
  MoreHorizontal,
  Quote,
  Reply,
  Trash2,
} from 'lucide-react';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import type { RoomMessage, RoomKind, RoomRole } from '@/lib/rooms-types';
import type { ReactionEmoji } from '@/lib/message-reactions';
import { selectionQuote } from '@/lib/message-selection';
import { useMessageReplyGesture } from './use-message-reply-gesture';
import {
  MessageContextTrigger,
  MessageContextContent,
  openMessageContextMenu,
} from './message-context-menu';

export function RoomMessageContext({
  children,
  className,
  message,
  kind,
  role,
  own,
  disabled,
  canSend,
  pending,
  reactionPending,
  unconfirmed = false,
  canReply = true,
  onReact,
  onReply,
  onQuote,
  onThread,
  onForward,
  onRemove,
  onCopy,
  initial = true,
}: {
  children: ReactNode;
  className: string;
  message: RoomMessage;
  kind: RoomKind;
  role: RoomRole;
  own: boolean;
  disabled: boolean;
  canSend: boolean;
  pending: boolean;
  reactionPending: boolean;
  // An optimistic message the server has not confirmed yet.
  unconfirmed?: boolean;
  // False in a closed forum topic: reactions and deletion still work.
  canReply?: boolean;
  onReact: (message: RoomMessage, emoji: ReactionEmoji | null) => Promise<void>;
  onReply: (message: RoomMessage) => void;
  // A text fragment selected when the menu opens becomes a quote reply.
  onQuote?: (message: RoomMessage, quote: string) => void;
  onThread?: (message: RoomMessage) => void;
  onForward?: (message: RoomMessage) => void;
  onRemove: (message: RoomMessage) => void;
  onCopy: () => void;
  initial?: boolean;
}) {
  const [enter] = useState(() => !initial);
  const [quote, setQuote] = useState('');
  const trigger = useRef<HTMLDivElement>(null);
  const deleted = !!message.deletedAt;
  const closed = deleted || unconfirmed;
  const readonly = disabled || !canSend || pending;
  const canQuickReply = kind === 'group' && canReply && !readonly && !closed;
  const replyGesture = useMessageReplyGesture(canQuickReply, () =>
    onReply(message),
  );
  return (
    <ContextMenu
      disabled={closed}
      onOpenChange={(open) => {
        if (open) replyGesture.cancel();
      }}
    >
      <MessageContextTrigger
        ref={trigger}
        className={
          className +
          ' room-message-context select-text' +
          (canQuickReply ? ' chat-reply-gesture' : '')
        }
        data-room-message-id={message.id}
        data-chat-initial={!enter || undefined}
        onContextMenu={(event) =>
          setQuote(
            canQuickReply && onQuote
              ? selectionQuote(
                  event.currentTarget.querySelector('.chat-message-text'),
                  message.text,
                )
              : '',
          )
        }
        onPointerDown={replyGesture.onPointerDown}
        onPointerMove={replyGesture.onPointerMove}
        onPointerUp={replyGesture.onPointerUp}
        onPointerCancel={replyGesture.onPointerCancel}
        onLostPointerCapture={replyGesture.onLostPointerCapture}
        onClickCapture={replyGesture.onClickCapture}
        onDoubleClick={replyGesture.onDoubleClick}
      >
        {children}
        {!closed && (
          <button
            type="button"
            className="room-message-more icon-button"
            aria-label={
              message.giveawayId
                ? 'Действия с розыгрышем'
                : 'Действия с сообщением'
            }
            aria-haspopup="menu"
            onClick={(event) => {
              event.stopPropagation();
              if (trigger.current)
                openMessageContextMenu(trigger.current, event.currentTarget);
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        )}
        <span className="chat-reply-indicator" aria-hidden="true">
          <Reply size={18} />
        </span>
      </MessageContextTrigger>
      <MessageContextContent
        reactions={message.reactions}
        disabled={readonly || closed}
        pending={reactionPending}
        onReact={
          kind === 'group' && !closed
            ? (emoji) => onReact(message, emoji)
            : undefined
        }
      >
        {kind === 'group' && (
          <ContextMenuItem
            disabled={!canQuickReply}
            onClick={() => {
              if (canQuickReply) onReply(message);
            }}
          >
            <Reply />
            Ответить
          </ContextMenuItem>
        )}
        {kind === 'group' && !!quote && onQuote && (
          <ContextMenuItem
            disabled={!canQuickReply}
            onClick={() => {
              if (canQuickReply) onQuote(message, quote);
            }}
          >
            <Quote />
            Ответить с цитатой
          </ContextMenuItem>
        )}
        {kind === 'group' &&
          onThread &&
          (!!message.replies || !!message.threadRootId) && (
            <ContextMenuItem onClick={() => onThread(message)}>
              <MessageCircle />
              Открыть ветку
            </ContextMenuItem>
          )}
        {kind === 'group' && onForward && !message.giveawayId && (
          <ContextMenuItem
            disabled={closed}
            onClick={() => {
              if (!closed) onForward(message);
            }}
          >
            <Forward />
            Переслать
          </ContextMenuItem>
        )}
        {kind === 'group' && !!message.text && (
          <ContextMenuItem
            disabled={deleted}
            onClick={() => {
              if (!deleted) onCopy();
            }}
          >
            <Copy />
            Копировать текст
          </ContextMenuItem>
        )}
        {(own || (role !== 'member' && kind === 'group')) && (
          <ContextMenuItem
            variant="destructive"
            disabled={readonly || closed}
            onClick={() => {
              if (!readonly && !closed) onRemove(message);
            }}
          >
            <Trash2 />
            Удалить у всех
          </ContextMenuItem>
        )}
      </MessageContextContent>
    </ContextMenu>
  );
}
