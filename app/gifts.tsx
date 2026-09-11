'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Gift,
  LoaderCircle,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  giftDefinition,
  availableGiftDefinition,
  type GiftDefinition,
  type ReceivedGift,
} from '@/lib/gift-catalog';
import { GiftAnimation } from './gift-animation';
import { StarsIcon } from './stars-icon';
import type { Person } from '@/lib/client';
import { Avatar } from './profile-identity';
import { ProfileLink, MentionText } from './profile-link';
import { reconcileSnapshot } from '@/lib/reconcile-snapshot';

async function api<T>(query = '', body?: object): Promise<T> {
  const response = await fetch('/api/gifts' + query, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || 'Не удалось загрузить подарки'),
      { status: response.status },
    );
  return data;
}
const refreshGifts = () =>
  window.dispatchEvent(new Event('noctgram:gifts-changed'));
const color = (gift: GiftDefinition): CSSProperties =>
  ({ '--gift-color': gift.color }) as CSSProperties;

type GiftDraft = {
  key: string;
  giftId: string;
  recipient: string;
  message: string;
};
function storedDraft(key: string, recipient: string): GiftDraft | null {
  try {
    const draft = JSON.parse(
      sessionStorage.getItem(key) || 'null',
    ) as GiftDraft | null;
    return draft &&
      draft.recipient === recipient &&
      availableGiftDefinition(draft.giftId) &&
      /^[a-zA-Z0-9-]{16,80}$/.test(draft.key) &&
      typeof draft.message === 'string' &&
      draft.message.length <= 240
      ? draft
      : null;
  } catch {
    return null;
  }
}
function saveDraft(key: string, draft: GiftDraft | null) {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch {
    /* The in-memory request key still protects retries without storage. */
  }
}
export function SendGiftButton({
  recipient,
  senderId,
  disabled,
}: {
  recipient: Person;
  senderId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [session, setSession] = useState(0);
  const popup = useRef<HTMLDivElement>(null);
  return (
    <>
      <button
        className="icon-button profile-gift-button"
        aria-label="Подарить подарок"
        title="Подарить подарок"
        disabled={disabled}
        onClick={() => {
          setSession((value) => value + 1);
          setOpen(true);
        }}
      >
        <Gift size={19} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          ref={popup}
          initialFocus={popup}
          showCloseButton={false}
          className="noct-dialog gift-dialog gift-send-dialog"
          overlayClassName="gift-backdrop"
        >
          <SendGiftForm
            key={session}
            recipient={recipient}
            senderId={senderId}
            onClose={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
function SendGiftForm({
  recipient,
  senderId,
  onClose,
}: {
  recipient: Person;
  senderId: string;
  onClose: () => void;
}) {
  const draftKey = 'noctgram:gift-draft:' + senderId + ':' + recipient.id;
  const [initial] = useState(() => storedDraft(draftKey, recipient.id));
  const [catalog, setCatalog] = useState<GiftDefinition[]>([]),
    [balance, setBalance] = useState<number | null>(null);
  const [selected, setSelected] = useState<GiftDefinition | null>(
      () => availableGiftDefinition(initial?.giftId) || null,
    ),
    [message, setMessage] = useState(initial?.message || '');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [query, setQuery] = useState(''),
    [reload, setReload] = useState(0);
  const search = query.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  const matches = catalog.filter((gift) =>
    (gift.name + ' ' + gift.id.replaceAll('_', ' '))
      .toLocaleLowerCase('ru-RU')
      .replaceAll('ё', 'е')
      .includes(search),
  );
  const locked = useRef(false);
  // Keep the same key and immutable purchase draft after an uncertain response.
  const attempt = useRef<GiftDraft | null>(initial);
  useEffect(() => {
    let active = true;
    void api<{ catalog: GiftDefinition[]; balance: number }>('?action=catalog')
      .then((data) => {
        if (active) {
          setCatalog(data.catalog);
          setBalance(data.balance);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  async function send() {
    if (!selected || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const draft = attempt.current ?? {
      key: crypto.randomUUID(),
      giftId: selected.id,
      recipient: recipient.id,
      message: message.trim(),
    };
    attempt.current = draft;
    saveDraft(draftKey, draft);
    try {
      const result = await api<{ balance: number }>('', {
        action: 'send',
        ...draft,
      });
      saveDraft(draftKey, null);
      setBalance(result.balance);
      setSent(true);
      refreshGifts();
    } catch (e) {
      if (
        [400, 403, 404, 409].includes((e as { status?: number }).status || 0)
      ) {
        attempt.current = null;
        saveDraft(draftKey, null);
      }
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className={
          'gift-dialog-heading' + (!selected ? ' gift-catalog-heading' : '')
        }
      >
        <DialogClose
          className="icon-button gift-dialog-close"
          aria-label="Закрыть подарки"
        >
          <X size={18} />
        </DialogClose>
        {selected && !sent && !attempt.current && (
          <button
            className="icon-button"
            onClick={() => {
              setSelected(null);
              setError('');
            }}
            aria-label="Назад к подаркам"
          >
            <ArrowLeft size={19} />
          </button>
        )}
        <div>
          <DialogTitle>
            {sent
              ? 'Подарок отправлен'
              : selected
                ? selected.name
                : 'Выберите подарок'}
          </DialogTitle>
          <DialogDescription>
            {sent
              ? `${recipient.name} получит его в уведомлениях`
              : `Подарок для ${recipient.name}`}
          </DialogDescription>
        </div>
        {!selected && (
          <label className="gift-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label="Найти подарок"
              placeholder="Найти подарок"
              value={query}
              maxLength={80}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="Очистить поиск"
                onClick={() => setQuery('')}
              >
                <X size={16} />
              </button>
            )}
          </label>
        )}
      </div>
      {selected ? (
        <div
          className={'gift-preview' + (sent ? ' gift-sent' : '')}
          style={color(selected)}
        >
          <div className="gift-preview-art">
            <GiftAnimation id={selected.id} />
            {sent && (
              <span className="gift-success-mark">
                <Check size={24} />
              </span>
            )}
          </div>
          <div className="gift-recipient">
            <ProfileLink target={{ id: recipient.id }}>
              <Avatar person={recipient} size={25} />
              <span>{recipient.name}</span>
            </ProfileLink>
          </div>
          {!sent && (
            <label className="gift-message-label">
              Пара тёплых слов <span>необязательно</span>
              <textarea
                value={message}
                maxLength={240}
                rows={2}
                placeholder="Напиши что-нибудь приятное…"
                disabled={busy || !!attempt.current}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
          )}
          {sent && message.trim() && (
            <p className="gift-caption">{message.trim()}</p>
          )}
        </div>
      ) : (
        <div className="gift-browser">
          <div className="gift-catalog-scroll">
            <div className="gift-catalog">
              {matches.map((gift) => (
                <button
                  type="button"
                  key={gift.id}
                  className="gift-tile"
                  style={color(gift)}
                  onClick={() => setSelected(gift)}
                >
                  <GiftAnimation id={gift.id} />
                  <strong>{gift.name}</strong>
                  <span className="gift-price">
                    <StarsIcon size={17} />
                    {gift.price}
                  </span>
                </button>
              ))}
              {!!catalog.length && !matches.length && (
                <output className="gift-search-empty">
                  Такого подарка пока нет
                </output>
              )}
              {!catalog.length && !error && (
                <div className="gift-loading">
                  <LoaderCircle className="spin" size={24} />
                  Загружаем подарки…
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
          {!selected && (
            <button
              className="gift-retry"
              onClick={() => setReload((v) => v + 1)}
            >
              Повторить
            </button>
          )}
        </p>
      )}
      <div className="gift-checkout">
        {balance !== null && (
          <span className="gift-wallet">
            Баланс <StarsIcon size={17} />
            <b>{balance.toLocaleString('ru-RU')}</b>
          </span>
        )}
        {sent ? (
          <button className="primary" onClick={onClose}>
            Готово
          </button>
        ) : (
          selected && (
            <button
              className="primary gift-send"
              disabled={
                busy ||
                balance === null ||
                (!attempt.current && balance < selected.price)
              }
              onClick={() => void send()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Gift size={17} />
              )}
              {busy
                ? 'Отправляем…'
                : attempt.current
                  ? 'Проверить отправку'
                  : 'Подарить'}
              <span>
                <StarsIcon size={16} />
                {selected.price}
              </span>
            </button>
          )
        )}
      </div>
      {selected && !sent && balance !== null && balance < selected.price && (
        <p className="meta">Не хватает звёзд. Пополни баланс в Noct Stars.</p>
      )}
    </>
  );
}

type GiftPage = { gifts: ReceivedGift[]; next: string | null };
export function ProfileGifts({
  userId,
  own,
}: {
  userId: string;
  own: boolean;
}) {
  const [page, setPage] = useState<GiftPage>({ gifts: [], next: null }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [selected, setSelected] = useState<ReceivedGift | null>(null),
    [receiptOpen, setReceiptOpen] = useState(false),
    [moreBusy, setMoreBusy] = useState(false),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const version = useRef(0),
    expanded = useRef(false),
    loadingMore = useRef(false),
    saving = useRef(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.hidden || loadingMore.current) return;
      const request = ++version.current;
      try {
        const result = await api<GiftPage>(
          '?user=' + encodeURIComponent(userId),
        );
        if (active && request === version.current) {
          setPage((previous) => reconcileSnapshot(previous, result));
          setError('');
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };
    const changed = () => {
      void refresh();
    };
    setPage({ gifts: [], next: null });
    expanded.current = false;
    setLoading(true);
    changed();
    window.addEventListener('noctgram:gifts-changed', changed);
    document.addEventListener('visibilitychange', changed);
    const timer = setInterval(() => {
      if (!expanded.current) changed();
    }, 15000);
    return () => {
      active = false;
      // This is a request revision counter, not a rendered DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      version.current++;
      clearInterval(timer);
      window.removeEventListener('noctgram:gifts-changed', changed);
      document.removeEventListener('visibilitychange', changed);
    };
  }, [userId, reload]);
  async function more() {
    if (!page.next || loadingMore.current) return;
    loadingMore.current = true;
    expanded.current = true;
    setMoreBusy(true);
    const request = ++version.current;
    try {
      const result = await api<GiftPage>(
        '?user=' +
          encodeURIComponent(userId) +
          '&before=' +
          encodeURIComponent(page.next),
      );
      if (request === version.current)
        setPage((old) => ({
          gifts: [
            ...old.gifts,
            ...result.gifts.filter(
              (gift) => !old.gifts.some((row) => row.id === gift.id),
            ),
          ],
          next: result.next,
        }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      loadingMore.current = false;
      setMoreBusy(false);
    }
  }
  async function visibility() {
    if (!selected || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await api('', {
        action: 'visibility',
        id: selected.id,
        hidden: !selected.hidden,
      });
      const updated = { ...selected, hidden: selected.hidden ? 0 : 1 };
      setSelected((old) => (old?.id === updated.id ? updated : old));
      setPage((old) => ({
        ...old,
        gifts: old.gifts.map((row) => (row.id === updated.id ? updated : row)),
      }));
      refreshGifts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const definition = selected && giftDefinition(selected.giftId);
  return (
    <section className="profile-gifts" aria-label="Подарки в профиле">
      {loading ? (
        <div className="gift-loading">
          <LoaderCircle className="spin" size={22} />
          Загружаем подарки…
        </div>
      ) : page.gifts.length ? (
        <div className="gift-collection">
          {page.gifts.map((receipt) => {
            const gift = giftDefinition(receipt.giftId);
            return (
              gift && (
                <div
                  className="gift-tile received-gift"
                  key={receipt.id}
                  style={color(gift)}
                >
                  <button
                    className="gift-tile-open"
                    aria-label={'Посмотреть подарок «' + gift.name + '»'}
                    onClick={() => {
                      setSelected(receipt);
                      setReceiptOpen(true);
                      setError('');
                    }}
                  >
                    {receipt.hidden === 1 && (
                      <EyeOff
                        size={14}
                        className="gift-hidden-mark"
                        aria-label="Скрыт из профиля"
                      />
                    )}
                    <GiftAnimation id={gift.id} />
                    <strong>{gift.name}</strong>
                  </button>
                  <span className="gift-from">
                    от{' '}
                    <ProfileLink target={{ id: receipt.sender }}>
                      {receipt.senderName}
                    </ProfileLink>
                  </span>
                </div>
              )
            );
          })}
        </div>
      ) : (
        <div className="gift-empty">
          <span>
            <Gift size={31} />
            <Sparkles size={18} />
          </span>
          <h3>Здесь будут подарки</h3>
          <p>
            {own
              ? 'Полученные подарки.'
              : 'Стань первым, кто подарит что-нибудь приятное.'}
          </p>
        </div>
      )}
      {error && !receiptOpen && (
        <p className="form-error" role="alert">
          {error}{' '}
          <button onClick={() => setReload((v) => v + 1)}>Повторить</button>
        </p>
      )}
      {page.next && (
        <button
          className="secondary load-more"
          disabled={moreBusy}
          onClick={() => void more()}
        >
          Показать ещё
        </button>
      )}
      <Dialog
        open={receiptOpen}
        onOpenChange={(open) => {
          setReceiptOpen(open);
        }}
      >
        <DialogContent
          className="noct-dialog gift-dialog gift-receipt"
          overlayClassName="gift-backdrop"
        >
          {selected && definition && (
            <>
              <DialogTitle>{definition.name}</DialogTitle>
              <DialogDescription>
                {own ? 'Твой подарок' : 'Подарок в профиле'}
              </DialogDescription>
              <div className="gift-preview" style={color(definition)}>
                <div className="gift-preview-art">
                  <GiftAnimation id={definition.id} />
                </div>
                <div className="gift-recipient">
                  <ProfileLink target={{ id: selected.sender }}>
                    <Avatar
                      person={{
                        name: selected.senderName,
                        avatar: selected.senderAvatar,
                      }}
                      size={28}
                    />
                    <span>от {selected.senderName}</span>
                  </ProfileLink>
                </div>
                {selected.message && (
                  <p className="gift-caption">
                    <MentionText text={selected.message} />
                  </p>
                )}
                <time className="gift-date">
                  {new Date(selected.created).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </time>
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {own && (
                <button
                  className="secondary gift-visibility"
                  disabled={busy}
                  onClick={() => void visibility()}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : selected.hidden ? (
                    <Eye size={17} />
                  ) : (
                    <EyeOff size={17} />
                  )}
                  {selected.hidden ? 'Показать в профиле' : 'Скрыть из профиля'}
                </button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
