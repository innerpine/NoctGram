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
import { isChatSelectionSurface } from '@/lib/chat-drag-selection';
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
  const replyGesture = useRef(false);
  const canQuickReply =
    !selecting &&
    !removing &&
    !props.disabled &&
    props.canSend &&
    !props.unconfirmed;
  return (
    <ContextMenu disabled={removing || props.unconfirmed}>
      <MessageContextTrigger
        data-chat-message-id={props.unconfirmed ? undefined : props.message.id}
        data-chat-initial={initial || undefined}
        data-chat-removing={removing ? '' : undefined}
        inert={removing || undefined}
        aria-hidden={removing || undefined}
        className={
          'chat-message-shell select-text' +
          (props.selected ? ' is-selected' : '')
        }
        onPointerDownCapture={(event) => {
          pointer.current =
            event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
        }}
        onPointerCancel={() => {
          pointer.current = null;
          replyGesture.current = false;
        }}
        onDoubleClick={(event) => {
          const startedOnGutter = replyGesture.current;
          replyGesture.current = false;
          if (
            !startedOnGutter ||
            !canQuickReply ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey ||
            !isChatSelectionSurface(event.target, event.currentTarget)
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          props.onAction('reply', props.message);
        }}
        onClickCapture={(event) => {
          // Remember the first click: deselecting the final selected message
          // during a double click must not turn that gesture into a reply.
          if (event.detail === 1)
            replyGesture.current =
              event.button === 0 &&
              canQuickReply &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.shiftKey &&
              isChatSelectionSurface(event.target, event.currentTarget);
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
