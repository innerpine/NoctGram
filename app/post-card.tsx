'use client';
/* Authenticated user media remains a normal browser request. User uploads do not have generated caption tracks. */
/* eslint-disable next/no-img-element, jsx-a11y/media-has-caption */
import {
  Heart,
  MessageCircle,
  Bookmark,
  Trash2,
  Check,
  Moon,
  MoreHorizontal,
  Link,
  Pin,
  EyeOff,
  Flag,
  Eye,
  Video,
  ShieldCheck,
  Megaphone,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Avatar, DisplayName, appearanceStyle } from './profile-identity';
import { ProfileLink, MentionText } from './profile-link';
export { Avatar } from './profile-identity';
import { StarsIcon } from './stars-icon';
import { CodeBlock } from './code-block';
import { MusicLinkCard } from './music-link-card';
import type { Post, Media } from '@/lib/client';
import {
  memo,
  useMemo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
const stampFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const stampTitleFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
export function Stamp({
  time,
  compact = false,
}: {
  time: number;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!compact) return;
    const tick = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(tick);
  }, [compact]);
  const age = Math.max(0, Math.floor((now - time) / 60000));
  const stamp = useMemo(
    () => ({
      title: stampTitleFormat.format(time),
      label: stampFormat.format(time),
      iso: new Date(time).toISOString(),
    }),
    [time],
  );
  const label = compact
    ? age < 1
      ? 'сейчас'
      : age < 60
        ? age + ' мин'
        : age < 1440
          ? Math.floor(age / 60) + ' ч'
          : Math.floor(age / 1440) + ' д'
    : stamp.label;
  return (
    <time
      className="meta"
      suppressHydrationWarning
      title={stamp.title}
      dateTime={stamp.iso}
    >
      {label}
    </time>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Moon size={27} />
      <div>{children}</div>
    </div>
  );
}
export function PostSkeleton() {
  return (
    <div className="post post-skeleton" aria-hidden="true">
      <span className="skeleton-avatar" />
      <div>
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
export const PostCard = memo(function PostCard({
  p,
  me,
  busy,
  onProfile,
  onAction,
  onComments,
  onDelete,
  onMedia,
  onMenu,
  onSupport,
  onView,
  canModerate = false,
}: {
  p: Post;
  me?: string;
  busy: boolean;
  onProfile: (id: string) => void;
  onAction: (p: Post, kind: string, value: unknown) => Promise<boolean>;
  onComments: (p: Post) => void;
  onDelete: (id: string) => void;
  onMedia: (m: Media) => void;
  onMenu: (p: Post, kind: string) => void;
  onSupport: (p: Post) => void;
  onView: (id: string) => Promise<boolean>;
  canModerate?: boolean;
}) {
  const [expanded, setExpanded] = useState(false),
    [pending, setPending] = useState(false),
    [bump, setBump] = useState(''),
    [revealed, setRevealed] = useState(false);
  const article = useRef<HTMLElement>(null),
    recorded = useRef(false);
  const mine = p.userId === me || p.ownerId === me;
  const canManage = mine || !!p.canManagePosts;
  const isChannel = p.kind === 'channel';
  const authorLabel = (isChannel ? 'Канал ' : 'Профиль ') + p.name;
  useEffect(() => {
    if (!me || mine || recorded.current || !article.current) return;
    let visible = false;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const schedule = () => {
      clearTimeout(pending);
      if (
        visible &&
        document.visibilityState === 'visible' &&
        !recorded.current
      )
        pending = setTimeout(() => {
          recorded.current = true;
          void onView(p.id).then((ok) => {
            if (live && !ok) recorded.current = false;
          });
        }, 1000);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        schedule();
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(article.current);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      live = false;
      clearTimeout(pending);
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [me, mine, p.id, onView]);
  const lock = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const act = async (kind: string, value: unknown) => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      if (await onAction(p, kind, value)) {
        setBump(kind);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setBump(''), 600);
      }
    } finally {
      setPending(false);
      lock.current = false;
    }
  };
  const total = p.votes.reduce((n, v) => n + v.count, 0),
    long = p.text.length > 220;
  return (
    <article
      ref={article}
      className={'post' + (isChannel ? ' post--channel' : '')}
      id={'post-' + p.id}
    >
      <div className="post-avatar">
        <button onClick={() => onProfile(p.userId)} aria-label={authorLabel}>
          <Avatar person={p} />
        </button>
      </div>
      <div className="post-content">
        {!!p.pinned && (
          <div className="pinned-label">
            <Pin size={11} />
            {isChannel ? 'Закреплено в канале' : 'Закреплено в профиле'}
          </div>
        )}
        <div className="post-author">
          <span className="post-author-name">
            <button
              className="author-button"
              onClick={() => onProfile(p.userId)}
              aria-label={authorLabel}
              title={p.name}
            >
              <DisplayName person={p} />
            </button>
            {isChannel && (
              <span className="post-channel-label" style={appearanceStyle(p)}>
                <Megaphone size={13} aria-hidden="true" />
                Канал
              </span>
            )}
          </span>
          <span className="post-author-meta">
            <ProfileLink target={{ id: p.userId }} className="meta handle">
              @{p.handle}
            </ProfileLink>
            <span className="meta-dot" />
            <Stamp time={p.created} compact />
          </span>
          <span className="grow" />
          <DropdownMenu>
            <DropdownMenuTrigger
              className="icon-button post-menu-trigger"
              aria-label="Действия с публикацией"
            >
              <MoreHorizontal size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="post-menu">
              <DropdownMenuItem onClick={() => onMenu(p, 'copy')}>
                <Link size={15} />
                Скопировать ссылку
              </DropdownMenuItem>
              {canManage ? (
                <>
                  <DropdownMenuItem
                    disabled={busy}
                    onClick={() => onMenu(p, 'pin')}
                  >
                    <Pin size={15} />
                    {p.pinned
                      ? isChannel
                        ? 'Открепить от канала'
                        : 'Открепить от профиля'
                      : isChannel
                        ? 'Закрепить в канале'
                        : 'Закрепить в профиле'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={busy}
                    onClick={() => onDelete(p.id)}
                  >
                    <Trash2 size={15} />
                    Удалить публикацию
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem
                    disabled={busy}
                    onClick={() => onMenu(p, 'hide')}
                  >
                    <EyeOff size={15} />
                    Не интересно
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy}
                    onClick={() => onMenu(p, 'report')}
                  >
                    <Flag size={15} />
                    Пожаловаться
                  </DropdownMenuItem>
                </>
              )}
              {canModerate && (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy}
                  onClick={() => onMenu(p, 'moderateContent')}
                >
                  <ShieldCheck size={15} />
                  Удалить как модератор
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div
          className={'post-text-wrap ' + (long && !expanded ? 'collapsed' : '')}
          id={'text-' + p.id}
        >
          <p className="post-text">
            <MentionText text={p.text} />
          </p>
        </div>
        {long && (
          <button
            className="expand-post"
            aria-expanded={expanded}
            aria-controls={'text-' + p.id}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Свернуть' : 'Ещё'}
          </button>
        )}
        <MusicLinkCard text={p.text} />
        {p.code && <CodeBlock code={p.code} language={p.codeLang} />}
        {p.media.length > 0 && (
          <div
            className={
              'post-media-wrap ' + (p.adult && !revealed ? 'is-sensitive' : '')
            }
          >
            <div
              className={'media-grid ' + (p.media.length === 1 ? 'single' : '')}
              inert={!!p.adult && !revealed}
            >
              {p.media.map((m) =>
                m.type.startsWith('image/') ? (
                  <button
                    key={m.id}
                    onClick={() => onMedia(m)}
                    aria-label={'Открыть ' + m.name}
                  >
                    <img
                      src={'/api/media/' + m.id}
                      alt={m.name}
                      loading="lazy"
                    />
                  </button>
                ) : p.adult && !revealed ? (
                  <div className="sensitive-video" key={m.id}>
                    <Video size={32} />
                  </div>
                ) : (
                  <video
                    key={m.id}
                    controls
                    playsInline
                    preload="metadata"
                    src={'/api/media/' + m.id}
                    aria-label={m.name}
                  />
                ),
              )}
            </div>
            {!!p.adult &&
              (!revealed ? (
                <button
                  className="sensitive-cover"
                  onClick={() => setRevealed(true)}
                >
                  <span className="adult-mark">18+</span>
                  <strong>Материалы для взрослых</strong>
                  <span>Показать фото и видео</span>
                </button>
              ) : (
                <button
                  className="hide-sensitive"
                  onClick={() => setRevealed(false)}
                >
                  <EyeOff size={13} />
                  Скрыть 18+
                </button>
              ))}
          </div>
        )}
        {p.poll.length > 0 && (
          <fieldset className="poll" aria-label="Опрос — выберите один вариант">
            {p.poll.map((option, i) => {
              const count = p.votes.find((v) => v.option === i)?.count || 0,
                percent = total ? Math.round((count / total) * 100) : 0,
                chosen = p.voted === i;
              return (
                <button
                  key={i}
                  disabled={busy || pending}
                  className={chosen ? 'voted' : ''}
                  aria-pressed={chosen}
                  onClick={() => void act('vote', i)}
                >
                  <span
                    className="poll-fill"
                    style={{ width: p.voted !== null ? percent + '%' : '0%' }}
                  />
                  <span className="poll-label">
                    <span className={'radio-dot ' + (chosen ? 'chosen' : '')}>
                      {chosen && <Check size={9} />}
                    </span>
                    {option}
                  </span>
                  <span
                    className={
                      'poll-percent ' + (p.voted !== null ? 'visible' : '')
                    }
                  >
                    {percent}%
                  </span>
                </button>
              );
            })}
            <span className="meta poll-meta">
              {total} голосов ·{' '}
              {p.voted !== null
                ? 'можно изменить выбор'
                : 'один вариант ответа'}
            </span>
          </fieldset>
        )}
        <div className="post-actions">
          <button
            aria-label={p.liked ? 'Убрать лайк' : 'Поставить лайк'}
            aria-pressed={!!p.liked}
            className={p.liked ? 'liked' : ''}
            disabled={busy || pending}
            onClick={() => void act('like', !p.liked)}
          >
            <span className="heart-wrap">
              <Heart
                className={bump === 'like' ? 'heart-pop' : ''}
                size={18}
                fill={p.liked ? 'currentColor' : 'none'}
              />
              {bump === 'like' && !!p.liked && (
                <span className="like-sparks" aria-hidden="true">
                  {[
                    [-14, -12],
                    [0, -18],
                    [14, -12],
                    [-13, 10],
                    [0, 16],
                    [13, 10],
                  ].map(([x, y], i) => (
                    <i
                      key={i}
                      style={
                        {
                          '--dx': x + 'px',
                          '--dy': y + 'px',
                          animationDelay: i * 14 + 'ms',
                        } as CSSProperties
                      }
                    />
                  ))}
                </span>
              )}
            </span>
            <span className={bump === 'like' ? 'number-pop' : ''}>
              {p.likes}
            </span>
          </button>
          <button aria-label="Комментарии" onClick={() => onComments(p)}>
            <MessageCircle size={18} />
            <span key={p.comments} className="comment-count">
              {p.comments}
            </span>
          </button>
          <span className="grow" />
          <button
            aria-label={
              p.saved ? 'Убрать из сохранённого' : 'Сохранить публикацию'
            }
            aria-pressed={!!p.saved}
            disabled={busy || pending}
            onClick={() => void act('save', !p.saved)}
          >
            <Bookmark
              className={bump === 'save' ? 'icon-swap' : ''}
              size={17}
              fill={p.saved ? 'currentColor' : 'none'}
            />
          </button>
        </div>
        <div className="post-extras">
          <span
            className="post-views"
            title="Уникальные просмотры пользователей"
          >
            <Eye size={15} />
            {(p.views || 0).toLocaleString('ru-RU')}
          </span>
          <button
            className="support-post"
            disabled={mine || busy}
            onClick={() => onSupport(p)}
            title={mine ? 'Звёзды от читателей' : 'Поддержать автора'}
          >
            <StarsIcon size={19} />
            <b>{(p.stars || 0).toLocaleString('ru-RU')}</b>
            <span>{mine ? 'От читателей' : 'Поддержать'}</span>
          </button>
        </div>
      </div>
    </article>
  );
});
