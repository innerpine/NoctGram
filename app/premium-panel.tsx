'use client';
import { useState } from 'react';
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
import { Avatar } from './post-card';
import { PremiumIcon } from './premium-icon';
import type { Profile } from '@/lib/client';

const features = [
  {
    id: 'avatars',
    Icon: Camera,
    title: 'Анимированные аватары',
    text: 'Профиль, в котором больше тебя.',
    detail:
      'Анимация аватара и дополнительные варианты рамок. Эти возможности появятся с запуском Noct Premium.',
  },
  {
    id: 'themes',
    Icon: Moon,
    title: 'Оформление профиля',
    text: 'Особенные рамки, обложки и акценты.',
    detail:
      'Подбирай тему профиля и сочетай её со своей обложкой. Пример оформления можно посмотреть ниже.',
  },
  {
    id: 'status',
    Icon: Smile,
    title: 'Значок и эмодзи-статусы',
    text: 'Маленькие детали с твоим настроением.',
    detail:
      'Фирменный значок Noct Premium рядом с именем и коллекция эмодзи-статусов для профиля.',
  },
  {
    id: 'posts',
    Icon: Palette,
    title: 'Больше стиля в публикациях',
    text: 'Косметика для твоих мыслей и историй.',
    detail:
      'Дополнительное оформление публикаций и эффекты реакций — в планах Noct Premium.',
  },
  {
    id: 'usernames',
    Icon: AtSign,
    title: 'Коллекционные юзернеймы',
    text: 'Имена, которые хочется сохранить.',
    detail:
      'Покупка и передача коллекционных имён появятся позже. Обычные юзернеймы уже можно добавлять бесплатно в профиле.',
  },
];

export function PremiumPanel({
  me,
  onBack,
}: {
  me: Profile | null;
  onBack: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [feature, setFeature] = useState('');
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
        <p>Больше способов быть собой.</p>
        <span className="premium-status">
          <span />
          Скоро в Noctgram
        </span>
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
        <div
          className="premium-preview-region"
          id="premium-profile-preview"
          hidden={!preview}
        >
          {preview && (
            <div className="premium-profile-preview">
              <div className="premium-preview-cover">
                <span>n.</span>
              </div>
              <div className="premium-preview-body">
                <div className="premium-preview-avatar">
                  <Avatar
                    person={me || { name: 'Noctgram', avatar: '' }}
                    size={64}
                  />
                </div>
                <span className="badge preview-label">Предпросмотр</span>
                <h3>
                  {me?.name || 'Твоё имя'} <PremiumIcon size={22} />
                </h3>
                <span className="meta">@{me?.handle || 'yourname'}</span>
                <p>{me?.bio || 'Твои мысли. Твоё оформление.'}</p>
              </div>
            </div>
          )}
        </div>
        <button
          className="primary premium-cta"
          aria-expanded={preview}
          aria-controls="premium-profile-preview"
          onClick={() => setPreview((v) => !v)}
        >
          <PremiumIcon size={21} />
          {preview ? 'Скрыть предпросмотр' : 'Посмотреть оформление'}
        </button>
        <p className="premium-note">
          Подписка ещё не запущена. Оформление доступно для предпросмотра.
        </p>
      </div>
    </section>
  );
}
