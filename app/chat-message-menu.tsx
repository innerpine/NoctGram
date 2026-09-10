'use client';
import {
  useRef,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';
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
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
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
};
// Portalled dialogs and media players own their context menu, even when their
// React ancestry passes through a message. Never suppress native events there.
export function preserveContextTarget(
  target: EventTarget | null,
  root: HTMLElement,
) {
  return (
    !(target instanceof Element) ||
    !root.contains(target) ||
    !!target.closest('video,audio,iframe,[data-chat-menu-exempt]')
  );
}
// Gaps between message rows are part of the chat too. Preserve native/player
// menus on their own surfaces and never consume events from a React portal.
export function chatHistoryContextMenu(event: ReactMouseEvent<HTMLElement>) {
  if (preserveContextTarget(event.target, event.currentTarget)) return;
  event.preventDefault();
  event.stopPropagation();
}
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
  return (
    <ContextMenu disabled={removing || props.unconfirmed}>
      <ContextMenuTrigger
        tabIndex={0}
        aria-haspopup="menu"
        aria-keyshortcuts="Shift+F10"
        data-chat-message-id={props.unconfirmed ? undefined : props.message.id}
        data-chat-initial={initial || undefined}
        data-chat-removing={removing ? '' : undefined}
        inert={removing || undefined}
        aria-hidden={removing || undefined}
        className={
          'chat-message-shell select-text' +
          (props.selected ? ' is-selected' : '')
        }
        onKeyDown={(event) => {
          if (
            (event.key !== 'ContextMenu' &&
              !(event.shiftKey && event.key === 'F10')) ||
            preserveContextTarget(event.target, event.currentTarget)
          )
            return;
          event.preventDefault();
          const surface =
            event.currentTarget.querySelector('.bubble, .chat-gift-card') ||
            event.currentTarget;
          const rect = surface.getBoundingClientRect();
          surface.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            }),
          );
        }}
        onContextMenu={(event) => {
          if (preserveContextTarget(event.target, event.currentTarget)) {
            event.preventBaseUIHandler();
            // Base UI also prevents native menus in a document listener for
            // targets inside its trigger; keep native media events out of it.
            if (event.currentTarget.contains(event.target as Node))
              event.stopPropagation();
          }
        }}
        onTouchStart={(event) => {
          if (preserveContextTarget(event.target, event.currentTarget))
            event.preventBaseUIHandler();
        }}
        onPointerDownCapture={(event) => {
          pointer.current =
            event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
        }}
        onPointerCancel={() => {
          pointer.current = null;
        }}
        onClickCapture={(event) => {
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
      </ContextMenuTrigger>
      <ContextMenuContent className="chat-action-menu">
        <Items {...props} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
