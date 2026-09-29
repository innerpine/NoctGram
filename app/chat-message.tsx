'use client';
import { memo } from 'react';
import { MessageReactions } from './message-reactions';
import type { ReactionEmoji } from '@/lib/message-reactions';
import { Check, CheckCheck, Clock3, RotateCcw } from 'lucide-react';
import type { Message, Person } from '@/lib/client';
import { ChatGift } from './chat-gift';
import { ChatEmojiText } from './chat-emoji-text';
import {
  forwardedHeader,
  messageLayout,
  replyQuote,
  sharedPost,
  stickerContent,
} from './message-body';
import type { OutgoingMessage } from '@/lib/chat-outbox';
import { Avatar } from './profile-identity';
import { MusicLinkCard } from './music-link-card';
import { ChatMessageFiles } from './chat-message-files';
import { ChatMessageContext, type ChatAction } from './chat-message-menu';

const time = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});
export const ChatMessage = memo(function ChatMessage({
  message,
  me,
  peer,
  onProfile,
  onAvatar,
  onAction,
  disabled,
  canSend,
  selected,
  selecting,
  onJump,
  removing = false,
  initial = false,
  delivery,
  onRetry,
  onReact,
  reactionPending = false,
  onListened,
}: {
  message: Message;
  me: Person | null;
  peer: Person;
  onProfile: (id: string) => void;
  onAvatar: (id: string) => void;
  onAction: (action: ChatAction, message: Message, quote?: string) => void;
  disabled: boolean;
  canSend: boolean;
  selected: boolean;
  selecting: boolean;
  onJump: (id: string) => void;
  removing?: boolean;
  initial?: boolean;
  delivery?: OutgoingMessage;
  onRetry?: (id: string) => void;
  onReact: (message: Message, emoji: ReactionEmoji | null) => Promise<void>;
  reactionPending?: boolean;
  onListened?: (message: Message) => void;
}) {
  const own = message.sender === me?.id;
  // «Избранное»: no second participant, so no read receipts or unheard dots.
  const saved = peer.id === me?.id;
  const reactions = (
    <MessageReactions
      reactions={message.reactions}
      disabled={disabled || !canSend || selecting || removing || !!delivery}
      pending={reactionPending}
      onReact={(emoji) => onReact(message, emoji)}
    />
  );
  const sender = own && me ? me : peer;
  const menuProps = {
    message,
    own,
    disabled,
    canSend,
    selected,
    onAction,
    unconfirmed: !!delivery,
  };
  const { emojiCount, visualMedia, mediaOnly, round, voice, sticker } =
    messageLayout(message);
  const metadata = (
    <span className="message-time">
      <time dateTime={new Date(message.created).toISOString()}>
        {time.format(message.created)}
      </time>
      {!!message.editedAt && <small title="Сообщение изменено">изм.</small>}
      {!!message.pinnedAt && (
        <span className="chat-pin-mark" aria-label="Закреплено">
          ·
        </span>
      )}
      {own && (!saved || (delivery && delivery.status !== 'sent')) && (
        <span
          aria-label={
            delivery?.status === 'sending'
              ? 'Отправляется'
              : delivery?.status === 'failed'
                ? 'Не отправлено'
                : message.read
                  ? 'Прочитано'
                  : 'Отправлено'
          }
        >
          {delivery && delivery.status !== 'sent' ? (
            <Clock3 size={13} />
          ) : message.read ? (
            <CheckCheck size={13} />
          ) : (
            <Check size={13} />
          )}
        </span>
      )}
    </span>
  );
  if (message.gift && me)
    return (
      <ChatMessageContext
        {...menuProps}
        selecting={selecting}
        removing={removing}
        initial={initial}
      >
        <ChatGift
          message={message}
          me={me}
          peer={peer}
          onProfile={onProfile}
          onAvatar={onAvatar}
          reactions={reactions}
        />
      </ChatMessageContext>
    );
  return (
    <ChatMessageContext
      {...menuProps}
      selecting={selecting}
      removing={removing}
      initial={initial}
    >
      <div className={'chat-message-row ' + (own ? 'self' : 'other')}>
        <button
          type="button"
          className="chat-message-avatar"
          aria-label={'Открыть мини-профиль: ' + sender.name}
          aria-haspopup="dialog"
          onClick={() => onAvatar(sender.id)}
        >
          <Avatar person={sender} size={32} />
        </button>
        <div
          className={
            'bubble ' +
            (own ? 'self' : 'other') +
            (emojiCount ? ' chat-emoji-only' : '') +
            (visualMedia ? ' chat-media-message' : '') +
            (mediaOnly ? ' chat-media-only' : '') +
            (round ? ' chat-round-message' : '') +
            (voice ? ' chat-voice-message' : '') +
            (sticker ? ' chat-sticker-message' : '')
          }
          data-emoji-count={emojiCount || undefined}
          data-delivery={delivery?.status}
          id={'chat-message-' + message.id}
          tabIndex={-1}
        >
          {forwardedHeader(message.forwardedName, message.forwardedSender)}
          {replyQuote(message.reply, me?.id, onJump)}
          {!!message.attachments?.length && (
            <ChatMessageFiles
              files={message.attachments}
              flush={visualMedia}
              metadata={mediaOnly ? metadata : undefined}
              own={own}
              listened={!!message.listenedAt || !!delivery || saved}
              onListened={own ? undefined : () => onListened?.(message)}
            />
          )}
          {sharedPost(message.postShare, me?.id)}
          {stickerContent(message.sticker)}
          {!!message.text.trim() && (
            <p className="chat-message-text">
              <ChatEmojiText text={message.text} large={!!emojiCount} />
            </p>
          )}
          <div className="chat-message-music" data-chat-menu-exempt>
            <MusicLinkCard text={message.text} />
          </div>
          {reactions}
          {!mediaOnly && metadata}
          {delivery?.status === 'failed' && (
            <button
              type="button"
              className="chat-delivery-retry"
              data-chat-menu-exempt
              disabled={disabled || !canSend}
              title={delivery.error}
              onClick={() => onRetry?.(message.id)}
            >
              <RotateCcw size={14} /> Повторить отправку
            </button>
          )}
        </div>
      </div>
    </ChatMessageContext>
  );
});
