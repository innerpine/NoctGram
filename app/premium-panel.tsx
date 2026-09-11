'use client';
import { PurchaseButton } from './purchase-panel';
/* Async entitlement fetch is cancelled when the panel closes. */
/* eslint-disable react/react-compiler */
import { useEffect, useState } from 'react';
import { StarScene } from './star-scene';
import {
  Camera,
  Moon,
  AtSign,
  ArrowLeft,
  X,
  ChevronRight,
  Smile,
  Palette,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { PremiumIcon } from './premium-icon';
import { request, type Profile } from '@/lib/client';

const features = [
  {
    id: 'avatars',
    Icon: Camera,
    title: 'Анимированные аватары',
    text: 'GIF и видео в аватаре.',
    detail:
      'GIF и видео вместо обычного аватара — в профиле, публикациях, комментариях и диалогах. Без звука и с неподвижным превью, когда анимации отключены.',
  },
  {
    id: 'themes',
    Icon: Moon,
    title: 'Оформление профиля',
    text: 'Рамки, фон и цвета профиля.',
    detail:
      'Шесть палитр, обводка Chrome Flow с настройкой темпа, собственный текст вокруг аватара и под-юзернеймы в цвете профиля. Всё настраивается во вкладке «Дизайн».',
  },
  {
    id: 'status',
    Icon: Smile,
    title: 'Твой значок Premium',
    text: 'Значок рядом с именем.',
    detail:
      'Фирменный значок появляется справа от имени автоматически. Его цвет подстраивается под палитру твоего профиля.',
  },
  {
    id: 'posts',
    Icon: Palette,
    title: 'Градиентный ник',
    text: 'Имя в цветах профиля.',
    detail:
      'Мягкий градиент из цветов профиля. Включается одним переключателем и виден рядом с твоими публикациями и сообщениями.',
  },
  {
    id: 'usernames',
    Icon: AtSign,
    title: 'Коллекционные юзернеймы · позже',
    text: 'Покупка и передача юзернеймов.',
    detail:
      'Покупка и передача коллекционных имён появятся позже. Обычные юзернеймы уже можно добавлять бесплатно в профиле.',
  },
];

export function PremiumPanel({
  me,
  onBack,
  onUpdate,
  onDesign,
}: {
  me: Profile | null;
  onBack: () => void;
  onUpdate: (profile: Profile) => void;
  onDesign: () => void;
}) {
  const [state, setState] = useState<{
    premium: boolean | number;
    expiresAt: number | null;
    testMode: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [feature, setFeature] = useState('');
  const userId = me?.id,
    isPremium = me?.premium;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    request<NonNullable<typeof state>>('?action=premium')
      .then((value) => {
        if (active) setState(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [userId, isPremium]);
  return (
    <section className="premium-page" aria-label="Noct Premium">
      <div className="premium-page-controls">
        <button
          className="icon-button"
          onClick={onBack}
          aria-label="Назад из Noct Premium"
        >
          <ArrowLeft size={20} />
        </button>
        <button
          className="icon-button"
          onClick={onBack}
          aria-label="Закрыть Noct Premium"
        >
          <X size={19} />
        </button>
      </div>
      <div className="premium-hero">
        <StarScene />
        <h2>Noct Premium</h2>
        <p>Оформление профиля и дополнительные функции.</p>
        <span className="premium-status">
          <span />
          {me?.premium
            ? 'Premium активен'
            : 'Твоя индивидуальность — в деталях'}
        </span>
        {!!state?.premium && state.expiresAt && (
          <p className="meta">
            До {new Date(state.expiresAt).toLocaleDateString('ru-RU')}
          </p>
        )}
      </div>
      <ul className="premium-features">
        {features.map(({ id, Icon, title, text, detail }) => (
          <li key={id}>
            <Collapsible
              open={feature === id}
              onOpenChange={(open) => setFeature(open ? id : '')}
            >
              <CollapsibleTrigger className="premium-feature-trigger">
                <span className="premium-feature-icon">
                  <Icon size={21} strokeWidth={1.6} />
                </span>
                <span className="premium-feature-copy">
                  <strong>{title}</strong>
                  <span>{text}</span>
                </span>
                <ChevronRight size={17} className="premium-feature-chevron" />
              </CollapsibleTrigger>
              <CollapsibleContent className="premium-feature-detail">
                <p>{detail}</p>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
      <div className="premium-bottom">
        {me && (
          <PurchaseButton
            owner={me.id}
            product="premium"
            onPaid={() => {
              void Promise.all([
                request<Profile>(
                  '?action=profile&id=' + encodeURIComponent(me.id),
                ),
                request<NonNullable<typeof state>>('?action=premium'),
              ])
                .then(([profile, premium]) => {
                  onUpdate(profile);
                  setState(premium);
                })
                .catch(() => {});
            }}
          />
        )}
        <button className="primary premium-cta" onClick={onDesign}>
          <PremiumIcon size={21} />
          {me?.premium ? 'Настроить оформление' : 'Примерить оформление'}
        </button>
        {state?.testMode && !me?.premium && (
          <button
            className="secondary premium-test-activate"
            disabled={busy || !!me?.restriction}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                onUpdate(
                  await request<Profile>('', { action: 'activatePremiumTest' }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Активируем…' : 'Активировать на 30 дней бесплатно'}
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="premium-note">
          {state?.testMode
            ? 'Тестовый Premium без оплаты. Один период на аккаунт, без автопродления.'
            : '30 дней без автопродления. Продлить можно в любой момент.'}
        </p>
      </div>
    </section>
  );
}
