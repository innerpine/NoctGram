'use client';
/* Shared parts of a message bubble in direct chats and groups. These are plain
   render functions, so each bubble keeps a flat, predictable element tree. */
import type { ReactNode } from 'react';
import { ProfileLink } from './profile-link';
import { ChatEmojiText } from './chat-emoji-text';
import { largeEmojiCount } from '@/lib/chat-emoji';
import type { ChatAttachment } from '@/lib/chat-files';

export type MessageReplyPreview = {
  id: string;
  sender: string;
  name: string;
  text: string;
  unavailable: boolean;
};
type LayoutInput = {
  text: string;
  attachments?: ChatAttachment[];
  reply?: MessageReplyPreview;
  forwardedName?: string;
};
export function messageLayout(message: LayoutInput) {
  const emojiCount =
    !message.attachments?.length && !message.reply && !message.forwardedName
      ? largeEmojiCount(message.text)
      : 0;
  const visualMedia =
    !!message.attachments?.length &&
    message.attachments.every(
      (file) => file.kind === 'image' || file.kind === 'video',
    );
  const mediaOnly =
    visualMedia &&
    !message.text.trim() &&
    !message.reply &&
    !message.forwardedName;
  return { emojiCount, visualMedia, mediaOnly };
}
export function forwardedHeader(
  name: string | undefined,
  sender: string | null | undefined,
): ReactNode {
  if (!name) return null;
  return (
    <div className="chat-forwarded">
      <span>Переслано от</span>
      <strong>
        {sender ? (
          <ProfileLink target={{ id: sender }}>{name}</ProfileLink>
        ) : (
          name
        )}
      </strong>
    </div>
  );
}
export function replyQuote(
  reply: MessageReplyPreview | undefined,
  meId: string | undefined,
  onJump: (id: string) => void,
): ReactNode {
  if (!reply) return null;
  return (
    <button
      type="button"
      className="chat-reply-quote"
      disabled={reply.unavailable}
      onClick={() => onJump(reply.id)}
    >
      <strong>
        {reply.unavailable
          ? 'Ответ на сообщение'
          : reply.sender === meId
            ? 'Вы'
            : reply.name}
      </strong>
      <span>
        <ChatEmojiText text={reply.text} />
      </span>
    </button>
  );
}
