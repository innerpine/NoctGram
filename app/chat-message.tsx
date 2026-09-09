'use client';
import { memo } from 'react';
import { Check, CheckCheck } from 'lucide-react';
import type { Message, Person } from '@/lib/client';
import { ChatGift } from './chat-gift';
import { MentionText, ProfileLink } from './profile-link';
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
  onAction,
  disabled,
  canSend,
  selected,
  selecting,
  onJump,
  removing = false,
  initial = false,
}: {
  message: Message;
  me: Person | null;
  peer: Person;
  onProfile: (id: string) => void;
  onAction: (action: ChatAction, message: Message) => void;
  disabled: boolean;
  canSend: boolean;
  selected: boolean;
  selecting: boolean;
  onJump: (id: string) => void;
  removing?: boolean;
  initial?: boolean;
}) {
  const own = message.sender === me?.id;
  const sender = own && me ? me : peer;
  const menuProps = { message, own, disabled, canSend, selected, onAction };
  if (message.gift && me)
    return (
      <ChatMessageContext
        {...menuProps}
        selecting={selecting}
        removing={removing}
        initial={initial}
      >
        <ChatGift message={message} me={me} peer={peer} onProfile={onProfile} />
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
        <ProfileLink
          target={{ id: sender.id }}
          className="chat-message-avatar"
          aria-label={'Профиль ' + sender.name}
        >
          <Avatar person={sender} size={32} />
        </ProfileLink>
        <div
          className={'bubble ' + (own ? 'self' : 'other')}
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
              <span>{message.reply.text}</span>
            </button>
          )}
          {!!message.attachments?.length && (
            <ChatMessageFiles files={message.attachments} />
          )}
          {!!message.text && (
            <p>
              <MentionText text={message.text} />
            </p>
          )}
          <div className="chat-message-music" data-chat-menu-exempt>
            <MusicLinkCard text={message.text} />
          </div>
          <span className="message-time">
            <time dateTime={new Date(message.created).toISOString()}>
              {time.format(message.created)}
            </time>
            {!!message.editedAt && (
              <small title="Сообщение изменено">изм.</small>
            )}
            {!!message.pinnedAt && (
              <span className="chat-pin-mark" aria-label="Закреплено">
                ·
              </span>
            )}
            {own && (
              <span aria-label={message.read ? 'Прочитано' : 'Отправлено'}>
                {message.read ? <CheckCheck size={13} /> : <Check size={13} />}
              </span>
            )}
          </span>
        </div>
      </div>
    </ChatMessageContext>
  );
});
