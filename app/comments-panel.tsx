'use client';
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
} from 'lucide-react';
import { Avatar, Empty, Stamp } from './post-card';
import { ContentDecisionForm } from './content-decision-form';
import { request, type Comment, type Post, type Profile } from '@/lib/client';
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
    [deleting, setDeleting] = useState('');
  const [decision, setDecision] = useState<{
      comment: Comment;
      action: 'remove' | 'report';
    } | null>(null),
    [notice, setNotice] = useState('');
  const live = useRef(false),
    generation = useRef(0),
    lock = useRef(false),
    end = useRef<HTMLDivElement>(null),
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
      const row = await request<Comment>('', {
        action: 'comment',
        id: post.id,
        text,
      });
      onChanged();
      if (live.current) {
        setText('');
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
      if (live.current) setComments((rows) => rows.filter((c) => c.id !== id));
      onChanged();
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setDeleting('');
    }
  };
  return (
    <div className="comments-panel">
      <div className="comment-context">
        <Avatar person={post} size={32} />
        <div>
          <strong>{post.name}</strong>
          <p>{post.text}</p>
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
          <article key={c.id} className="comment">
            <Avatar person={c} size={32} />
            <div>
              <div className="row">
                <strong>{c.name}</strong>
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
              <p>{c.text}</p>
              {c.userId !== me.id && !readOnly && (
                <div className="comment-moderation-actions">
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
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Avatar person={me} size={34} />
        <div className="comment-input">
          <textarea
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
              {text.length
                ? `${text.length} / 2000`
                : 'Ctrl + Enter · отправить'}
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
