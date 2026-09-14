'use client';
import { useLayoutEffect, useRef } from 'react';
import { Home, Search, Mail, Megaphone, Music2, UserRound } from 'lucide-react';
import { createMobileNavigation } from '@/lib/mobile-navigation';
import { AppLink } from './app-link';

const items = [
  ['feed', 'Лента', Home],
  ['search', 'Поиск', Search],
  ['messages', 'Сообщения', Mail],
  ['channels', 'Каналы', Megaphone],
  ['music', 'Музыка', Music2],
  ['profile', 'Профиль', UserRound],
] as const;

export function MainNavigation({
  page,
  href,
  navigate,
  openingProfile,
  unread,
}: {
  page: string;
  href: (page: string) => string;
  navigate: (page: string) => void;
  openingProfile: boolean;
  unread: number;
}) {
  const nav = useRef<HTMLElement>(null);
  const motion = useRef<ReturnType<typeof createMobileNavigation> | null>(null);
  const active =
    page === 'music-services' ? 'music' : page === 'saved' ? 'profile' : page;
  useLayoutEffect(() => {
    const controller = createMobileNavigation(nav.current!);
    motion.current = controller;
    return () => {
      controller.dispose();
      motion.current = null;
    };
  }, []);
  // Follow committed routes, including history/back and delayed profile loads.
  useLayoutEffect(() => {
    motion.current?.select(active);
  }, [active]);
  return (
    <nav ref={nav} aria-label="Главное меню" className="main-navigation">
      <div className="mobile-nav-pill" aria-hidden="true">
        <div className="mobile-nav-pill-shape" />
      </div>
      {items.map(([id, label, Icon]) => {
        const selected = active === id;
        return (
          <AppLink
            key={id}
            data-nav={id}
            className={selected ? 'active' : ''}
            aria-current={selected ? 'page' : undefined}
            aria-label={label}
            aria-busy={(id === 'profile' && openingProfile) || undefined}
            href={href(id)}
            onNavigate={() => navigate(id)}
          >
            <span className="nav-item-content">
              <Icon size={21} className="nav-item-icon" aria-hidden="true" />
              <span className="nav-item-label">{label}</span>
            </span>
            {id === 'messages' && unread > 0 && (
              <span className="nav-unread">{unread > 99 ? '99+' : unread}</span>
            )}
            {selected && <i />}
          </AppLink>
        );
      })}
    </nav>
  );
}
