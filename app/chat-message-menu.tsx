'use client';
import { useRef, type ReactNode } from 'react';
import {
  CheckSquare,
  Copy,
  Flag,
  Forward,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
} from 'lucide-react';
import type { Message } from '@/lib/client';
import type { ReactionEmoji } from '@/lib/message-reactions';
import {
  MessageContextTrigger,
  MessageContextContent,
  preserveContextTarget,
} from './message-context-menu';
export {
  preserveContextTarget,
  chatHistoryContextMenu,
} from './message-context-menu';
import { useMessageReplyGesture } from './use-message-reply-gesture';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';

export type ChatAction =
  | 'reply'
  | 'pin'
  | 'forward'
  | 'copy'
  | 'edit'
  | 'delete'
  | 'select'
  | 'report';
export type ChatActionProps = {
  message: Message;
  own: boolean;
  disabled: boolean;
  canSend: boolean;
  selected?: boolean;
  unconfirmed?: boolean;
  onAction: (action: ChatAction, message: Message) => void;
  onReact?: (message: Message, emoji: ReactionEmoji | null) => Promise<void>;
  reactionPending?: boolean;
};
function Items(props: ChatActionProps) {
  const Item = ContextMenuItem;
  const Separator = ContextMenuSeparator;
  const { message, own, disabled, canSend, selected, onAction } = props;
  return (
    <>
      <Item
        disabled={disabled || !canSend}
        onClick={() => onAction('reply', message)}
      >
        <Reply />
        Ответить
      </Item>
      <Item
        disabled={disabled || !canSend}
        onClick={() => onAction('pin', message)}
      >
        {message.pinnedAt ? <PinOff /> : <Pin />}
        {message.pinnedAt ? 'Открепить' : 'Закрепить'}
      </Item>
      <Item disabled={disabled} onClick={() => onAction('forward', message)}>
        <Forward />
        Переслать
      </Item>
      {!!message.text && (
        <Item onClick={() => onAction('copy', message)}>
          <Copy />
          Копировать текст
        </Item>
      )}
      {own && !message.gift && !message.forwardedName && (
        <Item
          disabled={disabled || !canSend}
          onClick={() => onAction('edit', message)}
        >
          <Pencil />
          Изменить
        </Item>
      )}
      <Separator />
      <Item onClick={() => onAction('select', message)}>
        <CheckSquare />
        {selected ? 'Снять выделение' : 'Выделить'}
      </Item>
      {!own && (
        <Item onClick={() => onAction('report', message)}>
          <Flag />
          Пожаловаться
        </Item>
      )}
      <Item
        variant="destructive"
        disabled={disabled}
        onClick={() => onAction('delete', message)}
      >
        <Trash2 />
        Удалить
      </Item>
    </>
  );
}
export function ChatMessageContext({
  children,
  selecting,
  removing = false,
  initial = false,
  ...props
}: ChatActionProps & {
  children: ReactNode;
  selecting: boolean;
  removing?: boolean;
  initial?: boolean;
}) {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const canQuickReply =
    !selecting &&
    !removing &&
    !props.disabled &&
    props.canSend &&
    !props.unconfirmed;
  const replyGesture = useMessageReplyGesture(canQuickReply, () =>
    props.onAction('reply', props.message),
  );
  return (
    <ContextMenu
      disabled={removing || props.unconfirmed}
      onOpenChange={(open) => {
        if (open) replyGesture.cancel();
      }}
    >
      <MessageContextTrigger
        data-chat-message-id={props.unconfirmed ? undefined : props.message.id}
        data-chat-initial={initial || undefined}
        data-chat-removing={removing ? '' : undefined}
        inert={removing || undefined}
        aria-hidden={removing || undefined}
        className={
          'chat-message-shell select-text' +
          (canQuickReply ? ' chat-reply-gesture' : '') +
          (props.selected ? ' is-selected' : '')
        }
        onPointerDownCapture={(event) => {
          pointer.current =
            event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
        }}
        onPointerDown={replyGesture.onPointerDown}
        onPointerMove={replyGesture.onPointerMove}
        onPointerUp={replyGesture.onPointerUp}
        onLostPointerCapture={replyGesture.onLostPointerCapture}
        onPointerCancel={() => {
          pointer.current = null;
          replyGesture.cancel();
        }}
        onDoubleClick={replyGesture.onDoubleClick}
        onClickCapture={(event) => {
          if (replyGesture.onClickCapture(event)) return;
          const start = pointer.current;
          pointer.current = null;
          if (
            !selecting ||
            props.unconfirmed ||
            preserveContextTarget(event.target, event.currentTarget)
          )
            return;
          const target = event.target as Element;
          // A drag that started in the bubble belongs to native text selection.
          const textSelection =
            typeof window !== 'undefined' ? window.getSelection() : null;
          if (
            textSelection &&
            !textSelection.isCollapsed &&
            event.currentTarget.contains(textSelection.anchorNode) &&
            (event.detail > 1 ||
              event.shiftKey ||
              (start &&
                Math.hypot(event.clientX - start.x, event.clientY - start.y) >=
                  4)) &&
            !target.closest('.chat-message-select')
          )
            return;
          if (target.closest('[data-slot="context-menu-content"]')) return;
          event.preventDefault();
          event.stopPropagation();
          props.onAction('select', props.message);
        }}
      >
        {selecting && !props.unconfirmed && (
          <button
            type="button"
            className="chat-message-select"
            aria-label={
              props.selected
                ? 'Снять выделение сообщения'
                : 'Выделить сообщение'
            }
            aria-pressed={!!props.selected}
          >
            <CheckSquare size={18} />
          </button>
        )}
        {children}
        <span className="chat-reply-indicator" aria-hidden="true">
          <Reply size={18} />
        </span>
      </MessageContextTrigger>
      <MessageContextContent
        reactions={props.message.reactions}
        disabled={props.disabled || !props.canSend}
        pending={props.reactionPending}
        onReact={
          !selecting && !removing && !props.unconfirmed && props.onReact
            ? (emoji) => props.onReact!(props.message, emoji)
            : undefined
        }
      >
        <Items {...props} />
      </MessageContextContent>
    </ContextMenu>
  );
}
