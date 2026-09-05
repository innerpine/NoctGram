'use client';
/* Private media uses authenticated browser requests. Captions belong to user-supplied media; do not fabricate tracks. */
/* eslint-disable next/no-img-element, jsx-a11y/media-has-caption */
import {
  Heart,
  MessageCircle,
  Bookmark,
  Trash2,
  Check,
  Moon,
} from 'lucide-react';
import type { Person, Post, Media } from '@/lib/client';
import type { ReactNode } from 'react';
export function Avatar({
  person,
  size = 38,
}: {
  person: Pick<Person, 'name' | 'avatar'>;
  size?: number;
}) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size / 2.8 }}
    >
      {person.avatar ? (
        <img src={person.avatar} alt="" />
      ) : person.name === 'Noctgram' ? (
        <Moon size={size * 0.5} />
      ) : (
        person.name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export function Stamp({ time }: { time: number }) {
  return (
    <time className="meta" dateTime={new Date(time).toISOString()}>
      {new Date(time).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}
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
export function PostCard({
  p,
  me,
  busy,
  onProfile,
  onAction,
  onComments,
  onDelete,
  onMedia,
}: {
  p: Post;
  me?: string;
  busy: boolean;
  onProfile: (id: string) => void;
  onAction: (p: Post, kind: string, value: unknown) => void;
  onComments: (p: Post) => void;
  onDelete: (id: string) => void;
  onMedia: (m: Media) => void;
}) {
  const total = p.votes.reduce((n, v) => n + v.count, 0);
  return (
    <article className="post">
      <div className="post-avatar">
        <button
          onClick={() => onProfile(p.userId)}
          aria-label={'Профиль ' + p.name}
        >
          <Avatar person={p} />
        </button>
      </div>
      <div className="post-content">
        <div className="post-author">
          <button className="author-button" onClick={() => onProfile(p.userId)}>
            {p.name}
            {p.userId === 'noctgram' && (
              <span className="verified">
                <Check size={10} />
              </span>
            )}
          </button>
          <span className="meta handle">@{p.handle}</span>
          <span className="grow" />
          {p.userId === me ? (
            <button
              className="icon-button"
              aria-label="Удалить публикацию"
              onClick={() => onDelete(p.id)}
            >
              <Trash2 size={14} />
            </button>
          ) : (
            <span className="more-mark">···</span>
          )}
        </div>
        <Stamp time={p.created} />
        <p className="post-text">{p.text}</p>
        {p.media.length > 0 && (
          <div
            className={'media-grid ' + (p.media.length === 1 ? 'single' : '')}
          >
            {p.media.map((m) =>
              m.type.startsWith('image/') ? (
                <button
                  key={m.id}
                  onClick={() => onMedia(m)}
                  aria-label={'Открыть ' + m.name}
                >
                  <img src={'/api/media/' + m.id} alt={m.name} loading="lazy" />
                </button>
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
        )}
        {p.poll.length > 0 && (
          <div className="poll">
            {p.poll.map((option, i) => {
              const count = p.votes.find((v) => v.option === i)?.count || 0;
              const percent = total ? Math.round((count / total) * 100) : 0;
              return (
                <button
                  key={i}
                  disabled={busy}
                  className={p.voted === i ? 'voted' : ''}
                  onClick={() => onAction(p, 'vote', i)}
                >
                  <span
                    className="poll-fill"
                    style={{ width: p.voted !== null ? percent + '%' : '0%' }}
                  />
                  <span className="poll-label">
                    {p.voted === i ? (
                      <Check size={15} />
                    ) : (
                      <span className="radio-dot" />
                    )}
                    {option}
                  </span>
                  {p.voted !== null && <span>{percent}%</span>}
                </button>
              );
            })}
            <span className="meta">
              {total} голосов ·{' '}
              {p.voted !== null
                ? 'можно изменить выбор'
                : 'один вариант ответа'}
            </span>
          </div>
        )}
        <div className="post-actions">
          <button
            aria-label={p.liked ? 'Убрать лайк' : 'Поставить лайк'}
            aria-pressed={!!p.liked}
            className={p.liked ? 'liked' : ''}
            disabled={busy}
            onClick={() => onAction(p, 'like', !p.liked)}
          >
            <Heart size={18} fill={p.liked ? 'currentColor' : 'none'} />
            {p.likes}
          </button>
          <button aria-label="Комментарии" onClick={() => onComments(p)}>
            <MessageCircle size={18} />
            {p.comments}
          </button>
          <span className="grow" />
          <button
            aria-label={
              p.saved ? 'Убрать из сохранённого' : 'Сохранить публикацию'
            }
            aria-pressed={!!p.saved}
            disabled={busy}
            onClick={() => onAction(p, 'save', !p.saved)}
          >
            <Bookmark size={17} fill={p.saved ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    </article>
  );
}
