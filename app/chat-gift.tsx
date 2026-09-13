'use client';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, CheckCheck, Gift } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { giftDefinition } from '@/lib/gift-catalog';
import type { Message, Person } from '@/lib/client';
import { GiftAnimation } from './gift-animation';
import { Avatar, DisplayName } from './profile-identity';
import { ProfileLink, MentionText } from './profile-link';
import { StarsIcon } from './stars-icon';
import { GiftReceipt } from './gift-receipt';
import { GiftCollectibleArt } from './gift-collectible-art';
import type { GiftCollectible } from '@/lib/gift-collectibles';
import type { GiftConversionUpdate } from './gift-conversion-panel';

export function ChatGift({
  message,
  me,
  peer,
  onProfile,
  onAvatar,
  reactions,
}: {
  message: Message;
  me: Person;
  peer: Person;
  onProfile: (id: string) => void;
  onAvatar: (id: string) => void;
  reactions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [upgraded, setUpgraded] = useState<GiftCollectible | null>(null);
  const [conversion, setConversion] = useState<GiftConversionUpdate | null>(
    null,
  );
  const receiptId = message.gift?.id;
  useEffect(() => {
    const changed = (event: Event) => {
      const converted = (
        event as CustomEvent<{ conversion?: GiftConversionUpdate }>
      ).detail?.conversion;
      if (converted && converted.id === receiptId) setConversion(converted);
    };
    window.addEventListener('noctgram:gifts-changed', changed);
    return () => window.removeEventListener('noctgram:gifts-changed', changed);
  }, [receiptId]);
  const gift = message.gift && giftDefinition(message.gift.giftId);
  if (!gift || !message.gift) return null;
  const outgoing = message.sender === me.id;
  const sender = outgoing ? me : peer;
  const recipient = outgoing ? peer : me;
  const collectible = upgraded || message.gift.collectible;
  const sold = !!conversion || !!message.gift.converted;
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
        {collectible ? (
          <GiftCollectibleArt family={gift.id} attributes={collectible} />
        ) : (
          <GiftAnimation id={gift.id} />
        )}
        <h3>{gift.name}</h3>
        {sold && (
          <span className="chat-gift-sold">
            <Check size={13} aria-hidden="true" /> Подарок продан
          </span>
        )}
        {collectible && (
          <span className="gift-number">
            #{collectible.number.toLocaleString('ru-RU')}
          </span>
        )}
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
      {reactions}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="noct-dialog gift-dialog chat-gift-dialog"
          overlayClassName="gift-backdrop"
        >
          <GiftReceipt
            own={!outgoing}
            ownerName={recipient.name}
            onUpdated={setUpgraded}
            onConverted={setConversion}
            converted={sold}
            receipt={{
              id: message.gift.id,
              giftId: gift.id,
              sender: sender.id,
              recipient: recipient.id,
              message: message.gift.message,
              created: message.created,
              hidden: 0,
              senderName: sender.name,
              senderAvatar: sender.avatar,
              senderHandle: sender.handle,
              collectible,
              converted: conversion,
            }}
            footer={
              <>
                {!collectible && (
                  <div className="chat-gift-details">
                    <div>
                      <span>Кому</span>
                      <ProfileLink target={{ id: recipient.id }}>
                        <DisplayName person={recipient} />
                      </ProfileLink>
                    </div>
                    <div>
                      <span>Стоимость</span>
                      <span>
                        <StarsIcon size={16} />
                        {message.gift.price} Noct Stars
                      </span>
                    </div>
                  </div>
                )}
                <button
                  className="secondary gift-visibility"
                  onClick={() => {
                    setOpen(false);
                    onProfile(recipient.id);
                  }}
                >
                  {outgoing ? 'Профиль получателя' : 'Мои подарки'}
                </button>
              </>
            }
          />
        </DialogContent>
      </Dialog>
    </article>
  );
}
