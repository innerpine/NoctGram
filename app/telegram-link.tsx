'use client';
/* Polling and mutations share a generation guard so stale reads cannot restore a cancelled link. */
/* eslint-disable react/react-compiler */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Clock3,
  Link2,
  LoaderCircle,
  RefreshCw,
  Send,
  Unlink,
} from 'lucide-react';
import { request } from '@/lib/client';

type TelegramAccount = {
  telegramId: string;
  telegramName: string;
  telegramUsername: string;
};
type TelegramState = {
  enabled: boolean;
  testMode: true;
  botUsername: string;
  link: TelegramAccount | null;
  pending: {
    id: string;
    telegramId: string | null;
    telegramName: string | null;
    telegramUsername: string | null;
    expiresAt: number;
  } | null;
};
type TelegramAction =
  | 'telegramLink'
  | 'telegramConfirm'
  | 'telegramCancel'
  | 'telegramUnlink';

function botUrl(username: string, start = 'balance') {
  return /^[a-zA-Z0-9_]{5,32}$/.test(username)
    ? `https://t.me/${username}?start=${encodeURIComponent(start)}`
    : '';
}
function safeStartUrl(value: string | undefined, username: string) {
  try {
    const url = new URL(value || '');
    return url.origin === 'https://t.me' &&
      !url.username &&
      !url.password &&
      url.pathname.toLowerCase() === '/' + username.toLowerCase() &&
      /^link_[a-zA-Z0-9_-]+$/.test(url.searchParams.get('start') || '')
      ? url.href
      : '';
  } catch {
    return '';
  }
}
function Account({ account }: { account: TelegramAccount }) {
  return (
    <div className="telegram-account">
      <span className="telegram-account-icon" aria-hidden="true">
        <Send size={19} />
      </span>
      <div>
        <strong>
          {account.telegramName ||
            account.telegramUsername ||
            'Аккаунт Telegram'}
        </strong>
        {account.telegramUsername && (
          <span>@{account.telegramUsername.replace(/^@/, '')}</span>
        )}
        <small>ID: {account.telegramId}</small>
      </div>
    </div>
  );
}

export function TelegramLink({
  onWalletChange,
}: {
  onWalletChange: () => void;
}) {
  const [state, setState] = useState<TelegramState | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [readError, setReadError] = useState(''),
    [notice, setNotice] = useState(''),
    [code, setCode] = useState(''),
    [unlinking, setUnlinking] = useState(false),
    [startLink, setStartLink] = useState<{ id: string; url: string } | null>(
      null,
    ),
    [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLElement>(null),
    codeId = useId(),
    titleId = useId(),
    mounted = useRef(false),
    generation = useRef(0),
    reading = useRef<number | null>(null),
    actionLock = useRef(false),
    current = useRef<TelegramState | null>(null),
    visible = useRef(false),
    walletCallback = useRef(onWalletChange),
    lastResume = useRef(0);
  useEffect(() => {
    walletCallback.current = onWalletChange;
  }, [onWalletChange]);

  const accept = useCallback((next: TelegramState) => {
    const previous = current.current;
    if (
      previous?.pending?.id !== next.pending?.id ||
      previous?.pending?.telegramId !== next.pending?.telegramId
    )
      setCode('');
    if (previous?.link?.telegramId !== next.link?.telegramId)
      setUnlinking(false);
    if (
      previous &&
      (previous.link?.telegramId !== next.link?.telegramId ||
        previous.pending?.id !== next.pending?.id)
    )
      setError('');
    current.current = next;
    setState(next);
    setNow(Date.now());
    setStartLink((old) => (old?.id === next.pending?.id ? old : null));
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current || actionLock.current || reading.current !== null)
      return;
    const version = ++generation.current;
    reading.current = version;
    setLoading(true);
    try {
      const next = await request<TelegramState>('?action=telegram');
      if (!mounted.current || generation.current !== version) return;
      accept(next);
      setReadError('');
    } catch (e) {
      if (mounted.current && generation.current === version)
        setReadError((e as Error).message);
    } finally {
      if (reading.current === version) reading.current = null;
      if (mounted.current && generation.current === version) setLoading(false);
    }
  }, [accept]);
  const invalidate = useCallback(() => {
    ++generation.current;
    reading.current = null;
    actionLock.current = false;
  }, []);

  useEffect(() => {
    mounted.current = true;
    let inView = false,
      observed = false;
    const resume = (updateWallet = false) => {
      visible.current = inView && !document.hidden;
      if (
        updateWallet &&
        !document.hidden &&
        Date.now() - lastResume.current > 750
      ) {
        lastResume.current = Date.now();
        walletCallback.current();
      }
      if (!visible.current) return;
      setNow(Date.now());
      void refresh();
    };
    const onReturn = () => resume(true);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            const returning = observed && !inView && entry.isIntersecting;
            inView = entry.isIntersecting;
            observed = true;
            resume(returning);
          });
    if (observer && root.current) observer.observe(root.current);
    else {
      inView = true;
      resume();
    }
    if (!document.hidden) void refresh();
    const poll = window.setInterval(() => {
      if (
        visible.current &&
        current.current?.pending &&
        current.current.pending.expiresAt > Date.now()
      )
        void refresh();
    }, 3000);
    const clock = window.setInterval(() => {
      if (visible.current && current.current?.pending) setNow(Date.now());
    }, 1000);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      mounted.current = false;
      visible.current = false;
      invalidate();
      observer?.disconnect();
      clearInterval(poll);
      clearInterval(clock);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [refresh, invalidate]);

  async function perform(action: TelegramAction, pendingId?: string) {
    if (!mounted.current || actionLock.current) return;
    if (
      action === 'telegramConfirm' &&
      (!/^[0-9]{8}$/.test(code) ||
        !pendingId ||
        current.current?.pending?.id !== pendingId ||
        current.current.pending.expiresAt <= Date.now())
    )
      return;
    actionLock.current = true;
    const version = ++generation.current;
    reading.current = null;
    setBusy(true);
    setLoading(false);
    setError('');
    setNotice('');
    let reconcile = false;
    try {
      const next = await request<TelegramState & { url?: string }>('', {
        action,
        ...(action === 'telegramConfirm' ? { id: pendingId, code } : {}),
      });
      if (!mounted.current || generation.current !== version) return;
      accept(next);
      setReadError('');
      if (action === 'telegramLink' && next.pending) {
        const url = safeStartUrl(next.url, next.botUsername);
        if (url) setStartLink({ id: next.pending.id, url });
        else
          setError('Не удалось получить ссылку на бота. Создай новую ссылку.');
      }
      if (action === 'telegramConfirm') {
        setNotice('Telegram привязан. Можно пополнять тестовый баланс.');
        walletCallback.current();
      }
      if (action === 'telegramCancel') setNotice('Запрос привязки отменён.');
      if (action === 'telegramUnlink') {
        setNotice('Telegram отвязан. Звёзды остались на балансе.');
        walletCallback.current();
      }
    } catch (e) {
      if (mounted.current && generation.current === version) {
        setError((e as Error).message);
        reconcile = true;
      }
    } finally {
      if (mounted.current && generation.current === version) {
        actionLock.current = false;
        setBusy(false);
        if (reconcile) void refresh();
      }
    }
  }

  const pending = state?.pending,
    expired = !!pending && pending.expiresAt <= now,
    seconds = Math.max(
      0,
      Math.ceil(((pending?.expiresAt || now) - now) / 1000),
    ),
    remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    balanceUrl = state ? botUrl(state.botUsername) : '';
  return (
    <section ref={root} className="telegram-link" aria-labelledby={titleId}>
      <div className="telegram-link-heading">
        <span className="telegram-link-icon" aria-hidden="true">
          <Send size={20} />
        </span>
        <div>
          <h3 id={titleId}>Stars через Telegram</h3>
          <p>Тестовое пополнение без оплаты</p>
        </div>
        {busy && (
          <LoaderCircle className="spin" size={17} aria-label="Сохраняем" />
        )}
      </div>
      {!state && loading && (
        <output className="telegram-link-copy">Проверяем привязку…</output>
      )}
      {state && !state.enabled && (
        <p className="telegram-link-copy">
          Бот скоро появится здесь. Стартовые звёзды уже можно тратить на
          поддержку авторов.
        </p>
      )}
      {state?.enabled && (
        <>
          {pending ? (
            <div className="telegram-link-step">
              {expired ? (
                <>
                  <p className="telegram-link-copy">
                    Срок ссылки истёк. Создай новую, чтобы продолжить привязку.
                  </p>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => void perform('telegramLink')}
                  >
                    <RefreshCw size={15} /> Новая ссылка
                  </button>
                </>
              ) : pending.telegramId ? (
                <>
                  <Account
                    account={{
                      telegramId: pending.telegramId,
                      telegramName: pending.telegramName || '',
                      telegramUsername: pending.telegramUsername || '',
                    }}
                  />
                  <p className="telegram-link-copy">
                    Проверь, что это твой аккаунт. Введи 8-значный код, который
                    бот прислал в личный чат Telegram.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void perform('telegramConfirm', pending.id);
                    }}
                  >
                    <fieldset disabled={busy} className="telegram-link-fields">
                      <label htmlFor={codeId}>Код из Telegram</label>
                      <input
                        id={codeId}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{8}"
                        maxLength={8}
                        required
                        value={code}
                        onChange={(event) =>
                          setCode(
                            event.target.value
                              .replace(/[^0-9]/g, '')
                              .slice(0, 8),
                          )
                        }
                        placeholder="00000000"
                      />
                      <div className="telegram-link-actions">
                        <button
                          className="primary"
                          disabled={busy || code.length !== 8}
                        >
                          <Check size={15} /> Подтвердить
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void perform('telegramCancel')}
                        >
                          Это не я
                        </button>
                      </div>
                    </fieldset>
                  </form>
                </>
              ) : (
                <>
                  <p className="telegram-link-copy">
                    Открой бота и нажми «Старт». Затем вернись сюда, чтобы
                    подтвердить свой Telegram.
                  </p>
                  {startLink?.id === pending.id ? (
                    <a
                      className="primary"
                      href={startLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={busy}
                      tabIndex={busy ? -1 : undefined}
                      onClick={(event) => {
                        if (busy) event.preventDefault();
                      }}
                    >
                      Открыть бота <ArrowUpRight size={16} />
                    </a>
                  ) : (
                    <>
                      <p className="telegram-link-copy">
                        Ссылка была создана в другом окне. Можно создать новую;
                        предыдущая перестанет работать.
                      </p>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => void perform('telegramLink')}
                      >
                        Создать новую ссылку
                      </button>
                    </>
                  )}
                  <span className="telegram-link-wait">
                    <span aria-hidden="true" /> Ждём ответ из Telegram
                  </span>
                </>
              )}
              {!expired && (
                <span className="telegram-link-expiry" aria-live="off">
                  <Clock3 size={13} aria-hidden="true" /> Осталось {remaining} ·
                  ссылка действует 10 минут
                </span>
              )}
              <button
                type="button"
                className="telegram-link-text-button"
                disabled={busy}
                onClick={() => void perform('telegramCancel')}
              >
                Отменить привязку
              </button>
            </div>
          ) : state.link ? (
            <div className="telegram-link-step">
              <span className="telegram-linked-label">
                <Check size={13} /> Telegram привязан
              </span>
              <Account account={state.link} />
              {balanceUrl && (
                <a
                  className="primary"
                  href={balanceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={busy}
                  tabIndex={busy ? -1 : undefined}
                  onClick={(event) => {
                    if (busy) event.preventDefault();
                  }}
                >
                  Пополнить через бота <ArrowUpRight size={16} />
                </a>
              )}
              {unlinking ? (
                <div className="telegram-unlink-confirm">
                  <p>Отвязать этот Telegram? Звёзды останутся в Noctgram.</p>
                  <div className="telegram-link-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void perform('telegramUnlink')}
                    >
                      <Unlink size={14} /> Отвязать
                    </button>
                    <button
                      type="button"
                      className="telegram-link-text-button"
                      disabled={busy}
                      onClick={() => setUnlinking(false)}
                    >
                      Оставить
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="telegram-link-text-button"
                  disabled={busy}
                  onClick={() => setUnlinking(true)}
                >
                  Отвязать Telegram
                </button>
              )}
            </div>
          ) : (
            <div className="telegram-link-step">
              <p className="telegram-link-copy">
                Привяжи свой Telegram и получай тестовые звёзды в боте. Каждую
                привязку подтверждаешь ты.
              </p>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void perform('telegramLink')}
              >
                <Link2 size={16} /> Привязать Telegram
              </button>
            </div>
          )}
          <p className="telegram-link-limit">
            До 50 000 тестовых звёзд за 24 часа. Покупка появится позже.
          </p>
        </>
      )}
      {error && (
        <p className="telegram-link-error" role="alert">
          {error}
        </p>
      )}
      {readError && (
        <output className="telegram-link-error">
          <span>{readError}</span>
          <button
            type="button"
            className="telegram-link-text-button"
            disabled={busy || loading}
            onClick={() => void refresh()}
          >
            Повторить
          </button>
        </output>
      )}
      {notice && <output className="telegram-link-notice">{notice}</output>}
    </section>
  );
}
