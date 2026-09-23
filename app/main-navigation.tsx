'use client';
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  Home,
  Search,
  Mail,
  Megaphone,
  Music2,
  Store,
  UserRound,
} from 'lucide-react';
import {
  MOBILE_NAV_QUERY,
  createMobileNavigation,
} from '@/lib/mobile-navigation';
import { AppLink } from './app-link';

const items = [
  ['feed', 'Лента', Home],
  ['search', 'Поиск', Search],
  ['messages', 'Сообщения', Mail],
  ['channels', 'Каналы', Megaphone],
  ['music', 'Музыка', Music2],
  ['market', 'Маркет', Store],
  ['profile', 'Профиль', UserRound],
] as const;

const watchPhone = (change: () => void) => {
  const query = window.matchMedia(MOBILE_NAV_QUERY);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
};
const isPhone = () => window.matchMedia(MOBILE_NAV_QUERY).matches;

export function MainNavigation({
  active: section,
  origin,
  href,
  navigate,
  openingProfile,
  unread,
}: {
  active: string;
  origin: string;
  href: (page: string) => string;
  navigate: (page: string) => boolean | Promise<boolean>;
  openingProfile: boolean;
  unread: number;
}) {
  const nav = useRef<HTMLElement>(null);
  const motion = useRef<ReturnType<typeof createMobileNavigation> | null>(null);
  // Phones hide the Search tab; search keeps the tab it was opened from.
  const phone = useSyncExternalStore(watchPhone, isPhone, () => false);
  const active = phone && section === 'search' ? origin : section;
  const committed = useRef(active);
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
    committed.current = active;
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
            // Market is a standalone page outside the in-app history.
            href={id === 'market' ? '/market' : href(id)}
            onNavigate={() => {
              if (id === 'market') return window.location.assign('/market');
              // The pill answers the tap at once; a refused route moves it back.
              motion.current?.select(id);
              void Promise.resolve(navigate(id)).then((opened) => {
                if (!opened) motion.current?.select(committed.current);
              });
            }}
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
