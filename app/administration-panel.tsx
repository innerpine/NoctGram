'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import { Search, ShieldCheck, Gift, ChevronLeft } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { request, type Person } from '@/lib/client';
import { Avatar, DisplayName } from './profile-identity';
type AdminPerson = Person & {
  administrator: number;
  moderator: number;
  balance: number;
};
type Event = Person & {
  id: string;
  action: string;
  amount: number;
  reason: string;
  created: number;
  actorName: string;
};
const labels: Record<string, string> = {
  stars: 'Выдать Stars',
  premium: 'Выдать Premium',
  verified: 'Верификация',
  moderator: 'Роль модератора',
};
export function AdministrationPanel({ onChanged }: { onChanged: () => void }) {
  const [query, setQuery] = useState(''),
    [people, setPeople] = useState<AdminPerson[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [selected, setSelected] = useState<AdminPerson | null>(null);
  const [kind, setKind] = useState('stars'),
    [amount, setAmount] = useState('1000'),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [version, setVersion] = useState(0),
    [loading, setLoading] = useState(true);
  const lock = useRef(false),
    pending = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      void request<{ people: AdminPerson[]; events: Event[] }>(
        '?action=administration&q=' + encodeURIComponent(query),
      )
        .then((r) => {
          if (live) {
            setPeople(r.people);
            setEvents(r.events);
            setSelected((old) =>
              old ? r.people.find((p) => p.id === old.id) || old : null,
            );
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, version]);
  const submit = async () => {
    if (!selected || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const body = {
      action: 'adminGrant',
      target: selected.id,
      kind,
      amount: Number(amount),
      reason: reason.trim(),
    };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.body !== fingerprint)
      pending.current = { body: fingerprint, id: crypto.randomUUID() };
    try {
      await request('', { ...body, requestId: pending.current.id });
      pending.current = null;
      setNotice('Изменение сохранено и записано в журнал.');
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="administration-panel">
      <div className="account-section-heading">
        <ShieldCheck size={21} />
        <div>
          <h3>Администрирование</h3>
          <p>Stars, Premium и полномочия пользователей</p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="moderation-notice">{notice}</output>}
      {!selected ? (
        <>
          <label className="moderation-search">
            <Search size={17} />
            <input
              aria-label="Найти получателя"
              placeholder="Имя, основной или дополнительный @юзернейм"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {loading && <output className="meta">Ищем аккаунты…</output>}
          <div className="admin-people">
            {people.map((p) => (
              <button
                key={p.id}
                className="admin-person"
                onClick={() => {
                  setSelected(p);
                  setError('');
                  setNotice('');
                }}
              >
                <Avatar person={p} />
                <span>
                  <DisplayName person={p} />
                  <small>
                    @{p.handle} ·{' '}
                    {p.administrator
                      ? 'Администратор'
                      : p.moderator
                        ? 'Модератор'
                        : p.kind === 'channel'
                          ? 'Канал'
                          : 'Пользователь'}
                  </small>
                </span>
                <Gift size={18} />
              </button>
            ))}
          </div>
          {!loading && !people.length && (
            <p className="meta">Никого не нашли. Попробуйте другой юзернейм.</p>
          )}
        </>
      ) : (
        <form
          className="admin-grant-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy}>
            <button
              type="button"
              className="account-text-button"
              onClick={() => {
                setSelected(null);
                setNotice('');
              }}
            >
              <ChevronLeft size={16} /> Другой получатель
            </button>
            <div className="admin-target">
              <Avatar person={selected} size={48} />
              <div>
                <DisplayName person={selected} />
                <p>
                  @{selected.handle} ·{' '}
                  {selected.balance.toLocaleString('ru-RU')} Stars
                </p>
              </div>
            </div>
            <label className="account-field" htmlFor="admin-action">
              Действие
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(String(v));
                  setAmount(
                    v === 'stars' ? '1000' : v === 'premium' ? '30' : '1',
                  );
                  setNotice('');
                }}
              >
                <SelectTrigger
                  id="admin-action"
                  aria-label="Административное действие"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(labels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {kind === 'stars' || kind === 'premium' ? (
              <label className="account-field">
                {kind === 'stars' ? 'Количество Stars' : 'Дней Premium'}
                <input
                  type="number"
                  min={1}
                  max={kind === 'stars' ? 1000000 : 365}
                  step={1}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            ) : (
              <label className="account-field" htmlFor="admin-state">
                Состояние
                <Select
                  value={amount}
                  onValueChange={(v) => setAmount(String(v))}
                >
                  <SelectTrigger
                    id="admin-state"
                    aria-label="Состояние роли или верификации"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">
                      {kind === 'verified'
                        ? 'Подтвердить аккаунт'
                        : 'Назначить модератором'}
                    </SelectItem>
                    <SelectItem value="0">
                      {kind === 'verified'
                        ? 'Снять верификацию'
                        : 'Снять роль модератора'}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
            )}
            <label className="account-field">
              Причина
              <textarea
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например, награда за помощь в тестировании"
              />
            </label>
            <p className="admin-grant-summary">
              {kind === 'stars'
                ? `@${selected.handle} получит ${Number(amount || 0).toLocaleString('ru-RU')} Stars.`
                : kind === 'premium'
                  ? `Premium для @${selected.handle} будет продлён на ${amount} дн.`
                  : kind === 'verified'
                    ? `${amount === '1' ? 'Подтвердить' : 'Снять подтверждение'} @${selected.handle}.`
                    : `${amount === '1' ? 'Назначить' : 'Снять роль'} модератора для @${selected.handle}.`}
            </p>
            <button className="primary" disabled={!reason.trim() || busy}>
              {busy ? 'Сохраняем…' : 'Подтвердить выдачу'}
            </button>
          </fieldset>
        </form>
      )}
      <div className="admin-journal">
        <h4>Последние действия</h4>
        {events.map((e) => (
          <article key={e.id}>
            <div>
              <strong>
                {labels[e.action]}{' '}
                {e.action === 'stars'
                  ? `+${e.amount.toLocaleString('ru-RU')}`
                  : e.action === 'premium'
                    ? `+${e.amount} дн.`
                    : e.amount
                      ? '· включено'
                      : '· снято'}
              </strong>
              <time>{new Date(e.created).toLocaleString('ru-RU')}</time>
            </div>
            <p>
              {e.actorName} → {e.handle ? '@' + e.handle : e.name}
            </p>
            <small>{e.reason}</small>
          </article>
        ))}
        {!events.length && <p className="meta">Выдачи появятся здесь.</p>}
      </div>
    </section>
  );
}
