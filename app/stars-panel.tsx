'use client';
import { DisplayName } from './profile-identity';
/* Loading effects subscribe to the API; the React compiler is not enabled. */
/* eslint-disable react/react-compiler */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft,
  X,
  RefreshCw,
  ArrowDownLeft,
  ArrowUpRight,
  Send,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, Empty, Stamp } from './post-card';
import { StarScene } from './star-scene';
import { StarsIcon } from './stars-icon';
import { TelegramLink } from './telegram-link';
import { request, type Wallet, type Profile, type Post } from '@/lib/client';
const num = (n: number) => n.toLocaleString('ru-RU');
export function StarsPanel({
  me,
  onBack,
}: {
  me: Profile;
  onBack: () => void;
}) {
  const [wallet, setWallet] = useState<Wallet | null>(null),
    [filter, setFilter] = useState('all'),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [more, setMore] = useState(false);
  const live = useRef(false),
    generation = useRef(0);
  const load = useCallback(
    async (append = false, cursor?: { created: number; id: string }) => {
      const gen = ++generation.current;
      setLoading(true);
      setError('');
      try {
        const q = new URLSearchParams({ action: 'wallet' });
        if (cursor) {
          q.set('before', String(cursor.created));
          q.set('beforeId', cursor.id);
        }
        const next = await request<Wallet>('?' + q);
        if (live.current && gen === generation.current) {
          setMore(next.transactions.length === 50);
          setWallet((old) =>
            append && old
              ? {
                  ...next,
                  transactions: [
                    ...old.transactions,
                    ...next.transactions.filter(
                      (t) => !old.transactions.some((v) => v.id === t.id),
                    ),
                  ],
                }
              : next,
          );
        }
      } catch (e) {
        if (live.current) setError((e as Error).message);
      } finally {
        if (live.current && gen === generation.current) setLoading(false);
      }
    },
    [],
  );
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);
  const rows =
    wallet?.transactions.filter(
      (t) =>
        filter === 'all' ||
        (filter === 'incoming' ? t.recipient === me.id : t.sender === me.id),
    ) || [];
  return (
    <section className="premium-page stars-page">
      <div className="premium-page-controls">
        <button className="icon-button" onClick={onBack} aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <button
          className="icon-button"
          onClick={onBack}
          aria-label="Закрыть Stars"
        >
          <X size={19} />
        </button>
      </div>
      <div className="premium-hero stars-hero">
        <StarScene variant="stars" />
        <h2>Noct Stars</h2>
        <p>Поддерживай авторов и их публикации.</p>
        <div className="stars-balance">
          <StarsIcon size={30} />
          <strong>{wallet ? num(wallet.balance) : '—'}</strong>
        </div>
        <span className="test-stars-label">Тестовые звёзды · без оплаты</span>
        <p className="stars-help">
          При первом открытии — 10 000 тестовых звёзд. Пополняй тестовый баланс
          через Telegram-бота.
        </p>
      </div>
      <div className="stars-stats">
        <div>
          <ArrowDownLeft size={18} />
          <span>
            Получено<strong>{num(wallet?.received || 0)}</strong>
          </span>
        </div>
        <div>
          <ArrowUpRight size={18} />
          <span>
            Отправлено<strong>{num(wallet?.sent || 0)}</strong>
          </span>
        </div>
      </div>
      <TelegramLink onWalletChange={() => void load()} />
      <div className="stars-history">
        <div className="row">
          <h3>История операций</h3>
          <span className="grow" />
          <button
            className="icon-button"
            disabled={loading}
            aria-label="Обновить баланс"
            onClick={() => void load()}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(String(v))}>
          <TabsList className="stars-tabs">
            <TabsTrigger value="all">Все</TabsTrigger>
            <TabsTrigger value="incoming">Входящие</TabsTrigger>
            <TabsTrigger value="outgoing">Исходящие</TabsTrigger>
          </TabsList>
        </Tabs>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!wallet && loading && <p className="meta">Загружаем баланс…</p>}
        {rows.map((t) => (
          <div className="star-transaction" key={t.id}>
            {t.kind === 'telegram_test' ? (
              <span
                className="transaction-grant telegram-transaction-icon"
                aria-hidden="true"
              >
                <Send size={20} />
              </span>
            ) : t.kind === 'grant' ? (
              <span className="transaction-grant">
                <StarsIcon size={26} />
              </span>
            ) : (
              <Avatar person={t} size={38} />
            )}
            <div>
              <strong>
                {t.kind === 'telegram_test' ? (
                  'Пополнение через Telegram'
                ) : t.kind === 'grant' ? (
                  'Тестовый баланс'
                ) : (
                  <DisplayName person={t} />
                )}
              </strong>
              <span>
                {t.kind === 'telegram_test'
                  ? 'Тестовые звёзды · без оплаты'
                  : t.kind === 'grant'
                    ? 'Стартовые звёзды'
                    : t.sender === me.id
                      ? 'Поддержка автора'
                      : 'Поддержали твою публикацию'}
              </span>
              <Stamp time={t.created} />
            </div>
            <b className={t.recipient === me.id ? 'incoming' : ''}>
              {t.recipient === me.id ? '+' : '−'}
              {num(t.amount)}
              <StarsIcon size={15} />
            </b>
          </div>
        ))}
        {wallet && !rows.length && (
          <Empty>Здесь появятся твои операции со звёздами.</Empty>
        )}
        {more && (
          <button
            className="secondary load-more"
            disabled={loading}
            onClick={() => void load(true, wallet?.transactions.at(-1))}
          >
            Загрузить ещё
          </button>
        )}
      </div>
    </section>
  );
}
export function SupportPanel({
  post,
  onDone,
}: {
  post: Post;
  onDone: (amount: number) => void;
}) {
  const [balance, setBalance] = useState<number | null>(null),
    [amount, setAmount] = useState('100'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useRef<{ amount: number; key: string } | null>(null),
    lock = useRef(false);
  const remaining = Math.max(0, 10000 - (post.mySupport || 0));
  useEffect(() => {
    let live = true;
    request<Wallet>('?action=wallet')
      .then((w) => {
        if (live) {
          setBalance(w.balance);
          setAmount(String(Math.min(100, w.balance, remaining)));
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [remaining]);
  const value = Number(amount),
    max = Math.min(balance || 0, remaining),
    valid = Number.isInteger(value) && value >= 1 && value <= max;
  return (
    <form
      className="support-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current || !valid) return;
        lock.current = true;
        setBusy(true);
        setError('');
        if (!key.current || key.current.amount !== value)
          key.current = { amount: value, key: crypto.randomUUID() };
        try {
          await request('', {
            action: 'support',
            id: post.id,
            amount: value,
            key: key.current.key,
          });
          onDone(value);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <Avatar person={post} size={54} />
      <h3>
        <DisplayName person={post} />
      </h3>
      <p className="meta">
        За эту публикацию можно отправить ещё {num(remaining)} звёзд.
      </p>
      <fieldset disabled={busy || balance === null}>
        <label className="support-amount">
          <StarsIcon size={26} />
          <input
            type="number"
            min={1}
            max={max}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Количество звёзд"
          />
        </label>
        <input
          className="stars-range"
          type="range"
          min={1}
          max={Math.max(1, max)}
          value={Math.max(1, Math.min(value || 1, max))}
          disabled={!max}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Выбрать количество звёзд"
        />
        <div className="star-presets">
          {[10, 100, 1000, max]
            .filter((v, i, a) => v > 0 && v <= max && a.indexOf(v) === i)
            .map((v) => (
              <button
                type="button"
                key={v}
                className={v === value ? 'selected' : ''}
                onClick={() => setAmount(String(v))}
              >
                {num(v)}
              </button>
            ))}
        </div>
        <span className="meta">
          Баланс: {balance === null ? 'загружаем…' : num(balance)} · тестовые
          звёзды
        </span>
        <button className="primary" disabled={!valid || busy}>
          {busy ? 'Отправляем…' : `Поддержать · ${num(value || 0)}`}
          <StarsIcon size={18} />
        </button>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
