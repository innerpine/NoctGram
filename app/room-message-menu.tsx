'use client';
import { useRef, useState, type ReactNode } from 'react';
import { Copy, MoreHorizontal, Reply, Trash2 } from 'lucide-react';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import type { RoomMessage, RoomKind, RoomRole } from '@/lib/rooms-types';
import type { ReactionEmoji } from '@/lib/message-reactions';
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
  onReact,
  onReply,
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
  onReact: (message: RoomMessage, emoji: ReactionEmoji | null) => Promise<void>;
  onReply: (message: RoomMessage) => void;
  onRemove: (message: RoomMessage) => void;
  onCopy: () => void;
  initial?: boolean;
}) {
  const [enter] = useState(() => !initial);
  const trigger = useRef<HTMLDivElement>(null);
  const deleted = !!message.deletedAt;
  const readonly = disabled || !canSend || pending;
  const canQuickReply = kind === 'group' && !readonly && !deleted;
  const replyGesture = useMessageReplyGesture(canQuickReply, () =>
    onReply(message),
  );
  return (
    <ContextMenu
      disabled={deleted}
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
        onPointerDown={replyGesture.onPointerDown}
        onPointerMove={replyGesture.onPointerMove}
        onPointerUp={replyGesture.onPointerUp}
        onPointerCancel={replyGesture.onPointerCancel}
        onLostPointerCapture={replyGesture.onLostPointerCapture}
        onClickCapture={replyGesture.onClickCapture}
        onDoubleClick={replyGesture.onDoubleClick}
      >
        {children}
        {!deleted && (
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
        disabled={readonly || deleted}
        pending={reactionPending}
        onReact={
          kind === 'group' && !deleted
            ? (emoji) => onReact(message, emoji)
            : undefined
        }
      >
        {kind === 'group' && (
          <ContextMenuItem
            disabled={readonly || deleted}
            onClick={() => {
              if (!readonly && !deleted) onReply(message);
            }}
          >
            <Reply />
            Ответить
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
            disabled={readonly || deleted}
            onClick={() => {
              if (!readonly && !deleted) onRemove(message);
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
