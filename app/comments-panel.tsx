'use client';
import { EmojiPicker, EmojiPreview } from './premium-emoji';
import { DisplayName } from './profile-identity';
import { ProfileLink, MentionText } from './profile-link';
/* The subscription starts an asynchronous request and updates its loading state. */
/* eslint-disable react/react-compiler */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MessageCircle,
  Send,
  Trash2,
  LoaderCircle,
  RefreshCw,
  Flag,
  ShieldCheck,
  Reply,
  X,
} from 'lucide-react';
import { Avatar, Empty, Stamp } from './post-card';
import { ContentDecisionForm } from './content-decision-form';
import { request, type Comment, type Post, type Profile } from '@/lib/client';
import type { QueuedSubmission } from '@/lib/antispam-types';
export function CommentsPanel({
  post,
  me,
  onChanged,
  readOnly = false,
}: {
  post: Post;
  me: Profile;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]),
    [text, setText] = useState(''),
    [loading, setLoading] = useState(true),
    [sending, setSending] = useState(false),
    [more, setMore] = useState(false),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState(''),
    // The comment being answered, and the one just jumped to from a quote.
    [replying, setReplying] = useState<Comment | null>(null),
    [glow, setGlow] = useState('');
  const [decision, setDecision] = useState<{
      comment: Comment;
      action: 'remove' | 'report';
    } | null>(null),
    [notice, setNotice] = useState('');
  const live = useRef(false),
    generation = useRef(0),
    lock = useRef(false),
    end = useRef<HTMLDivElement>(null),
    field = useRef<HTMLTextAreaElement>(null),
    cursor = useRef<Comment | null>(null);
  const load = useCallback(
    async (append = false) => {
      const gen = ++generation.current;
      setLoading(true);
      setError('');
      try {
        const q = new URLSearchParams({ action: 'comments', post: post.id });
        if (append && cursor.current) {
          q.set('before', String(cursor.current.created));
          q.set('beforeId', cursor.current.id);
        }
        const rows = await request<Comment[]>('?' + q);
        if (live.current && gen === generation.current) {
          cursor.current = rows[0] || (append ? cursor.current : null);
          setMore(rows.length === 50);
          if (!append)
            setDecision((current) =>
              current && rows.some((r) => r.id === current.comment.id)
                ? current
                : null,
            );
          setComments((old) =>
            append
              ? [
                  ...old,
                  ...rows.filter((c) => !old.some((x) => x.id === c.id)),
                ].sort(
                  (a, b) => a.created - b.created || a.id.localeCompare(b.id),
                )
              : rows,
          );
        }
      } catch (e) {
        if (live.current) setError((e as Error).message);
      } finally {
        if (live.current && gen === generation.current) setLoading(false);
      }
    },
    [post.id],
  );
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);
  const submit = async () => {
    if (readOnly || lock.current || loading || deleting || !text.trim()) return;
    lock.current = true;
    setSending(true);
    setError('');
    try {
      const row = await request<Comment | QueuedSubmission>('', {
        action: 'comment',
        id: post.id,
        text,
        ...(replying ? { replyTo: replying.id } : {}),
      });
      if ('queued' in row) {
        if (live.current) {
          setText('');
          setReplying(null);
          setNotice(row.notice);
        }
        return;
      }
      onChanged();
      if (live.current) {
        setText('');
        setReplying(null);
        setComments((old) =>
          old.some((c) => c.id === row.id) ? old : [...old, row],
        );
        setTimeout(
          () =>
            end.current?.scrollIntoView({
              block: 'nearest',
              behavior: 'smooth',
            }),
          0,
        );
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setSending(false);
      lock.current = false;
    }
  };
  const remove = async (id: string) => {
    if (readOnly || deleting || loading || sending) return;
    setDeleting(id);
    try {
      await request('', { action: 'deleteComment', id });
      if (live.current) {
        setComments((rows) => rows.filter((c) => c.id !== id));
        setReplying((current) => (current?.id === id ? null : current));
      }
      onChanged();
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setDeleting('');
    }
  };
  const reply = (comment: Comment) => {
    setReplying(comment);
    requestAnimationFrame(() => field.current?.focus());
  };
  // A quote leads to the comment it answers, if that one is loaded.
  const jump = (id: string) => {
    const target = document.getElementById('comment-' + id);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setGlow(id);
    setTimeout(
      () => setGlow((current) => (current === id ? '' : current)),
      1600,
    );
  };
  return (
    <div className="comments-panel">
      <div className="comment-context">
        <ProfileLink
          target={{ id: post.userId }}
          aria-label={'Профиль ' + post.name}
        >
          <Avatar person={post} size={32} />
        </ProfileLink>
        <div>
          <strong>
            <ProfileLink target={{ id: post.userId }}>
              <DisplayName person={post} />
            </ProfileLink>
          </strong>
          <p>
            <MentionText text={post.text} />
          </p>
        </div>
      </div>
      <div className="comments-heading">
        <MessageCircle size={16} />
        <span>Обсуждение</span>
        <span className="grow" />
        <button
          className="icon-button"
          aria-label="Обновить комментарии"
          disabled={loading || sending || !!deleting || !!decision}
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="comment-list">
        {more && (
          <button
            className="secondary load-more"
            disabled={loading || sending || !!deleting || !!decision}
            onClick={() => void load(true)}
          >
            {loading ? 'Загрузка…' : 'Предыдущие комментарии'}
          </button>
        )}
        {comments.map((c) => (
          <article
            key={c.id}
            id={'comment-' + c.id}
            className="comment"
            data-glow={glow === c.id || undefined}
          >
            <ProfileLink
              target={{ id: c.userId }}
              aria-label={'Профиль ' + c.name}
            >
              <Avatar person={c} size={32} />
            </ProfileLink>
            <div>
              <div className="row">
                <strong>
                  <ProfileLink target={{ id: c.userId }}>
                    <DisplayName person={c} />
                  </ProfileLink>
                </strong>
                <span className="grow" />
                <Stamp time={c.created} compact />
                {c.userId === me.id && !readOnly && (
                  <button
                    className="icon-button"
                    aria-label="Удалить свой комментарий"
                    disabled={!!deleting || loading || sending}
                    onClick={() => void remove(c.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {c.replyTo && (
                <button
                  type="button"
                  className="comment-reply-quote"
                  disabled={!c.replyUserId}
                  onClick={() => jump(c.replyTo!)}
                >
                  <strong>
                    {c.replyUserId ? c.replyName : 'Комментарий удалён'}
                  </strong>
                  {c.replyUserId && <span>{c.replyText}</span>}
                </button>
              )}
              <p>
                <MentionText text={c.text} />
              </p>
              {!readOnly && (
                <div className="comment-moderation-actions">
                  <button
                    className="text-button"
                    disabled={sending || !!deleting}
                    onClick={() => reply(c)}
                  >
                    <Reply size={12} />
                    Ответить
                  </button>
                  {c.userId !== me.id && (
                    <>
                      <button
                        className="text-button"
                        disabled={!!decision || !!deleting || sending}
                        onClick={() => {
                          setNotice('');
                          setDecision({ comment: c, action: 'report' });
                        }}
                      >
                        <Flag size={12} />
                        Пожаловаться
                      </button>
                      {me.canModerate && (
                        <button
                          className="text-button"
                          disabled={!!decision || !!deleting || sending}
                          onClick={() => {
                            setNotice('');
                            setDecision({ comment: c, action: 'remove' });
                          }}
                        >
                          <ShieldCheck size={12} />
                          Удалить как модератор
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {decision?.comment.id === c.id && (
                <ContentDecisionForm
                  key={c.id + decision.action}
                  id={c.id}
                  type="comment"
                  action={decision.action}
                  text={c.text}
                  onCancel={() => setDecision(null)}
                  onDone={() => {
                    if (decision.action === 'remove') {
                      setComments((old) => old.filter((r) => r.id !== c.id));
                      onChanged();
                    }
                    setNotice(
                      decision.action === 'remove'
                        ? 'Комментарий удалён. Решение сохранено.'
                        : 'Жалоба отправлена модератору.',
                    );
                    setDecision(null);
                  }}
                />
              )}
            </div>
          </article>
        ))}
        {loading && !comments.length ? (
          <div className="comment-loading">
            <LoaderCircle className="spin" size={20} />
            Загружаем комментарии…
          </div>
        ) : (
          !comments.length &&
          !error && (
            <Empty>
              <strong>Пока без комментариев</strong>
              <p>Поделись мыслью первым.</p>
            </Empty>
          )
        )}
        <div ref={end} />
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
          <button
            disabled={loading || sending || !!deleting}
            onClick={() => void load()}
          >
            Обновить
          </button>
        </div>
      )}
      {notice && <output className="moderation-notice">{notice}</output>}
      <EmojiPreview text={text} />
      {replying && (
        <div className="comment-reply-bar">
          <Reply size={15} />
          <div>
            <strong>Ответ {replying.name}</strong>
            <span>{replying.text}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Отменить ответ"
            disabled={sending}
            onClick={() => setReplying(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Avatar person={me} size={34} />
        <div className="comment-input">
          <EmojiPicker
            premium={!!me.premium}
            text={text}
            onText={setText}
            disabled={sending || readOnly}
          />
          <textarea
            ref={field}
            aria-label="Комментарий"
            placeholder="Добавить мысль…"
            maxLength={2000}
            value={text}
            disabled={readOnly || sending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="row">
            <span className="meta">
              {text.length ? (
                `${text.length} / 2000`
              ) : (
                <span className="comment-shortcut-hint">
                  Ctrl + Enter · отправить
                </span>
              )}
            </span>
            <span className="grow" />
            <button
              className="primary"
              disabled={
                readOnly || sending || loading || !!deleting || !text.trim()
              }
              aria-label="Отправить комментарий"
            >
              {sending ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
