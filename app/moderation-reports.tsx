'use client';
/* eslint-disable react/react-compiler */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ExternalLink, ShieldCheck } from 'lucide-react';
import { request } from '@/lib/client';
import { accountDate } from './account-states';
import { ContentDecisionForm } from './content-decision-form';
type Status = 'new' | 'reviewing' | 'closed';
type Report = {
  id: string;
  targetType: 'post' | 'comment' | 'message' | 'story';
  targetId: string;
  postId: string;
  authorId: string;
  name: string;
  kind: string;
  handle: string | null;
  reporterHandle: string | null;
  reviewerHandle: string | null;
  text: string;
  reason: string;
  status: Status;
  reviewNote: string;
  created: number;
  available: number;
};
type Removal = {
  id: string;
  targetType: string;
  handle: string | null;
  moderatorHandle: string | null;
  text: string;
  reason: string;
  created: number;
};
const labels = {
  all: 'Все',
  new: 'Новые',
  reviewing: 'Рассматриваются',
  closed: 'Закрытые',
};
const states = {
  new: 'Новая',
  reviewing: 'Рассматривается',
  closed: 'Закрыта',
};
const accountLabel = (handle: string | null) =>
  handle ? '@' + handle : 'Удалённый аккаунт';
export function ModerationReports({
  onChanged,
  onAuthor,
}: {
  onChanged: () => void;
  onAuthor: (id: string, handle: string) => void;
}) {
  const [filter, setFilter] = useState<keyof typeof labels>('new'),
    [rows, setRows] = useState<Report[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [more, setMore] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [removing, setRemoving] = useState<Report | null>(null);
  const generation = useRef(0),
    cursor = useRef<Report | null>(null),
    lock = useRef(false);
  const load = useCallback(
    async (append = false) => {
      const gen = ++generation.current;
      setLoading(true);
      setError('');
      const q = new URLSearchParams({
        action: 'moderationReports',
        status: filter,
      });
      if (append && cursor.current) {
        q.set('before', String(cursor.current.created));
        q.set('beforeId', cursor.current.id);
      }
      try {
        const next = await request<Report[]>('?' + q);
        if (gen !== generation.current) return;
        cursor.current = next.at(-1) || null;
        setMore(next.length === 50);
        setRows((old) =>
          append
            ? [...old, ...next.filter((r) => !old.some((o) => o.id === r.id))]
            : next,
        );
      } catch (e) {
        if (gen === generation.current) setError((e as Error).message);
      } finally {
        if (gen === generation.current) setLoading(false);
      }
    },
    [filter],
  );
  useEffect(() => {
    setRows([]);
    setRemoving(null);
    void load();
    return () => {
      // This counter invalidates requests; it is not a rendered element ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [load]);
  const review = async (r: Report, status: Status) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('', {
        action: 'reviewReport',
        id: r.id,
        expectedStatus: r.status,
        status,
        note: notes[r.id] || '',
      });
      setNotice('Статус жалобы обновлён');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="moderation-queue">
      <div className="moderation-filters" aria-label="Статус жалоб">
        {Object.entries(labels).map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? 'is-active' : ''}
            aria-pressed={filter === value}
            disabled={busy || !!removing}
            onClick={() => {
              setFilter(value as keyof typeof labels);
              setNotice('');
            }}
          >
            {label}
          </button>
        ))}
        <button
          className="icon-button"
          aria-label="Обновить жалобы"
          disabled={loading || busy || !!removing}
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {notice && <output className="moderation-notice">{notice}</output>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {rows.map((r) => (
        <article key={r.id}>
          <div className="moderation-editor-title">
            <strong>
              {accountLabel(r.handle)} ·{' '}
              {r.targetType === 'story'
                ? 'История'
                : r.targetType === 'message'
                  ? 'Личное сообщение'
                  : r.targetType === 'comment'
                    ? 'Комментарий'
                    : r.kind === 'channel'
                      ? 'Пост канала'
                      : 'Пост'}
            </strong>
            <span className={'report-status report-status--' + r.status}>
              {states[r.status]}
            </span>
          </div>
          <p className="moderation-evidence">
            {r.text || 'Публикация с медиа или кодом'}
          </p>
          <p className="meta">Жалоба: {r.reason}</p>
          <small>
            {r.reporterHandle
              ? 'От @' + r.reporterHandle
              : 'От удалённого аккаунта'}{' '}
            · {accountDate(r.created)}
          </small>
          {!r.available && (
            <p className="account-note">
              Контент недоступен. Сохранён текст на момент жалобы.
            </p>
          )}
          <div className="account-actions">
            <button
              className="secondary"
              disabled={busy || !!removing || !r.handle}
              onClick={() => {
                if (r.handle) onAuthor(r.authorId, r.handle);
              }}
            >
              Найти автора
            </button>
            {!!r.available &&
              r.targetType !== 'message' &&
              r.targetType !== 'story' && (
                <a
                  className="secondary"
                  href={'/?post=' + encodeURIComponent(r.postId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} />
                  Открыть пост
                </a>
              )}
            {!!r.available && r.targetType !== 'message' && !removing && (
              <button
                className="danger"
                disabled={busy}
                onClick={() => setRemoving(r)}
              >
                Удалить{' '}
                {r.targetType === 'post'
                  ? 'пост'
                  : r.targetType === 'story'
                    ? 'историю'
                    : 'комментарий'}
              </button>
            )}
          </div>
          {removing?.id === r.id ? (
            <ContentDecisionForm
              key={r.id}
              id={r.targetId}
              type={r.targetType}
              action="remove"
              text={r.text}
              onCancel={() => setRemoving(null)}
              onDone={() => {
                setRemoving(null);
                setNotice('Контент удалён. Связанные открытые жалобы закрыты.');
                void load();
                onChanged();
              }}
            />
          ) : (
            <>
              {r.status !== 'closed' && (
                <label>
                  Комментарий к решению
                  <textarea
                    rows={2}
                    maxLength={1000}
                    disabled={busy || !!removing}
                    value={notes[r.id] || ''}
                    onChange={(e) =>
                      setNotes((old) => ({ ...old, [r.id]: e.target.value }))
                    }
                    placeholder="Обязателен при закрытии жалобы"
                  />
                </label>
              )}
              <div className="account-actions">
                {r.status === 'new' && (
                  <button
                    className="secondary"
                    disabled={busy || !!removing}
                    onClick={() => void review(r, 'reviewing')}
                  >
                    Взять на рассмотрение
                  </button>
                )}
                {r.status !== 'closed' ? (
                  <button
                    className="primary"
                    disabled={busy || !!removing || !notes[r.id]?.trim()}
                    onClick={() => void review(r, 'closed')}
                  >
                    Закрыть жалобу
                  </button>
                ) : (
                  <button
                    className="secondary"
                    disabled={busy || !!removing}
                    onClick={() => void review(r, 'new')}
                  >
                    Открыть заново
                  </button>
                )}
              </div>
              {r.reviewNote && (
                <p className="account-note">
                  Решение: {r.reviewNote}
                  {r.reviewerHandle ? ' · @' + r.reviewerHandle : ''}
                </p>
              )}
            </>
          )}
        </article>
      ))}
      {loading && <p className="connections-status">Загружаем жалобы…</p>}
      {!loading && !error && !rows.length && (
        <p className="moderation-empty">В этом статусе жалоб пока нет.</p>
      )}
      {more && (
        <button
          className="secondary load-more"
          disabled={loading || busy || !!removing}
          onClick={() => void load(true)}
        >
          Показать ещё
        </button>
      )}
    </div>
  );
}
export function RemovalHistory() {
  const [rows, setRows] = useState<Removal[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [more, setMore] = useState(false);
  const cursor = useRef<Removal | null>(null),
    generation = useRef(0);
  const load = useCallback(async (append = false) => {
    const gen = ++generation.current;
    setLoading(true);
    setError('');
    const q = new URLSearchParams({ action: 'moderationRemovals' });
    if (append && cursor.current) {
      q.set('before', String(cursor.current.created));
      q.set('beforeId', cursor.current.id);
    }
    try {
      const next = await request<Removal[]>('?' + q);
      if (gen !== generation.current) return;
      cursor.current = next.at(-1) || null;
      setMore(next.length === 50);
      setRows((old) => (append ? [...old, ...next] : next));
    } catch (e) {
      if (gen === generation.current) setError((e as Error).message);
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      // This counter invalidates requests; it is not a rendered element ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [load]);
  return (
    <div className="moderation-queue">
      <button
        className="secondary"
        disabled={loading}
        onClick={() => void load()}
      >
        <RefreshCw size={14} />
        Обновить историю
      </button>
      {rows.map((r) => (
        <article key={r.id}>
          <strong>
            <ShieldCheck size={15} />
            <span>
              {r.targetType === 'post'
                ? 'Пост'
                : r.targetType === 'story'
                  ? 'История'
                  : 'Комментарий'}{' '}
              · {accountLabel(r.handle)} ·{' '}
              {r.targetType === 'story' ? 'удалена' : 'удалён'}
            </span>
          </strong>
          <p className="moderation-evidence">
            {r.text || 'Публикация с медиа или кодом'}
          </p>
          <p>Причина: {r.reason}</p>
          <small>
            {accountLabel(r.moderatorHandle)} · {accountDate(r.created)}
          </small>
        </article>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="connections-status">Загружаем…</p>}
      {!loading && !error && !rows.length && (
        <p className="moderation-empty">Удалений модератором пока нет.</p>
      )}
      {more && (
        <button
          className="secondary load-more"
          disabled={loading}
          onClick={() => void load(true)}
        >
          Показать ещё
        </button>
      )}
    </div>
  );
}
