'use client';
/* Private chat media requires session cookies. */
/* eslint-disable next/no-img-element, jsx-a11y/media-has-caption, react/react-compiler */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  AtSign,
  Check,
  ChevronRight,
  Copy,
  Download,
  File as FileIcon,
  Gift,
  Headphones,
  Image as ImageIcon,
  Link as LinkIcon,
  LoaderCircle,
  MessageCircle,
  Play,
  Video,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Person, Profile } from '@/lib/client';
import { chatRequest } from '@/lib/chat-client';
import { chatFileSize } from '@/lib/chat-files';
import {
  type ChatLibraryKind,
  type ChatLibraryItem,
  type ChatLibraryPage,
  type ChatLibraryStats,
} from '@/lib/chat-library';
import { giftDefinition, type ReceivedGift } from '@/lib/gift-catalog';
import { Avatar, DisplayName, appearanceStyle } from './profile-identity';
import { ProfileRecognitions } from './profile-recognitions';
import { GiftAnimation } from './gift-animation';
import { ChatEmojiText } from './chat-emoji-text';
import { ProfileLink } from './profile-link';
import { ChatPeerPresence } from './chat-peer-presence';
import { useProfileBackground } from './profile-surface';
import { prepareProfileVisuals } from '@/lib/profile-visuals';
import { ChatVideoPlayer } from './chat-video-player';

const sections = [
  { id: 'photos', title: 'Фотографии', icon: ImageIcon },
  { id: 'videos', title: 'Видео', icon: Video },
  { id: 'files', title: 'Файлы', icon: FileIcon },
  { id: 'audio', title: 'Аудиофайлы', icon: Headphones },
  { id: 'links', title: 'Ссылки', icon: LinkIcon },
] as const;
type GiftPage = { gifts: ReceivedGift[]; next: string | null };
type View =
  | { kind: 'profile' | 'gifts' | ChatLibraryKind }
  | { kind: 'media'; item: ChatLibraryItem; from: ChatLibraryKind }
  | { kind: 'gift'; gift: ReceivedGift };
const viewKey = (view: View) =>
  view.kind === 'media'
    ? view.item.id
    : view.kind === 'gift'
      ? view.gift.id
      : view.kind;
const date = (time: number) =>
  new Date(time).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const mediaUrl = (id: string) => '/api/media/' + encodeURIComponent(id);
const get = <T,>(url: string, signal?: AbortSignal) =>
  chatRequest<T>(url, {
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });

export function ChatPeerProfile({
  peer,
  viewerId,
  lastSeen = peer.lastSeen,
}: {
  peer: Person;
  viewerId: string;
  lastSeen?: number | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="chat-peer"
        aria-label={'О собеседнике: ' + peer.name}
        onClick={() => setOpen(true)}
      >
        <Avatar person={peer} size={34} />
        <span>
          <strong>
            <DisplayName person={peer} />
          </strong>
          <ChatPeerPresence lastSeen={lastSeen} />
        </span>
      </button>
      <ChatProfileDialog
        person={peer}
        viewerId={viewerId}
        chatPeerId={peer.id}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

export function ChatProfileDialog({
  person,
  viewerId,
  chatPeerId,
  open,
  onOpenChange,
}: {
  person: Person;
  viewerId: string;
  chatPeerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={popup}
        className="chat-peer-dialog"
        showCloseButton={false}
        initialFocus={popup}
      >
        <PeerProfileBody
          key={viewerId + ':' + chatPeerId + ':' + person.id}
          peer={person}
          own={person.id === viewerId}
          chatPeerId={chatPeerId}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PeerProfileBody({
  peer,
  own,
  chatPeerId,
  onClose,
}: {
  peer: Person;
  own: boolean;
  chatPeerId: string;
  onClose: () => void;
}) {
  const [person, setPerson] = useState<Profile | null>(null),
    [stats, setStats] = useState<ChatLibraryStats | null>(null);
  const [gifts, setGifts] = useState<GiftPage | null>(null),
    [pages, setPages] = useState<
      Partial<Record<ChatLibraryKind, ChatLibraryPage>>
    >({});
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<View>({ kind: 'profile' }),
    [leaving, setLeaving] = useState(false),
    [backward, setBackward] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );
  const scroll = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    positions = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    abort = useRef<AbortController | null>(null),
    pending = useRef(new Set<string>());
  const identity = person || peer;
  const surface = useProfileBackground(identity);
  useEffect(() => {
    if (copyStatus === 'idle') return;
    const reset = setTimeout(() => setCopyStatus('idle'), 2500);
    return () => clearTimeout(reset);
  }, [copyStatus]);
  async function copyHandle() {
    try {
      await navigator.clipboard.writeText('@' + identity.handle);
      if (!abort.current?.signal.aborted) setCopyStatus('copied');
    } catch {
      if (!abort.current?.signal.aborted) setCopyStatus('error');
    }
  }
  const online = !!person?.lastSeen && Date.now() - person.lastSeen < 120000;
  const title =
    view.kind === 'profile'
      ? own
        ? 'Ваш профиль'
        : 'О собеседнике'
      : view.kind === 'gifts'
        ? 'Подарки'
        : view.kind === 'gift'
          ? giftDefinition(view.gift.giftId)?.name || 'Подарок'
          : view.kind === 'media'
            ? view.item.file?.name || 'Вложение'
            : sections.find((section) => section.id === view.kind)!.title;

  async function load(key: string, more = false) {
    if (pending.current.has(key) || abort.current?.signal.aborted) return;
    pending.current.add(key);
    const controller = abort.current;
    setLoading((old) => ({ ...old, [key]: true }));
    setErrors((old) => ({ ...old, [key]: '' }));
    try {
      if (key === 'profile') {
        const result = await get<Profile>(
          '/api/social?action=profile&id=' + encodeURIComponent(peer.id),
          controller?.signal,
        );
        if (controller?.signal.aborted) return;
        await prepareProfileVisuals(result);
        if (!controller?.signal.aborted) setPerson(result);
      } else if (key === 'stats') {
        const result = await get<ChatLibraryStats>(
          '/api/social?' +
            new URLSearchParams({ action: 'chatLibrary', peer: chatPeerId }),
          controller?.signal,
        );
        if (!controller?.signal.aborted) setStats(result);
      } else if (key === 'gifts') {
        const result = await get<GiftPage>(
          '/api/gifts?' +
            new URLSearchParams({
              user: peer.id,
              ...(more && gifts?.next ? { before: gifts.next } : {}),
            }),
          controller?.signal,
        );
        if (!controller?.signal.aborted)
          setGifts((old) => ({
            ...result,
            gifts:
              more && old
                ? [
                    ...old.gifts,
                    ...result.gifts.filter(
                      (item) => !old.gifts.some((gift) => gift.id === item.id),
                    ),
                  ]
                : result.gifts,
          }));
      } else {
        const kind = key as ChatLibraryKind;
        const result = await get<ChatLibraryPage>(
          '/api/social?' +
            new URLSearchParams({
              action: 'chatLibrary',
              peer: chatPeerId,
              kind,
              ...(more && pages[kind]?.next
                ? { before: pages[kind]!.next! }
                : {}),
            }),
          controller?.signal,
        );
        if (!controller?.signal.aborted)
          setPages((old) => ({
            ...old,
            [kind]: {
              ...result,
              items:
                more && old[kind]
                  ? [
                      ...old[kind]!.items,
                      ...result.items.filter(
                        (item) =>
                          !old[kind]!.items.some(
                            (previous) => previous.id === item.id,
                          ),
                      ),
                    ]
                  : result.items,
            },
          }));
      }
    } catch (error) {
      if (!controller?.signal.aborted)
        setErrors((old) => ({ ...old, [key]: (error as Error).message }));
    } finally {
      if (controller === abort.current) pending.current.delete(key);
      if (!controller?.signal.aborted)
        setLoading((old) => ({ ...old, [key]: false }));
    }
  }
  useEffect(() => {
    abort.current = new AbortController();
    pending.current.clear();
    void load('profile');
    void load('stats');
    void load('gifts');
    return () => {
      abort.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
    // Keyed by viewer, conversation and displayed person; no background polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    if (scroll.current)
      scroll.current.scrollTop = positions.current.get(viewKey(view)) || 0;
    if (view.kind !== 'profile')
      heading.current?.focus({ preventScroll: true });
  }, [view]);
  function navigate(next: View, back = false) {
    if (timer.current) return;
    if (scroll.current)
      positions.current.set(viewKey(view), scroll.current.scrollTop);
    if (
      sections.some((section) => section.id === next.kind) &&
      !pages[next.kind as ChatLibraryKind]
    )
      void load(next.kind);
    setBackward(back);
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reduced) {
      setView(next);
      return;
    }
    setLeaving(true);
    timer.current = setTimeout(() => {
      setView(next);
      setLeaving(false);
      timer.current = null;
    }, 110);
  }
  function back() {
    navigate(
      view.kind === 'media'
        ? { kind: view.from }
        : view.kind === 'gift'
          ? { kind: 'gifts' }
          : { kind: 'profile' },
      true,
    );
  }
  function feedback(key: string) {
    return errors[key] ? (
      <div className="peer-error" role="alert">
        <p>{errors[key]}</p>
        <button className="secondary" onClick={() => void load(key)}>
          Повторить
        </button>
      </div>
    ) : null;
  }
  const library = sections.some((section) => section.id === view.kind)
    ? pages[view.kind as ChatLibraryKind]
    : null;
  const currentGift =
    view.kind === 'gift' ? giftDefinition(view.gift.giftId) : null;

  if (!person) {
    return (
      <div
        className="peer-profile-shell peer-profile-loading"
        aria-busy={!errors.profile}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Загружаем профиль и его оформление.
        </DialogDescription>
        <div className="peer-profile-toolbar over-cover">
          <button
            className="icon-button peer-profile-close"
            aria-label="Закрыть мини-профиль"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="peer-profile-placeholder" aria-hidden="true">
          <div className="peer-placeholder-cover" />
          <div className="peer-placeholder-avatar" />
          <div className="peer-placeholder-line" />
          <div className="peer-placeholder-line short" />
        </div>
        <div className="peer-profile-load-status">
          {errors.profile ? (
            feedback('profile')
          ) : (
            <output>Загружаем профиль…</output>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      className="peer-profile-shell peer-profile-ready"
      data-profile-background={!!surface}
      style={{ ...appearanceStyle(identity), ...surface }}
    >
      <div
        className={
          'peer-profile-toolbar' +
          (view.kind === 'profile' ? ' over-cover' : '')
        }
      >
        {view.kind !== 'profile' && (
          <button
            className="icon-button"
            aria-label="Назад в мини-профиле"
            onClick={back}
            disabled={leaving}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <DialogTitle
          ref={heading}
          tabIndex={-1}
          className={view.kind === 'profile' ? 'sr-only' : 'peer-section-title'}
        >
          {title}
        </DialogTitle>
        <button
          className="icon-button peer-profile-close"
          aria-label="Закрыть мини-профиль"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <DialogDescription className="sr-only">
        {own
          ? 'Ваш профиль, подарки и материалы текущей переписки.'
          : 'Информация о собеседнике, его подарки и материалы вашей переписки.'}
      </DialogDescription>
      <div ref={scroll} className="peer-profile-scroll">
        <div
          key={viewKey(view)}
          className={
            'peer-profile-page' +
            (leaving ? ' leaving' : '') +
            (backward ? ' backward' : '')
          }
          aria-busy={leaving}
          inert={leaving}
        >
          {view.kind === 'profile' && (
            <>
              <div className="peer-profile-hero">
                <div className="peer-profile-cover">
                  {person?.cover && (
                    <img
                      src={person.cover}
                      alt=""
                      decoding="async"
                      onError={(event) => {
                        event.currentTarget.style.visibility = 'hidden';
                      }}
                    />
                  )}
                </div>
                <div className="peer-profile-identity">
                  <ProfileLink
                    target={{ id: peer.id, handle: peer.handle }}
                    className="peer-profile-avatar"
                    aria-label={'Открыть профиль: ' + identity.name}
                  >
                    <Avatar person={identity} size={86} eager />
                  </ProfileLink>
                  <h2>
                    <ProfileLink target={{ id: peer.id, handle: peer.handle }}>
                      <DisplayName person={identity} />
                    </ProfileLink>
                  </h2>
                  <p className={online ? 'online' : ''}>
                    {online
                      ? 'В сети'
                      : person?.lastSeen === null
                        ? 'Статус скрыт'
                        : person?.lastSeen
                          ? 'Был(а) ' +
                            new Date(person.lastSeen).toLocaleString('ru-RU', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'Личный диалог'}
                  </p>
                </div>
                <div className="peer-profile-actions">
                  <button className="secondary" onClick={onClose}>
                    <MessageCircle size={17} /> В чат
                  </button>
                  <ProfileLink
                    className="secondary"
                    target={{ id: peer.id, handle: peer.handle }}
                  >
                    Полный профиль <ArrowUpRight size={17} />
                  </ProfileLink>
                </div>
              </div>
              <div className="peer-profile-info">
                <button
                  className="peer-info-row peer-copy-handle"
                  onClick={() => void copyHandle()}
                  aria-label={'Скопировать @' + identity.handle}
                  title="Скопировать имя пользователя"
                >
                  <AtSign size={19} />
                  <span className="peer-copy-text">
                    <span>@{identity.handle}</span>
                    <small>
                      <output>
                        {copyStatus === 'copied'
                          ? 'Скопировано'
                          : copyStatus === 'error'
                            ? 'Не удалось скопировать. Нажмите ещё раз'
                            : 'Имя пользователя'}
                      </output>
                    </small>
                  </span>
                  {copyStatus === 'copied' ? (
                    <Check size={17} className="peer-copy-icon copied" />
                  ) : (
                    <Copy size={17} className="peer-copy-icon" />
                  )}
                </button>
                {person?.bio && (
                  <div className="peer-profile-bio">
                    <ChatEmojiText text={person.bio} />
                    <small>О себе</small>
                  </div>
                )}
                {loading.profile && !person && (
                  <output className="peer-loading-inline">
                    <LoaderCircle size={14} className="spin" /> Загружаем
                    информацию…
                  </output>
                )}
                <ProfileRecognitions person={identity} compact />
                {feedback('profile')}
              </div>
              <div className="peer-chat-stats">
                <h3>Ваша переписка</h3>
                <div className="peer-stats-grid">
                  <div>
                    <strong>
                      {stats?.messages.toLocaleString('ru-RU') ?? '—'}
                    </strong>
                    <small>Сообщений</small>
                  </div>
                  <div>
                    <strong>
                      {stats
                        ? (
                            stats.photos +
                            stats.videos +
                            stats.files +
                            stats.audio
                          ).toLocaleString('ru-RU')
                        : '—'}
                    </strong>
                    <small>Вложений</small>
                  </div>
                </div>
                {stats?.first ? (
                  <p>
                    Общаетесь с {date(stats.first)} · от вас {stats.sent}, от
                    собеседника {stats.received}
                  </p>
                ) : (
                  <p>
                    {stats
                      ? 'Здесь начнётся ваша переписка'
                      : 'Загружаем статистику…'}
                  </p>
                )}
                {feedback('stats')}
              </div>
              <div className="peer-profile-sections">
                <button onClick={() => navigate({ kind: 'gifts' })}>
                  <Gift size={21} />
                  <span>Подарки в профиле</span>
                  <small>
                    {gifts ? gifts.gifts.length + (gifts.next ? '+' : '') : '—'}
                  </small>
                  <ChevronRight size={16} />
                </button>
                {sections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => navigate({ kind: section.id })}
                  >
                    <section.icon size={21} />
                    <span>{section.title}</span>
                    <small>
                      {section.id === 'links'
                        ? ''
                        : (stats?.[section.id] ?? '—')}
                    </small>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            </>
          )}
          {view.kind === 'gifts' && (
            <div className="peer-section-body">
              {loading.gifts && !gifts && <Loading />}
              {feedback('gifts')}
              {gifts && (
                <>
                  <div className="peer-gift-grid">
                    {gifts.gifts.map((receipt) => (
                      <button
                        key={receipt.id}
                        className="peer-gift-tile"
                        onClick={() =>
                          navigate({ kind: 'gift', gift: receipt })
                        }
                      >
                        <GiftAnimation id={receipt.giftId} />
                        <strong>
                          {giftDefinition(receipt.giftId)?.name || 'Подарок'}
                        </strong>
                      </button>
                    ))}
                  </div>
                  {!gifts.gifts.length && (
                    <Empty
                      icon="gift"
                      text="Пока без подарков"
                      detail={
                        own
                          ? 'Здесь появятся подарки, которые вы показываете в профиле.'
                          : 'Здесь появятся подарки, которые собеседник показывает в профиле.'
                      }
                    />
                  )}
                  {gifts.next && (
                    <More
                      busy={!!loading.gifts}
                      onClick={() => void load('gifts', true)}
                    />
                  )}
                </>
              )}
            </div>
          )}
          {view.kind === 'gift' && (
            <div className="peer-gift-detail peer-section-body">
              <div className="peer-gift-art">
                <GiftAnimation id={view.gift.giftId} />
              </div>
              <h3>{currentGift?.name || 'Подарок'}</h3>
              <p>
                от{' '}
                <ProfileLink target={{ id: view.gift.sender }}>
                  {view.gift.senderName}
                </ProfileLink>
              </p>
              {view.gift.message && (
                <div className="peer-gift-message">
                  <ChatEmojiText text={view.gift.message} />
                </div>
              )}
              <time>{date(view.gift.created)}</time>
            </div>
          )}
          {sections.some((section) => section.id === view.kind) && (
            <div className="peer-section-body">
              {loading[view.kind] && !library && <Loading />}
              {feedback(view.kind)}
              {library && (
                <>
                  <div
                    className={
                      ['photos', 'videos'].includes(view.kind)
                        ? 'peer-media-grid'
                        : 'peer-file-list'
                    }
                  >
                    {library.items.map((item) =>
                      item.url ? (
                        <a
                          className="peer-link-row"
                          key={item.id}
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span className="peer-file-icon">
                            <LinkIcon size={23} />
                          </span>
                          <span>
                            <strong>{new URL(item.url).hostname}</strong>
                            <span className="peer-link-url">{item.url}</span>
                            <small>{date(item.created)}</small>
                          </span>
                          <ArrowUpRight size={17} />
                        </a>
                      ) : (
                        item.file && (
                          <button
                            key={item.id}
                            className={
                              ['photos', 'videos'].includes(view.kind)
                                ? 'peer-media-tile'
                                : 'peer-file-row'
                            }
                            onClick={() =>
                              navigate({
                                kind: 'media',
                                item,
                                from: view.kind as ChatLibraryKind,
                              })
                            }
                            aria-label={'Открыть ' + item.file.name}
                          >
                            {view.kind === 'photos' ? (
                              <img
                                src={mediaUrl(item.file.id)}
                                alt={item.file.name}
                                loading="lazy"
                                decoding="async"
                              />
                            ) : view.kind === 'videos' ? (
                              <>
                                <video
                                  src={mediaUrl(item.file.id)}
                                  preload="metadata"
                                  muted
                                  playsInline
                                />
                                <span className="peer-video-play">
                                  <Play size={22} />
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="peer-file-icon">
                                  {view.kind === 'audio' ? (
                                    <Headphones size={23} />
                                  ) : (
                                    <FileIcon size={23} />
                                  )}
                                </span>
                                <span>
                                  <strong>{item.file.name}</strong>
                                  <small>
                                    {chatFileSize(item.file.size)} ·{' '}
                                    {date(item.created)}
                                  </small>
                                </span>
                                <ChevronRight size={16} />
                              </>
                            )}
                          </button>
                        )
                      ),
                    )}
                  </div>
                  {!library.items.length && (
                    <Empty
                      text={
                        library.next
                          ? 'На этой странице нет доступных материалов'
                          : 'Здесь пока пусто'
                      }
                      detail="Материалы из вашей переписки появятся в этом разделе."
                    />
                  )}
                  {library.next && (
                    <More
                      busy={!!loading[view.kind]}
                      onClick={() => void load(view.kind, true)}
                    />
                  )}
                </>
              )}
            </div>
          )}
          {view.kind === 'media' && view.item.file && (
            <div className="peer-media-detail peer-section-body">
              {view.item.file.kind === 'image' ? (
                <img
                  src={mediaUrl(view.item.file.id)}
                  alt={view.item.file.name}
                />
              ) : view.item.file.kind === 'video' ? (
                <ChatVideoPlayer
                  src={mediaUrl(view.item.file.id)}
                  name={view.item.file.name}
                />
              ) : view.item.file.type.startsWith('audio/') ? (
                <>
                  <div className="peer-document-art">
                    <Headphones size={54} />
                  </div>
                  <audio
                    src={mediaUrl(view.item.file.id)}
                    controls
                    preload="metadata"
                    aria-label={view.item.file.name}
                  />
                </>
              ) : (
                <div className="peer-document-art">
                  <FileIcon size={54} />
                </div>
              )}
              <strong>{view.item.file.name}</strong>
              <small>
                {chatFileSize(view.item.file.size)} · {date(view.item.created)}
              </small>
              {view.item.file.kind !== 'video' && (
                <a
                  className="secondary"
                  href={mediaUrl(view.item.file.id) + '?download=1'}
                  download={view.item.file.name}
                >
                  <Download size={17} /> Скачать
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function Loading() {
  return (
    <output className="peer-loading">
      <LoaderCircle size={22} className="spin" /> Загружаем…
    </output>
  );
}
function More({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      className="secondary peer-load-more"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <LoaderCircle size={16} className="spin" /> : null} Показать ещё
    </button>
  );
}
function Empty({
  text,
  detail,
  icon,
}: {
  text: string;
  detail: string;
  icon?: 'gift';
}) {
  return (
    <div className="peer-empty">
      {icon === 'gift' ? <Gift size={34} /> : <MessageCircle size={34} />}
      <h3>{text}</h3>
      <p>{detail}</p>
    </div>
  );
}
