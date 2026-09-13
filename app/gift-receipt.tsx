'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { giftDefinition, type ReceivedGift } from '@/lib/gift-catalog';
import { canUpgradeGift, type GiftCollectible } from '@/lib/gift-collectibles';
import { GiftCollectibleArt } from './gift-collectible-art';
import { GiftAttributeTable, GiftUpgradePanel } from './gift-upgrade-panel';
import {
  GiftConversionPanel,
  type GiftConversionUpdate,
} from './gift-conversion-panel';
import { GiftAnimation } from './gift-animation';
import { StarsIcon } from './stars-icon';
import { Avatar } from './profile-identity';
import { MentionText, ProfileLink } from './profile-link';

export function GiftReceipt({
  receipt,
  own,
  ownerName,
  footer,
  onUpdated,
  onConverted,
  converted = false,
}: {
  receipt: ReceivedGift;
  own: boolean;
  ownerName?: string;
  footer?: ReactNode;
  onUpdated: (collectible: GiftCollectible) => void;
  onConverted?: (conversion: GiftConversionUpdate) => void;
  converted?: boolean;
}) {
  const [upgrading, setUpgrading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [sale, setSale] = useState<GiftConversionUpdate | null>(null);
  const saleButton = useRef<HTMLButtonElement>(null);
  const receiptTitle = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(false);
  const sold = converted || !!receipt.converted || !!sale;
  useEffect(() => {
    if (!converting && restoreFocus.current) {
      restoreFocus.current = false;
      (saleButton.current || receiptTitle.current)?.focus({
        preventScroll: true,
      });
    }
  }, [converting]);
  const definition = giftDefinition(receipt.giftId);
  if (!definition) return null;
  if (converting)
    return (
      <GiftConversionPanel
        receipt={receipt}
        onConverted={(conversion) => {
          setSale(conversion);
          onConverted?.(conversion);
        }}
        onBack={() => {
          restoreFocus.current = true;
          setConverting(false);
        }}
      />
    );
  if (upgrading && !sold)
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
          <DialogTitle ref={receiptTitle} tabIndex={-1}>
            {definition.name}
          </DialogTitle>
          <DialogDescription>
            {sold
              ? 'Подарок продан'
              : own
                ? 'Твой подарок'
                : 'Подарок в профиле'}
          </DialogDescription>
        </div>
      )}
      <div className="gift-receipt-body">
        {sold && (
          <output className="gift-receipt-converted">
            <Check size={18} aria-hidden="true" />
            <span>
              Подарок продан и удалён из профиля.
              {own && (sale || receipt.converted) && (
                <>
                  {' '}
                  Зачислено{' '}
                  {(sale || receipt.converted)!.amount.toLocaleString(
                    'ru-RU',
                  )}{' '}
                  Noct Stars.
                </>
              )}
            </span>
          </output>
        )}
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
        {own && !sold && !unique && canUpgradeGift(receipt.giftId) && (
          <button
            className="primary gift-upgrade-submit"
            onClick={() => setUpgrading(true)}
          >
            <Sparkles size={18} /> Улучшить
          </button>
        )}
        {own && !sold && !unique && !canUpgradeGift(receipt.giftId) && (
          <p className="gift-upgrade-unavailable">
            Для этого подарка улучшение пока недоступно.
          </p>
        )}
        {own && !sold && !unique && (
          <button
            ref={saleButton}
            type="button"
            className="secondary gift-conversion-open"
            onClick={() => setConverting(true)}
          >
            <StarsIcon size={18} /> Продать за звёзды
          </button>
        )}
        {!sold && footer}
      </div>
    </div>
  );
}
