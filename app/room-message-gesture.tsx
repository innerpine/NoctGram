'use client';
import type { ReactNode } from 'react';
import { Reply } from 'lucide-react';
import { useMessageReplyGesture } from './use-message-reply-gesture';

export function RoomMessageGesture({
  children,
  className,
  enabled,
  onReply,
}: {
  children: ReactNode;
  className: string;
  enabled: boolean;
  onReply: () => void;
}) {
  const {
    cancel: _cancel,
    configure: _configure,
    ...gesture
  } = useMessageReplyGesture(enabled, onReply);
  return (
    <div
      className={className + (enabled ? ' chat-reply-gesture' : '')}
      {...gesture}
    >
      {children}
      <span className="chat-reply-indicator" aria-hidden="true">
        <Reply size={18} />
      </span>
    </div>
  );
}
