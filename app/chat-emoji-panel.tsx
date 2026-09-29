'use client';
/* eslint-disable react/react-compiler */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Clock3,
  LoaderCircle,
  LockKeyhole,
  Search,
  Settings2,
  Smile,
  Sparkles,
  Star,
  Sticker,
  X,
} from 'lucide-react';
import {
  emojiToken,
  premiumEmoji,
  premiumEmojiPacks,
} from '@/lib/premium-emoji';
import { builtinPackInfo, stickerCatalog } from '@/lib/sticker-catalog';
import {
  loadStickerPanel,
  manageStickers,
  openStickerPack,
  recentStickers,
  resolveSticker,
  stickerAction,
  useStickerPanel,
} from '@/lib/sticker-client';
import type { StickerInfo, StickerPackInfo } from '@/lib/sticker-types';
import { PremiumEmoji } from './premium-emoji';
import { StickerView } from './sticker-view';

const ChatEmojiPicker = lazy(() => import('./chat-emoji-picker'));
type Tab = 'emoji' | 'premium' | 'stickers';
const TAB_KEY = 'noctgram:emoji-panel-tab';
function storedTab(): Tab {
  try {
    const value = localStorage.getItem(TAB_KEY);
    return value === 'premium' || value === 'stickers' ? value : 'emoji';
  } catch {
    return 'emoji';
  }
}
const loadingNote = (
  <output className="chat-emoji-loading">
    <LoaderCircle className="spin" size={22} />
    <span>Загружаем…</span>
  </output>
);

// Telegram-style panel next to the composer: Unicode emoji, premium and
// custom emoji, and stickers, which are sent at once.
export default function ChatEmojiPanel({
  meId,
  premium,
  onEmoji,
  onToken,
  onSticker,
  stickers = true,
}: {
  meId: string;
  premium: boolean;
  onEmoji: (emoji: string) => void;
  onToken: (token: string) => void;
  onSticker: (sticker: StickerInfo) => void;
  // Secret chats send text only.
  stickers?: boolean;
}) {
  const [stored, setTab] = useState<Tab>(storedTab);
  const tab = !stickers && stored === 'stickers' ? 'emoji' : stored;
  const choose = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // The last tab is only a convenience.
    }
  };
  const tabs: [Tab, string, typeof Smile][] = [
    ['emoji', 'Эмодзи', Smile],
    ['premium', 'Premium', Sparkles],
    ...(stickers
      ? ([['stickers', 'Стикеры', Sticker]] as [Tab, string, typeof Smile][])
      : []),
  ];
  return (
    <div className="emoji-panel">
      <nav className="emoji-panel-tabs" aria-label="Эмодзи и стикеры">
        {tabs.map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? 'active' : ''}
            aria-pressed={tab === value}
            onClick={() => choose(value)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
      <div className="emoji-panel-body">
        {tab === 'emoji' ? (
          <Suspense fallback={loadingNote}>
            <ChatEmojiPicker onSelect={onEmoji} />
          </Suspense>
        ) : tab === 'premium' ? (
          <PremiumTab meId={meId} premium={premium} onToken={onToken} />
        ) : (
          <StickerTab meId={meId} onSticker={onSticker} />
        )}
      </div>
    </div>
  );
}

function PremiumTab({
  meId,
  premium,
  onToken,
}: {
  meId: string;
  premium: boolean;
  onToken: (token: string) => void;
}) {
  const { panel } = useStickerPanel(meId);
  const allowed = panel?.premium ?? premium;
  const own = panel?.packs.filter((pack) => pack.type === 'emoji') ?? [];
  return (
    <div className="emoji-panel-scroll">
      {!allowed && (
        <p className="emoji-panel-lock">
          <LockKeyhole size={14} aria-hidden="true" />
          Эмодзи из наборов доступны с Noct Premium
        </p>
      )}
      {premiumEmojiPacks.map((pack) => (
        <section key={pack.id} className="emoji-panel-section">
          <h3>{pack.title}</h3>
          <div className="custom-emoji-grid">
            {premiumEmoji
              .filter((emoji) => emoji.pack === pack.id)
              .map((emoji) => (
                <button
                  key={emoji.id}
                  type="button"
                  disabled={!allowed}
                  aria-label={emoji.fallback + ' · ' + pack.title}
                  onClick={() => onToken(emojiToken(emoji))}
                >
                  <PremiumEmoji emoji={emoji} />
                </button>
              ))}
          </div>
        </section>
      ))}
      {own.map((pack) => (
        <section key={pack.ref} className="emoji-panel-section">
          <h3>
            <button
              type="button"
              className="emoji-panel-pack-link"
              onClick={() => openStickerPack(pack.shortName)}
            >
              {pack.title}
            </button>
          </h3>
          <div className="custom-emoji-grid">
            {pack.stickers.map((sticker) => (
              <button
                key={sticker.ref}
                type="button"
                disabled={!allowed || !sticker.token}
                aria-label={sticker.emoji + ' · ' + pack.title}
                onClick={() => sticker.token && onToken(sticker.token)}
              >
                <span className="premium-emoji custom-emoji">
                  <StickerView sticker={sticker} />
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <button
        type="button"
        className="emoji-panel-manage"
        onClick={() => manageStickers()}
      >
        <Settings2 size={15} aria-hidden="true" /> Мои наборы эмодзи и стикеров
      </button>
    </div>
  );
}

type Section = {
  key: string;
  title: string;
  stickers: StickerInfo[];
  pack?: StickerPackInfo;
};
function StickerTab({
  meId,
  onSticker,
}: {
  meId: string;
  onSticker: (sticker: StickerInfo) => void;
}) {
  const { panel, error } = useStickerPanel(meId);
  const [recent, setRecent] = useState<StickerInfo[]>([]),
    [query, setQuery] = useState(''),
    [menu, setMenu] = useState<StickerInfo | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    void Promise.allSettled(recentStickers(meId).map(resolveSticker)).then(
      (results) => {
        if (!active) return;
        setRecent(
          results.flatMap((result) =>
            result.status === 'fulfilled' && result.value.available
              ? [result.value]
              : [],
          ),
        );
      },
    );
    return () => {
      active = false;
    };
  }, [meId]);
  const favorites = panel?.favorites ?? [];
  const packs = [
    ...stickerCatalog.packs
      .filter((pack) => pack.type === 'stickers')
      .map(builtinPackInfo),
    ...(panel?.packs.filter((pack) => pack.type === 'stickers') ?? []),
  ];
  const all: Section[] = [
    ...(favorites.length
      ? [{ key: 'favorites', title: 'Избранные', stickers: favorites }]
      : []),
    ...(recent.length
      ? [{ key: 'recent', title: 'Недавние', stickers: recent.slice(0, 15) }]
      : []),
    ...packs.map((pack) => ({
      key: pack.ref,
      title: pack.title,
      stickers: pack.stickers,
      pack,
    })),
  ];
  const needle = query.trim();
  const sections = needle
    ? all
        .filter((section) => section.pack)
        .map((section) => ({
          ...section,
          stickers: section.stickers.filter(
            (sticker) =>
              sticker.emoji.includes(needle) ||
              section.title.toLowerCase().includes(needle.toLowerCase()),
          ),
        }))
        .filter((section) => section.stickers.length)
    : all;
  const faved = (sticker: StickerInfo) =>
    favorites.some((item) => item.ref === sticker.ref);
  const toggleFavorite = async (sticker: StickerInfo) => {
    setBusy(true);
    setNotice('');
    try {
      await stickerAction(meId, {
        action: 'fave',
        ref: sticker.ref,
        on: !faved(sticker),
      });
      await loadStickerPanel(meId, true);
      setMenu(null);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  };
  const jump = (key: string) =>
    scroller.current
      ?.querySelector(`[data-section="${CSS.escape(key)}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return (
    <div className="sticker-tab">
      <label className="sticker-search">
        <Search size={15} aria-hidden="true" />
        <input
          aria-label="Поиск стикеров по эмодзи"
          placeholder="Поиск по эмодзи или набору"
          value={query}
          maxLength={32}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label="Очистить поиск"
            onClick={() => setQuery('')}
          >
            <X size={14} />
          </button>
        )}
      </label>
      {!needle && (
        <nav className="sticker-pack-bar" aria-label="Наборы стикеров">
          {all.map((section) => (
            <button
              key={section.key}
              type="button"
              title={section.title}
              aria-label={section.title}
              onClick={() => jump(section.key)}
            >
              {section.key === 'favorites' ? (
                <Star size={18} />
              ) : section.key === 'recent' ? (
                <Clock3 size={18} />
              ) : section.stickers[0] ? (
                <StickerView sticker={section.stickers[0]} animate={false} />
              ) : (
                <Sticker size={18} />
              )}
            </button>
          ))}
          <button
            type="button"
            title="Мои наборы"
            aria-label="Мои наборы"
            onClick={() => manageStickers()}
          >
            <Settings2 size={18} />
          </button>
        </nav>
      )}
      <div className="emoji-panel-scroll" ref={scroller}>
        {error && !panel && (
          <p className="emoji-panel-note" role="alert">
            {error}
          </p>
        )}
        {sections.map((section) => (
          <section
            key={section.key}
            className="emoji-panel-section"
            data-section={section.key}
          >
            <h3>
              {section.pack && !section.pack.builtin ? (
                <button
                  type="button"
                  className="emoji-panel-pack-link"
                  onClick={() => openStickerPack(section.pack!.shortName)}
                >
                  {section.title}
                </button>
              ) : (
                section.title
              )}
            </h3>
            <div className="sticker-grid">
              {section.stickers.map((sticker) => (
                <button
                  key={section.key + sticker.ref}
                  type="button"
                  className={menu?.ref === sticker.ref ? 'menu-open' : ''}
                  aria-label={'Отправить стикер ' + sticker.emoji}
                  onClick={() => onSticker(sticker)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu(sticker);
                  }}
                >
                  <StickerView sticker={sticker} />
                </button>
              ))}
            </div>
          </section>
        ))}
        {needle && !sections.length && (
          <p className="emoji-panel-note">Стикеров с «{needle}» не нашлось</p>
        )}
        {!panel && !error && loadingNote}
      </div>
      {menu && (
        <section className="sticker-menu" aria-label="Стикер">
          <span className="sticker-menu-preview">
            <StickerView sticker={menu} />
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggleFavorite(menu)}
          >
            <Star size={15} aria-hidden="true" />
            {faved(menu) ? 'Убрать из избранного' : 'В избранное'}
          </button>
          {menu.packRef && (
            <button
              type="button"
              onClick={() => {
                openStickerPack(
                  menu.packRef.startsWith('b:')
                    ? menu.packRef.slice(2)
                    : menu.packRef,
                );
                setMenu(null);
              }}
            >
              <Sticker size={15} aria-hidden="true" /> Открыть набор
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть"
            onClick={() => setMenu(null)}
          >
            <X size={15} />
          </button>
          {notice && <small role="alert">{notice}</small>}
        </section>
      )}
    </div>
  );
}
