'use client';
import { memo } from 'react';
import { Check, CheckCheck, Clock3, RotateCcw } from 'lucide-react';
import type { Message, Person } from '@/lib/client';
import { ChatGift } from './chat-gift';
import { ProfileLink } from './profile-link';
import { ChatEmojiText } from './chat-emoji-text';
import { largeEmojiCount } from '@/lib/chat-emoji';
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
}: {
  message: Message;
  me: Person | null;
  peer: Person;
  onProfile: (id: string) => void;
  onAvatar: (id: string) => void;
  onAction: (action: ChatAction, message: Message) => void;
  disabled: boolean;
  canSend: boolean;
  selected: boolean;
  selecting: boolean;
  onJump: (id: string) => void;
  removing?: boolean;
  initial?: boolean;
  delivery?: OutgoingMessage;
  onRetry?: (id: string) => void;
}) {
  const own = message.sender === me?.id;
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
      {own && (
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
            (mediaOnly ? ' chat-media-only' : '')
          }
          data-emoji-count={emojiCount || undefined}
          data-delivery={delivery?.status}
          id={'chat-message-' + message.id}
          tabIndex={-1}
        >
          {!!message.forwardedName && (
            <div className="chat-forwarded">
              <span>Переслано от</span>
              <strong>
                {message.forwardedSender ? (
                  <ProfileLink target={{ id: message.forwardedSender }}>
                    {message.forwardedName}
                  </ProfileLink>
                ) : (
                  message.forwardedName
                )}
              </strong>
            </div>
          )}
          {message.reply && (
            <button
              type="button"
              className="chat-reply-quote"
              disabled={message.reply.unavailable}
              onClick={() => onJump(message.reply!.id)}
            >
              <strong>
                {message.reply.unavailable
                  ? 'Ответ на сообщение'
                  : message.reply.sender === me?.id
                    ? 'Вы'
                    : message.reply.name}
              </strong>
              <span>
                <ChatEmojiText text={message.reply.text} />
              </span>
            </button>
          )}
          {!!message.attachments?.length && (
            <ChatMessageFiles
              files={message.attachments}
              flush={visualMedia}
              metadata={mediaOnly ? metadata : undefined}
            />
          )}
          {!!message.text.trim() && (
            <p>
              <ChatEmojiText text={message.text} large={!!emojiCount} />
            </p>
          )}
          <div className="chat-message-music" data-chat-menu-exempt>
            <MusicLinkCard text={message.text} />
          </div>
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
