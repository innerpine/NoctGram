'use client';
import type {
  ComponentProps,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import {
  ContextMenuTrigger,
  ContextMenuContent,
} from '@/components/ui/context-menu';
import type { MessageReaction, ReactionEmoji } from '@/lib/message-reactions';
import { MessageReactionMenu } from './message-reactions';

// Media controls and portalled dialogs keep their own native context handling.
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

export function chatHistoryContextMenu(event: ReactMouseEvent<HTMLElement>) {
  if (preserveContextTarget(event.target, event.currentTarget)) return;
  event.preventDefault();
  event.stopPropagation();
}

export function openMessageContextMenu(
  surface: HTMLElement,
  anchor: HTMLElement = surface,
) {
  const rect = anchor.getBoundingClientRect();
  surface.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
}

export function MessageContextTrigger(
  props: Omit<
    ComponentProps<typeof ContextMenuTrigger>,
    'onKeyDown' | 'onContextMenu' | 'onTouchStart'
  >,
) {
  return (
    <ContextMenuTrigger
      {...props}
      tabIndex={0}
      aria-haspopup="menu"
      aria-keyshortcuts="Shift+F10"
      onKeyDown={(event) => {
        if (
          (event.key !== 'ContextMenu' &&
            !(event.shiftKey && event.key === 'F10')) ||
          preserveContextTarget(event.target, event.currentTarget)
        )
          return;
        event.preventDefault();
        const surface =
          event.currentTarget.querySelector<HTMLElement>(
            '.bubble,.chat-gift-card,.room-bubble,.room-giveaway-content',
          ) || event.currentTarget;
        openMessageContextMenu(surface);
      }}
      onContextMenu={(event) => {
        if (preserveContextTarget(event.target, event.currentTarget)) {
          event.preventBaseUIHandler();
          if (event.currentTarget.contains(event.target as Node))
            event.stopPropagation();
        }
      }}
      onTouchStart={(event) => {
        if (preserveContextTarget(event.target, event.currentTarget))
          event.preventBaseUIHandler();
      }}
    />
  );
}

export function MessageContextContent({
  children,
  reactions,
  disabled,
  pending,
  onReact,
}: {
  children: ReactNode;
  reactions?: MessageReaction[];
  disabled: boolean;
  pending?: boolean;
  onReact?: (emoji: ReactionEmoji | null) => Promise<void>;
}) {
  return (
    <ContextMenuContent
      className={
        'chat-action-menu message-context-menu' +
        (onReact ? ' has-reactions' : '')
      }
    >
      {onReact && (
        <MessageReactionMenu
          reactions={reactions}
          disabled={disabled}
          pending={pending}
          onReact={onReact}
        />
      )}
      <div className="message-menu-actions">{children}</div>
    </ContextMenuContent>
  );
}
