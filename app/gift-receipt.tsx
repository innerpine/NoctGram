'use client';
import { useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { giftDefinition, type ReceivedGift } from '@/lib/gift-catalog';
import { canUpgradeGift, type GiftCollectible } from '@/lib/gift-collectibles';
import { GiftCollectibleArt } from './gift-collectible-art';
import { GiftAttributeTable, GiftUpgradePanel } from './gift-upgrade-panel';
import { GiftAnimation } from './gift-animation';
import { Avatar } from './profile-identity';
import { MentionText, ProfileLink } from './profile-link';

export function GiftReceipt({
  receipt,
  own,
  ownerName,
  footer,
  onUpdated,
}: {
  receipt: ReceivedGift;
  own: boolean;
  ownerName?: string;
  footer?: ReactNode;
  onUpdated: (collectible: GiftCollectible) => void;
}) {
  const [upgrading, setUpgrading] = useState(false);
  const definition = giftDefinition(receipt.giftId);
  if (!definition) return null;
  if (upgrading)
    return (
      <GiftUpgradePanel
        receipt={receipt}
        onUpdated={onUpdated}
        onBack={() => setUpgrading(false)}
      />
    );
  const unique = receipt.collectible;
  return (
    <div className="gift-receipt-content">
      {unique ? (
        <GiftCollectibleArt family={receipt.giftId} attributes={unique}>
          <div className="gift-collectible-heading">
            <DialogTitle>{definition.name}</DialogTitle>
            <DialogDescription>
              Коллекционный подарок #{unique.number.toLocaleString('ru-RU')}
            </DialogDescription>
          </div>
        </GiftCollectibleArt>
      ) : (
        <div className="gift-receipt-original">
          <GiftAnimation id={definition.id} />
          <DialogTitle>{definition.name}</DialogTitle>
          <DialogDescription>
            {own ? 'Твой подарок' : 'Подарок в профиле'}
          </DialogDescription>
        </div>
      )}
      <div className="gift-receipt-body">
        {unique && (
          <>
            <dl className="gift-attribute-table">
              <div>
                <dt>Владелец</dt>
                <dd>
                  <ProfileLink target={{ id: receipt.recipient }}>
                    {ownerName || (own ? 'Вы' : 'Открыть профиль')}
                  </ProfileLink>
                </dd>
              </div>
            </dl>
            <GiftAttributeTable attributes={unique} />
            {unique.issuance === 'admin' && (
              <p className="gift-upgrade-unavailable">
                Выдан администрацией Noctgram
              </p>
            )}
          </>
        )}
        {(!unique || unique.keepOriginal) && (
          <div className="gift-original-details">
            {!!receipt.sender && (
              <ProfileLink target={{ id: receipt.sender }}>
                <Avatar
                  person={{
                    name: receipt.senderName,
                    avatar: receipt.senderAvatar,
                  }}
                  size={27}
                />
                <span>от {receipt.senderName}</span>
              </ProfileLink>
            )}
            {receipt.message && (
              <p className="gift-caption">
                <MentionText text={receipt.message} />
              </p>
            )}
            <time
              className="gift-date"
              dateTime={new Date(receipt.created).toISOString()}
            >
              {new Date(receipt.created).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </time>
          </div>
        )}
        {own && !unique && canUpgradeGift(receipt.giftId) && (
          <button
            className="primary gift-upgrade-submit"
            onClick={() => setUpgrading(true)}
          >
            <Sparkles size={18} /> Улучшить
          </button>
        )}
        {own && !unique && !canUpgradeGift(receipt.giftId) && (
          <p className="gift-upgrade-unavailable">
            Для этого подарка улучшение пока недоступно.
          </p>
        )}
        {footer}
      </div>
    </div>
  );
}
