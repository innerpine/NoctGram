'use client';
/* Shared parts of a message bubble in direct chats and groups. These are plain
   render functions, so each bubble keeps a flat, predictable element tree. */
import type { ReactNode } from 'react';
import { ProfileLink } from './profile-link';
import { ChatEmojiText } from './chat-emoji-text';
import { SharedPostCard } from './shared-post-card';
import { StickerMessage } from './sticker-view';
import { largeEmojiCount } from '@/lib/chat-emoji';
import type { ChatAttachment } from '@/lib/chat-files';

export type MessageReplyPreview = {
  id: string;
  sender: string;
  name: string;
  text: string;
  unavailable: boolean;
  quote?: string;
};
type LayoutInput = {
  text: string;
  attachments?: ChatAttachment[];
  reply?: MessageReplyPreview;
  forwardedName?: string;
  postShare?: { id: string };
  sticker?: string;
};
export function messageLayout(message: LayoutInput) {
  const sticker = !!message.sticker;
  const emojiCount =
    !sticker &&
    !message.attachments?.length &&
    !message.reply &&
    !message.forwardedName &&
    !message.postShare
      ? largeEmojiCount(message.text)
      : 0;
  const visualMedia =
    !!message.attachments?.length &&
    message.attachments.every(
      (file) => file.kind === 'image' || file.kind === 'video',
    );
  const round =
    message.attachments?.length === 1 && message.attachments[0].kind === 'round';
  const voice =
    message.attachments?.length === 1 && message.attachments[0].kind === 'voice';
  const mediaOnly =
    (visualMedia || round) &&
    !message.text.trim() &&
    !message.reply &&
    !message.forwardedName;
  return { emojiCount, visualMedia, mediaOnly, round, voice, sticker };
}
export function stickerContent(ref: string | undefined): ReactNode {
  if (!ref) return null;
  return <StickerMessage stickerRef={ref} />;
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
  // A quote reply shows the quoted fragment instead of the whole message.
  return (
    <button
      type="button"
      className={'chat-reply-quote' + (reply.quote ? ' has-quote' : '')}
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
        <ChatEmojiText text={reply.quote || reply.text} />
      </span>
    </button>
  );
}
export function sharedPost(
  share: { id: string } | undefined,
  viewerId: string | undefined,
): ReactNode {
  if (!share || !viewerId) return null;
  return <SharedPostCard id={share.id} viewerId={viewerId} />;
}
