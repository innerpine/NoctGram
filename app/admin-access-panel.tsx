'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Globe,
  MonitorSmartphone,
  RefreshCw,
  Search,
  ShieldBan,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { request, type Person } from '@/lib/client';
import { Avatar } from './profile-identity';

type AccessPerson = Person & { protected: number };
type Observation = {
  id: string;
  kind: 'ip' | 'device';
  label: string;
  lastSeen: number;
  accounts: number;
  protected: number;
};
type Block = {
  id: string;
  targetId: string;
  name: string;
  handle: string;
  reason: string;
  created: number;
  revokedAt: number;
  actorName: string;
  rules: { kind: string; label: string }[];
};
type Data = {
  people: AccessPerson[];
  observations: Observation[];
  blocks: Block[];
};
const date = (value: number) =>
  new Date(value).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
export default function AdminAccessPanel({
  onLocked,
}: {
  onLocked: (locked: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<AccessPerson | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);
  const lock = useRef(false);
  const pending = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    onLocked(busy);
    return () => onLocked(false);
  }, [busy, onLocked]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void request<Data>(
        '?action=adminAccess&q=' +
          encodeURIComponent(query) +
          '&target=' +
          encodeURIComponent(target?.id || ''),
      )
        .then((next) => {
          if (!live) return;
          setData(next);
          setError('');
          setSelected((ids) =>
            ids.filter((id) =>
              next.observations.some((o) => o.id === id && !o.protected),
            ),
          );
        })
        .catch((e) => {
          if (live)
            setError(
              e instanceof Error ? e.message : 'Не удалось загрузить сведения',
            );
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, target?.id, version]);
  async function change(revoke?: string) {
    if (
      lock.current ||
      (!revoke && (!target || !selected.length || !reason.trim()))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (revoke)
        await request('', { action: 'adminAccessRevoke', id: revoke });
      else {
        const body = {
          action: 'adminAccessBlock',
          target: target!.id,
          observations: [...selected].sort(),
          reason: reason.trim(),
        };
        const key = JSON.stringify(body);
        if (pending.current?.body !== key)
          pending.current = { body: key, id: crypto.randomUUID() };
        await request('', { ...body, requestId: pending.current.id });
        pending.current = null;
        setSelected([]);
        setReason('');
      }
      setNotice(
        revoke
          ? 'Блокировка входа снята.'
          : 'Вход заблокирован бессрочно. Правила действуют и на новые аккаунты.',
      );
      setLoading(true);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось сохранить блокировку',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="admin-access-panel">
      <div className="admin-access-heading">
        <div>
          <h2>Антиспам</h2>
          <p>Блокировка входа по IP и браузеру устройства.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Обновить сведения о входах"
          disabled={busy || loading}
          onClick={() => {
            setLoading(true);
            setVersion((v) => v + 1);
          }}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="admin-access-notice">{notice}</output>}
      <label className="staff-search">
        <Search size={18} />
        <input
          aria-label="Найти пользователя для блокировки"
          placeholder="Имя или @юзернейм"
          value={query}
          disabled={busy}
          onChange={(e) => {
            setLoading(true);
            setQuery(e.target.value);
            setTarget(null);
            setSelected([]);
          }}
        />
      </label>
      <div className="admin-access-people" aria-busy={loading}>
        {data?.people.map((person) => (
          <button
            key={person.id}
            className="admin-access-person"
            aria-pressed={target?.id === person.id}
            disabled={busy || !!person.protected}
            onClick={() => {
              if (target?.id === person.id) return;
              setLoading(true);
              setTarget(person);
              setSelected([]);
              setNotice('');
            }}
          >
            <Avatar person={person} size={34} />
            <span>
              <strong>{person.name}</strong>
              <small>
                @{person.handle}
                {person.protected ? ' · сотрудник' : ''}
              </small>
            </span>
          </button>
        ))}
        {!loading && data?.people.length === 0 && (
          <p className="meta">Пользователи не найдены.</p>
        )}
      </div>
      {target ? (
        <form
          className="admin-access-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void change();
          }}
        >
          <h3>Блокировка @{target.handle}</h3>
          <p>
            Вход будет закрыт этому аккаунту и всем аккаунтам с выбранных IP или
            браузеров. Срок — до снятия администратором.
          </p>
          {loading ? (
            <p className="meta">Загружаем последние входы…</p>
          ) : data?.observations.length ? (
            <div className="admin-access-observations">
              {data.observations.map((item) => (
                <label
                  key={item.id}
                  className="admin-access-observation"
                  data-protected={!!item.protected}
                >
                  <Checkbox
                    aria-label={
                      (item.kind === 'ip' ? 'IP ' : 'Устройство ') + item.label
                    }
                    checked={selected.includes(item.id)}
                    disabled={
                      busy ||
                      !!item.protected ||
                      (!selected.includes(item.id) && selected.length >= 12)
                    }
                    onCheckedChange={(checked) =>
                      setSelected((ids) =>
                        checked
                          ? [...ids, item.id]
                          : ids.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.kind === 'ip' ? (
                    <Globe size={18} />
                  ) : (
                    <MonitorSmartphone size={18} />
                  )}
                  <span>
                    <strong>{item.label}</strong>
                    <small>
                      {item.kind === 'ip' ? 'IP-адрес' : 'Браузер устройства'} ·{' '}
                      {date(item.lastSeen)}
                    </small>
                    {item.accounts > 1 && (
                      <small className="admin-access-shared">
                        {item.kind === 'ip'
                          ? 'Этот IP встречался у '
                          : 'Этот браузер встречался у '}
                        {item.accounts} аккаунтов
                      </small>
                    )}
                    {!!item.protected && (
                      <small>Недоступно: используется сотрудником</small>
                    )}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="meta">
              Пока нет сведений о входах. Они появятся после следующего
              посещения пользователя.
            </p>
          )}
          <label className="admin-access-reason">
            Причина
            <textarea
              value={reason}
              maxLength={500}
              required
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: повторная реклама с новых аккаунтов"
            />
          </label>
          <button
            className="danger-button"
            type="submit"
            disabled={busy || loading || !selected.length || !reason.trim()}
          >
            <ShieldBan size={17} />
            {busy ? 'Сохраняем…' : 'Заблокировать бессрочно'}
          </button>
          <small className="meta">
            Сведения о входах хранятся 30 дней. Другое устройство, очистка
            данных браузера или смена IP могут позволить обойти блокировку.
          </small>
        </form>
      ) : (
        <p className="meta">
          Выберите пользователя, чтобы посмотреть его последние IP и устройства.
        </p>
      )}
      <section className="admin-access-blocks">
        <h3>Блокировки входа</h3>
        {data?.blocks.map((block) => (
          <article
            key={block.id}
            className="admin-access-block"
            data-revoked={!!block.revokedAt}
          >
            <header>
              <strong>
                {block.name} <span>@{block.handle}</span>
              </strong>
              <small>{block.revokedAt ? 'Снята' : 'Бессрочно'}</small>
            </header>
            <p>{block.reason}</p>
            <ul>
              {block.rules.map((rule, index) => (
                <li key={index}>
                  {rule.kind === 'ip' ? 'IP' : 'Устройство'}: {rule.label}
                </li>
              ))}
            </ul>
            <footer>
              <small>
                {date(block.created)} · {block.actorName}
              </small>
              {!block.revokedAt && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void change(block.id)}
                >
                  Снять блокировку
                </button>
              )}
            </footer>
          </article>
        ))}
        {!loading && data?.blocks.length === 0 && (
          <p className="meta">Блокировок входа пока нет.</p>
        )}
      </section>
    </section>
  );
}
