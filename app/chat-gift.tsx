'use client';
import { useState, type CSSProperties } from 'react';
import { Check, CheckCheck, Gift } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { giftDefinition } from '@/lib/gift-catalog';
import type { Message, Person } from '@/lib/client';
import { GiftAnimation } from './gift-animation';
import { Avatar, DisplayName } from './profile-identity';
import { ProfileLink, MentionText } from './profile-link';
import { StarsIcon } from './stars-icon';

export function ChatGift({
  message,
  me,
  peer,
  onProfile,
  onAvatar,
}: {
  message: Message;
  me: Person;
  peer: Person;
  onProfile: (id: string) => void;
  onAvatar: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const gift = message.gift && giftDefinition(message.gift.giftId);
  if (!gift || !message.gift) return null;
  const outgoing = message.sender === me.id;
  const sender = outgoing ? me : peer;
  const recipient = outgoing ? peer : me;
  const style = { '--gift-color': gift.color } as CSSProperties;
  const time = new Date(message.created).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <article
      className="chat-gift-event"
      id={'chat-message-' + message.id}
      tabIndex={-1}
      style={style}
      aria-label={outgoing ? 'Отправленный подарок' : 'Полученный подарок'}
    >
      <div className="chat-gift-notice">
        <Gift size={13} aria-hidden="true" />
        <span>
          {outgoing ? 'Вы отправили подарок' : 'Вам подарили подарок'}
        </span>
        <span
          className="chat-gift-cost"
          aria-label={`${message.gift.price} Noct Stars`}
        >
          <StarsIcon size={13} />
          {message.gift.price}
        </span>
      </div>
      <div className="chat-gift-card">
        <GiftAnimation id={gift.id} />
        <h3>{gift.name}</h3>
        <div className="chat-gift-person">
          <span>{outgoing ? 'для' : 'от'}</span>
          <button
            type="button"
            aria-label={
              'Открыть мини-профиль: ' + (outgoing ? recipient : sender).name
            }
            aria-haspopup="dialog"
            onClick={() => onAvatar((outgoing ? recipient : sender).id)}
          >
            <Avatar person={outgoing ? recipient : sender} size={22} />
          </button>
          <ProfileLink target={{ id: (outgoing ? recipient : sender).id }}>
            <DisplayName person={outgoing ? recipient : sender} />
          </ProfileLink>
        </div>
        {message.gift.message && (
          <p className="chat-gift-caption">
            <MentionText text={message.gift.message} />
          </p>
        )}
        <button className="chat-gift-view" onClick={() => setOpen(true)}>
          Просмотр
        </button>
        <div className="chat-gift-time">
          <time dateTime={new Date(message.created).toISOString()}>{time}</time>
          {outgoing && (
            <span aria-label={message.read ? 'Прочитано' : 'Отправлено'}>
              {message.read ? <CheckCheck size={12} /> : <Check size={12} />}
            </span>
          )}
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="noct-dialog gift-dialog chat-gift-dialog"
          overlayClassName="gift-backdrop"
        >
          <DialogTitle>{gift.name}</DialogTitle>
          <DialogDescription>
            {outgoing ? 'Ваш подарок' : 'Подарок для вас'}
          </DialogDescription>
          <div className="gift-preview" style={style}>
            <div className="gift-preview-art">
              <GiftAnimation id={gift.id} />
            </div>
            <div className="chat-gift-details">
              <div>
                <span>От кого</span>
                <span>
                  <ProfileLink target={{ id: sender.id }}>
                    <Avatar person={sender} size={25} />
                    <DisplayName person={sender} />
                  </ProfileLink>
                </span>
              </div>
              <div>
                <span>Кому</span>
                <span>
                  <ProfileLink target={{ id: recipient.id }}>
                    <Avatar person={recipient} size={25} />
                    <DisplayName person={recipient} />
                  </ProfileLink>
                </span>
              </div>
              <div>
                <span>Стоимость</span>
                <span>
                  <StarsIcon size={16} />
                  {message.gift.price} Noct Stars
                </span>
              </div>
            </div>
            {message.gift.message && (
              <p className="gift-caption">
                <MentionText text={message.gift.message} />
              </p>
            )}
            <time className="gift-date">
              {new Date(message.created).toLocaleString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </div>
          <button
            className="secondary gift-visibility"
            onClick={() => {
              setOpen(false);
              onProfile(recipient.id);
            }}
          >
            {outgoing ? 'Профиль получателя' : 'Мои подарки'}
          </button>
        </DialogContent>
      </Dialog>
    </article>
  );
}
