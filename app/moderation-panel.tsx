'use client';
import { AdministrationPanel } from './administration-panel';
import { DisplayName } from './profile-identity';
/* eslint-disable react/react-compiler */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, ShieldCheck, X, RefreshCw } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Avatar } from './post-card';
import { ModerationReports, RemovalHistory } from './moderation-reports';
import { accountDate } from './account-states';
import { request, type Person } from '@/lib/client';
type ModPerson = Person & {
  mode: string | null;
  reason: string | null;
  expiresAt: number | null;
  restrictedAt: number | null;
  moderator: number;
  canRestrict: boolean;
  ownerName: string | null;
  ownerHandle: string | null;
};
type Appeal = {
  id: string;
  userId: string;
  handle: string;
  name: string;
  text: string;
  reason: string;
  mode: string;
  status: string;
  reviewNote: string;
  created: number;
};
type History = {
  id: string;
  mode: string;
  reason: string;
  created: number;
  moderatorHandle: string;
};
const modes = [
  { value: 'read_only', label: 'Только чтение' },
  { value: 'blocked', label: 'Блокировка' },
  { value: 'active', label: 'Снять ограничение' },
];
const durations = [
  { value: '60', label: '1 час' },
  { value: '1440', label: '1 день' },
  { value: '10080', label: '7 дней' },
  { value: '43200', label: '30 дней' },
  { value: 'forever', label: 'Бессрочно' },
];
function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="moderation-choice">
      <span>{label}</span>
      <Select
        value={value}
        onValueChange={(v) => onChange(String(v))}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue>
            {options.find((o) => o.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export function ModerationPanel({
  onChanged,
  canAdmin = false,
}: {
  onChanged: () => void;
  canAdmin?: boolean;
}) {
  const [tab, setTab] = useState('users'),
    [query, setQuery] = useState(''),
    [targetId, setTargetId] = useState<string | null>(null),
    [people, setPeople] = useState<ModPerson[]>([]),
    [appeals, setAppeals] = useState<Appeal[]>([]),
    [selected, setSelected] = useState<ModPerson | null>(null),
    [history, setHistory] = useState<History[]>([]),
    [mode, setMode] = useState('read_only'),
    [duration, setDuration] = useState('1440'),
    [reason, setReason] = useState(''),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [hasMore, setHasMore] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const cursor = useRef<string | null>(null),
    generation = useRef(0),
    live = useRef(false),
    lock = useRef(false);
  const load = useCallback(
    async (append = false) => {
      const gen = ++generation.current;
      setLoading(true);
      setError('');
      try {
        if (tab === 'users') {
          const q = new URLSearchParams({
            action: 'moderationUsers',
            q: query,
          });
          if (targetId) q.set('id', targetId);
          if (append && cursor.current) q.set('after', cursor.current);
          const page = await request<{
            people: ModPerson[];
            hasMore: boolean;
            nextCursor: string | null;
          }>('?' + q);
          if (!live.current || gen !== generation.current) return;
          cursor.current = page.nextCursor;
          setHasMore(page.hasMore);
          if (targetId) {
            setSelected(page.people[0] || null);
            if (!page.people.length) setError('Автор больше не существует.');
          }
          setPeople((old) =>
            append
              ? [
                  ...old,
                  ...page.people.filter((p) => !old.some((x) => x.id === p.id)),
                ]
              : page.people,
          );
        } else if (tab === 'appeals') {
          const rows = await request<Appeal[]>('?action=moderationAppeals');
          if (live.current && gen === generation.current) setAppeals(rows);
        }
      } catch (e) {
        if (live.current && gen === generation.current)
          setError((e as Error).message);
      } finally {
        if (live.current && gen === generation.current) setLoading(false);
      }
    },
    [tab, query, targetId],
  );
  useEffect(() => {
    live.current = true;
    generation.current++;
    setPeople([]);
    setHasMore(false);
    setLoading(true);
    const timer = setTimeout(() => void load(), query && !targetId ? 200 : 0);
    return () => {
      live.current = false;
      clearTimeout(timer);
    };
  }, [load, query, targetId]);
  useEffect(() => {
    let active = true;
    setHistory([]);
    if (selected)
      void request<History[]>(
        '?action=moderationHistory&id=' + encodeURIComponent(selected.id),
      )
        .then((rows) => {
          if (active) setHistory(rows);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected]);
  const openAccount = (id: string, handle: string) => {
    setTab('users');
    setSelected(null);
    setTargetId(id);
    setQuery(handle);
    setMode('read_only');
    setReason('');
    setDuration('1440');
    setNotice('');
  };
  const mutate = async (body: unknown) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('', body);
      setSelected(null);
      setReason('');
      setNotice('Решение сохранено');
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="moderation-panel">
      <div className="moderation-heading">
        <ShieldCheck size={20} />
        <p>Ограничения аккаунтов, обращения и жалобы.</p>
        <button
          className="icon-button"
          aria-label="Обновить кабинет модератора"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(String(v));
          setSelected(null);
          setTargetId(null);
          setNotice('');
        }}
      >
        <TabsList>
          <TabsTrigger value="users">Аккаунты</TabsTrigger>
          <TabsTrigger value="appeals">Обращения</TabsTrigger>
          <TabsTrigger value="reports">Жалобы</TabsTrigger>
          <TabsTrigger value="removals">Удаления</TabsTrigger>
          {canAdmin && <TabsTrigger value="admin">Управление</TabsTrigger>}
        </TabsList>
      </Tabs>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="moderation-notice">{notice}</output>}
      {tab === 'admin' && canAdmin && (
        <AdministrationPanel onChanged={onChanged} />
      )}
      {tab === 'users' && (
        <>
          <div className="searchbox">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setTargetId(null);
                setSelected(null);
                setNotice('');
              }}
              placeholder="Имя, @юзернейм или канал"
              aria-label="Найти аккаунт для модерации"
            />
          </div>
          {selected && (
            <form
              className="moderation-editor"
              onSubmit={(e) => {
                e.preventDefault();
                if (!selected.canRestrict) return;
                void mutate({
                  action: 'moderate',
                  id: selected.id,
                  mode,
                  reason,
                  minutes: duration === 'forever' ? null : Number(duration),
                });
              }}
            >
              <div className="moderation-editor-title">
                <strong>@{selected.handle}</strong>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Закрыть редактирование ограничения"
                  disabled={busy}
                  onClick={() => setSelected(null)}
                >
                  <X size={17} />
                </button>
              </div>
              {selected.kind === 'channel' ? (
                <>
                  <p className="meta">Канал · {selected.name}</p>
                  <p className="account-note">
                    Решение применяется только к этому каналу. Только чтение
                    запрещает публикацию и редактирование; блокировка также
                    скрывает канал и его посты.
                  </p>
                  {selected.ownerId && selected.ownerHandle && (
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        openAccount(selected.ownerId!, selected.ownerHandle!)
                      }
                    >
                      Открыть владельца · @{selected.ownerHandle}
                    </button>
                  )}
                </>
              ) : !selected.canRestrict ? (
                <p className="account-note">
                  {selected.moderator
                    ? 'Аккаунт модератора защищён от ограничений.'
                    : 'Служебный аккаунт Noctgram защищён от ограничений.'}
                </p>
              ) : null}
              {selected.mode && (
                <p className="meta">
                  Сейчас:{' '}
                  {selected.mode === 'blocked' ? 'блокировка' : 'только чтение'}
                  {selected.expiresAt
                    ? ' до ' + accountDate(selected.expiresAt)
                    : ', бессрочно'}
                  . {selected.reason}
                </p>
              )}
              {selected.canRestrict && (
                <>
                  <Choice
                    label="Действие"
                    value={mode}
                    options={modes}
                    onChange={setMode}
                    disabled={busy}
                  />
                  {mode !== 'active' && (
                    <Choice
                      label="Срок"
                      value={duration}
                      options={durations}
                      onChange={setDuration}
                      disabled={busy}
                    />
                  )}
                  <label>
                    Причина решения
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                      maxLength={500}
                      rows={3}
                      disabled={busy}
                    />
                  </label>
                  <p className="account-note">
                    Причину видит владелец аккаунта. Решение сохраняется в
                    истории.
                  </p>
                  <button
                    className={
                      mode === 'blocked'
                        ? 'danger moderation-submit'
                        : 'primary'
                    }
                    disabled={busy || !reason.trim()}
                  >
                    {busy
                      ? 'Сохраняем…'
                      : mode === 'active'
                        ? 'Снять ограничение'
                        : mode === 'blocked'
                          ? selected.kind === 'channel'
                            ? 'Заблокировать канал'
                            : 'Заблокировать аккаунт'
                          : 'Включить только чтение'}
                  </button>
                </>
              )}
              {history.length > 0 && (
                <details className="moderation-history">
                  <summary>История решений · {history.length}</summary>
                  {history.map((h) => (
                    <div key={h.id}>
                      <strong>
                        {h.mode === 'active'
                          ? 'Ограничение снято'
                          : h.mode === 'blocked'
                            ? 'Блокировка'
                            : 'Только чтение'}
                      </strong>
                      <p>{h.reason}</p>
                      <small>
                        {accountDate(h.created)} · @{h.moderatorHandle}
                      </small>
                    </div>
                  ))}
                </details>
              )}
            </form>
          )}
          <div className="moderation-users">
            {people.map((p) => (
              <button
                key={p.id}
                className="moderation-user"
                disabled={busy}
                onClick={() => {
                  setSelected(p);
                  setMode(p.mode || 'read_only');
                  setReason('');
                  setDuration('1440');
                  setNotice('');
                }}
              >
                <Avatar person={p} size={40} />
                <span>
                  <strong>
                    <DisplayName person={p} />
                  </strong>
                  <small>
                    @{p.handle}
                    {p.kind === 'channel' ? ' · Канал' : ''}
                  </small>
                </span>
                <em>
                  {p.moderator
                    ? 'Модератор'
                    : p.id === 'noctgram'
                      ? 'Служебный'
                      : p.mode === 'blocked'
                        ? 'Заблокирован'
                        : p.mode === 'read_only'
                          ? 'Только чтение'
                          : 'Активен'}
                </em>
              </button>
            ))}
          </div>
          {hasMore && (
            <button
              className="secondary load-more"
              disabled={loading || busy}
              onClick={() => void load(true)}
            >
              Показать ещё
            </button>
          )}
          {!loading && !people.length && (
            <p className="moderation-empty">Аккаунты не найдены.</p>
          )}
        </>
      )}
      {tab === 'appeals' && (
        <div className="moderation-queue">
          {appeals.map((a) => (
            <article key={a.id}>
              <div className="moderation-editor-title">
                <strong>@{a.handle}</strong>
                <span className="meta">
                  {a.status === 'pending' ? 'Ожидает решения' : 'Рассмотрено'}
                </span>
              </div>
              <p className="meta">
                {a.mode === 'blocked' ? 'Блокировка' : 'Только чтение'} ·{' '}
                {a.reason}
              </p>
              <p>{a.text}</p>
              <small>{accountDate(a.created)}</small>
              {a.status === 'pending' ? (
                <>
                  <label>
                    Ответ пользователю
                    <textarea
                      value={notes[a.id] || ''}
                      maxLength={1000}
                      rows={2}
                      disabled={busy}
                      onChange={(e) =>
                        setNotes((old) => ({ ...old, [a.id]: e.target.value }))
                      }
                    />
                  </label>
                  <div className="account-actions">
                    <button
                      className="primary"
                      disabled={busy || !notes[a.id]?.trim()}
                      onClick={() =>
                        void mutate({
                          action: 'reviewAppeal',
                          id: a.id,
                          decision: 'accepted',
                          note: notes[a.id],
                        })
                      }
                    >
                      Принять обращение
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || !notes[a.id]?.trim()}
                      onClick={() =>
                        void mutate({
                          action: 'reviewAppeal',
                          id: a.id,
                          decision: 'dismissed',
                          note: notes[a.id],
                        })
                      }
                    >
                      Оставить ограничение
                    </button>
                  </div>
                  <p className="account-note">
                    Принятие снимает оспариваемое ограничение. Если было выдано
                    новое, оно останется в силе.
                  </p>
                </>
              ) : (
                <p className="meta">{a.reviewNote}</p>
              )}
            </article>
          ))}
          {!loading && !appeals.length && (
            <p className="moderation-empty">Обращений пока нет.</p>
          )}
        </div>
      )}
      {tab === 'reports' && (
        <ModerationReports onChanged={onChanged} onAuthor={openAccount} />
      )}
      {tab === 'removals' && <RemovalHistory />}
      {loading && <output className="connections-status">Загружаем…</output>}
    </section>
  );
}
