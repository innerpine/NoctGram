'use client';
import { EmojiPicker, EmojiPreview } from './premium-emoji';
import { DisplayName } from './profile-identity';
import { ProfileLink, MentionText } from './profile-link';
/* The subscription starts an asynchronous request and updates its loading state. */
/* eslint-disable react/react-compiler */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
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
import { commentThreads } from '@/lib/comment-threads';
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
    [reply, setReply] = useState<Comment | null>(null),
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
    list = useRef<HTMLDivElement>(null),
    commentElements = useRef(new Map<string, HTMLElement>()),
    scrollToComment = useRef<string | null>(null),
    cursor = useRef<Comment | null>(null),
    emojiField = useRef<HTMLTextAreaElement>(null);
  const threadedComments = useMemo(() => commentThreads(comments), [comments]);
  useEffect(() => {
    const id = scrollToComment.current;
    if (!id) return;
    scrollToComment.current = null;
    const container = list.current;
    const element = commentElements.current.get(id);
    if (!container || !element) return;
    const bounds = container.getBoundingClientRect();
    const target = element.getBoundingClientRect();
    const offset =
      target.height > container.clientHeight || target.top < bounds.top
        ? target.top - bounds.top
        : Math.max(0, target.bottom - bounds.bottom);
    if (offset)
      container.scrollTo({
        top: container.scrollTop + offset,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
  }, [comments]);
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
        replyTo: reply?.id ?? null,
      });
      onChanged();
      if (live.current) {
        setText('');
        setReply(null);
        scrollToComment.current = row.id;
        setComments((old) =>
          old.some((c) => c.id === row.id) ? old : [...old, row],
        );
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setSending(false);
      lock.current = false;
    }
  };
  const forgetComment = (id: string) => {
    setComments((rows) =>
      rows
        .filter((c) => c.id !== id)
        .map((c) =>
          c.reply?.id === id
            ? {
                ...c,
                reply: {
                  id,
                  userId: '',
                  name: '',
                  text: '',
                  unavailable: true,
                },
              }
            : c,
        ),
    );
    setReply((current) => (current?.id === id ? null : current));
  };
  const remove = async (id: string) => {
    if (readOnly || deleting || loading || sending) return;
    setDeleting(id);
    try {
      await request('', { action: 'deleteComment', id });
      if (live.current) forgetComment(id);
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
      <div className="comment-list" ref={list}>
        {more && (
          <button
            className="secondary load-more"
            disabled={loading || sending || !!deleting || !!decision}
            onClick={() => void load(true)}
          >
            {loading ? 'Загрузка…' : 'Предыдущие комментарии'}
          </button>
        )}
        {threadedComments.map(({ comment: c, depth }) => (
          <article
            key={c.id}
            className={depth ? 'comment comment-thread-reply' : 'comment'}
            style={{ '--comment-depth': Math.min(depth, 2) } as CSSProperties}
            ref={(element) => {
              if (element) commentElements.current.set(c.id, element);
              else commentElements.current.delete(c.id);
            }}
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
              {c.reply && (
                <div className="comment-quote">
                  <Reply size={14} aria-hidden="true" />
                  <div>
                    <strong>
                      {c.reply.unavailable
                        ? 'Комментарий недоступен'
                        : `Ответ · ${c.reply.name}`}
                    </strong>
                    {!c.reply.unavailable && <span>{c.reply.text}</span>}
                  </div>
                </div>
              )}
              <p>
                <MentionText text={c.text} />
              </p>
              {!readOnly && (
                <button
                  type="button"
                  className="comment-reply-action"
                  disabled={sending || !!deleting}
                  onClick={() => {
                    setReply(c);
                    emojiField.current?.focus();
                  }}
                >
                  Ответить
                </button>
              )}
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
                      forgetComment(c.id);
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
              <p>Комментариев пока нет.</p>
            </Empty>
          )
        )}
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
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Avatar person={me} size={34} />
        <div className="comment-input">
          {reply && (
            <output className="comment-quote comment-reply-draft">
              <Reply size={15} aria-hidden="true" />
              <span className="comment-quote-content">
                <strong>Ответ · {reply.name}</strong>
                <span>{reply.text}</span>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Отменить ответ"
                disabled={sending}
                onClick={() => setReply(null)}
              >
                <X size={16} />
              </button>
            </output>
          )}
          <EmojiPicker
            key={post.id}
            premium={!!me.premium}
            text={text}
            onText={setText}
            field={emojiField}
            disabled={sending || readOnly}
          />
          <textarea
            ref={emojiField}
            aria-label="Комментарий"
            placeholder="Написать комментарий…"
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
