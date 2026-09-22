'use client';
/* eslint-disable react/react-compiler, next/no-img-element */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  BellRing,
  Check,
  Gift,
  Heart,
  MessageCircle,
  MessageSquareText,
  Newspaper,
  Phone,
  Star,
  Store,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { request, type Person } from '@/lib/client';
import { DisplayName } from './profile-identity';
import { Avatar, Stamp } from './post-card';

// Enriched by lib/notifications.ts: the post, comment or lot an event is about.
type NotificationRow = Person & {
  actorId: string;
  kind: string;
  targetId: string;
  created: number;
  read: number;
  giftRecipient?: string | null;
  postId?: string | null;
  postText?: string | null;
  postImage?: string | null;
  commentText?: string | null;
  others?: number;
  amount?: number;
  lotTitle?: string | null;
  lotKind?: string | null;
  lotKey?: string | null;
};
type Described = {
  Icon: LucideIcon;
  tone: string;
  text: string;
  quote?: string | null;
  amount?: string;
};
const stars = (value = 0) => value.toLocaleString('ru-RU');
function describe(n: NotificationRow, me: string): Described {
  if (n.kind === 'like')
    return {
      Icon: Heart,
      tone: 'like',
      text: 'Нравится твоя публикация',
      quote: n.postText,
    };
  if (n.kind === 'comment')
    return {
      Icon: MessageSquareText,
      tone: 'comment',
      text: 'Комментарий к твоей публикации',
      quote: n.commentText,
    };
  if (n.kind === 'follow')
    return { Icon: UserPlus, tone: 'follow', text: 'Новый подписчик' };
  if (n.kind === 'support')
    return {
      Icon: Star,
      tone: 'stars',
      text: 'Поддержка публикации',
      quote: n.postText,
      amount: stars(n.amount) + ' Stars',
    };
  if (n.kind === 'market')
    return {
      Icon: Store,
      tone: 'stars',
      text: 'Покупка в Маркете: ' + (n.lotTitle || 'лот'),
      amount: '+' + stars(n.amount) + ' Stars',
    };
  if (n.kind === 'gift')
    return {
      Icon: Gift,
      tone: 'gift',
      text:
        n.giftRecipient && n.giftRecipient !== me
          ? 'Подарок твоему каналу'
          : 'Новый подарок',
    };
  if (n.kind === 'call')
    return { Icon: Phone, tone: 'call', text: 'Аудиозвонок' };
  if (n.kind === 'post')
    return {
      Icon: Newspaper,
      tone: 'post',
      text: 'Новая публикация',
      quote: n.postText,
    };
  return { Icon: MessageCircle, tone: 'message', text: 'Новое сообщение' };
}
const filters = [
  { id: 'all', label: 'Все', kinds: '' },
  { id: 'reactions', label: 'Реакции', kinds: 'like,support' },
  { id: 'comments', label: 'Комментарии', kinds: 'comment' },
  { id: 'follows', label: 'Подписчики', kinds: 'follow' },
  { id: 'messages', label: 'Сообщения', kinds: 'message,call,gift' },
];
const kindsOf = (id: string) => filters.find((f) => f.id === id)?.kinds || '';
const PAGE = 30;
const titleCount = /^\(\d+\+?\) /;

/** Avatar with a small coloured badge that says what happened. */
function Face({
  n,
  d,
  size,
}: {
  n: NotificationRow;
  d: Described;
  size: number;
}) {
  return (
    <span className="notification-face">
      <Avatar person={n} size={size} />
      <i className="notification-kind" data-tone={d.tone} aria-hidden="true">
        <d.Icon size={11} strokeWidth={2.6} />
      </i>
    </span>
  );
}
function Who({ n }: { n: NotificationRow }) {
  return (
    <strong className="notification-name">
      <DisplayName person={n} />
      {!!n.others && <span> и ещё {n.others}</span>}
    </strong>
  );
}

function vapidBytes(value: string) {
  return Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );
}
async function worker() {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}
export function PushSettings() {
  const [config, setConfig] = useState<{
      publicKey: string | null;
      enabled: boolean;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [supported, setSupported] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    setSupported(
      window.isSecureContext &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window,
    );
    request<{ publicKey: string | null; enabled: boolean }>(
      '?action=pushConfig',
    )
      .then((c) => {
        if (live) setConfig(c);
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function toggle() {
    if (lock.current || !config) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (config.enabled) {
        await request('', { action: 'pushUnsubscribe' });
        setConfig({ ...config, enabled: false });
        if ('serviceWorker' in navigator) {
          try {
            const reg = await navigator.serviceWorker.getRegistration('/');
            await (await reg?.pushManager.getSubscription())?.unsubscribe();
          } catch {
            /* Server delivery is already disabled. */
          }
        }
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted')
          throw new Error(
            permission === 'denied'
              ? 'Разреши уведомления в настройках сайта в браузере.'
              : 'Уведомления остались выключены.',
          );
        const reg = await worker();
        let sub = await reg.pushManager.getSubscription();
        const key = vapidBytes(config.publicKey!);
        if (
          sub &&
          sub.options.applicationServerKey &&
          String(new Uint8Array(sub.options.applicationServerKey)) !==
            String(key)
        ) {
          await sub.unsubscribe();
          sub = null;
        }
        sub ||= await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        await request('', {
          action: 'pushSubscribe',
          subscription: sub.toJSON(),
        });
        setConfig({ ...config, enabled: true });
        setMessage('Уведомления включены на этом устройстве.');
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="push-settings">
      <div className="row">
        <BellRing size={19} />
        <strong>Push-уведомления</strong>
      </div>
      <p className="meta">
        Сообщения, звонки, реакции, комментарии и новые подписчики — даже когда
        вкладка закрыта.
      </p>
      <button
        className="secondary"
        disabled={
          busy ||
          !config ||
          (!config.enabled && (!supported || !config.publicKey))
        }
        onClick={() => void toggle()}
      >
        {config?.enabled ? <Check size={16} /> : <Bell size={16} />}{' '}
        {busy
          ? 'Подключаем…'
          : config?.enabled
            ? 'Выключить на этом устройстве'
            : 'Включить на этом устройстве'}
      </button>
      {!supported ? (
        <p className="meta">
          Нужен браузер с поддержкой push и HTTPS или localhost. На iPhone
          добавь Noctgram на экран «Домой» и открой его оттуда.
        </p>
      ) : (
        config &&
        !config.publicKey && (
          <p className="meta">Сервис уведомлений ещё не подключён.</p>
        )
      )}
      {message && <output className="meta">{message}</output>}
    </section>
  );
}
export function NotificationsBell({
  me,
  activeChat,
  onPost,
  onChat,
  onGift,
  onProfile,
}: {
  me: string;
  /** The dialogue on screen: its messages need no pop-up. */
  activeChat?: string;
  onPost: (id: string) => void;
  onChat: (id: string) => void;
  onGift: (recipient?: string) => void;
  onProfile: (id: string) => void;
}) {
  const [rows, setRows] = useState<NotificationRow[]>([]),
    [unread, setUnread] = useState(0),
    [open, setOpen] = useState(false),
    [filter, setFilter] = useState('all'),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [error, setError] = useState(''),
    [toasts, setToasts] = useState<NotificationRow[]>([]),
    [mounted, setMounted] = useState(false);
  const since = useRef(0),
    shown = useRef(new Set<string>()),
    chat = useRef(activeChat),
    generation = useRef(0),
    marked = useRef(false);
  chat.current = activeChat;
  useEffect(() => setMounted(true), []);

  // Closed: a light count every 15 s, plus the events that arrived since the
  // server time of the previous check. Those become pop-ups.
  useEffect(() => {
    if (open) return;
    let live = true,
      t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (document.hidden) return;
        const data = await request<{
          unread: number;
          latest: NotificationRow[];
          now: number;
        }>('?action=notificationCount&since=' + since.current);
        if (!live) return;
        setUnread(data.unread);
        setError('');
        const fresh = data.latest.filter((n) => {
          const key = n.id + ':' + n.created;
          if (shown.current.has(key)) return false;
          shown.current.add(key);
          // Calls ring on their own; an open dialogue already shows its messages.
          return (
            n.kind !== 'call' &&
            !(n.kind === 'message' && n.actorId === chat.current)
          );
        });
        if (fresh.length)
          setToasts((current) => [...fresh, ...current].slice(0, 3));
        since.current = data.now;
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) t = setTimeout(tick, 15000);
      }
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [me, open]);

  // A background tab shows the count in its title.
  useEffect(() => {
    const base = document.title.replace(titleCount, '');
    document.title = unread ? `(${unread > 9 ? '9+' : unread}) ${base}` : base;
    return () => {
      document.title = document.title.replace(titleCount, '');
    };
  }, [unread]);

  const load = useCallback(async (kinds: string, after?: NotificationRow) => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const page = await request<NotificationRow[]>(
        '?action=notifications&kinds=' +
          encodeURIComponent(kinds) +
          (after
            ? '&before=' +
              after.created +
              '&beforeId=' +
              encodeURIComponent(after.id)
            : ''),
      );
      if (current !== generation.current) return;
      setRows((old) => (after ? [...old, ...page] : page));
      setMore(page.length === PAGE);
      setError('');
      // Opening the bell reads everything it shows. Rows keep their
      // highlight until the next visit, so the new ones stay findable.
      if (!marked.current && page.some((n) => !n.read)) {
        marked.current = true;
        await request('', {
          action: 'readNotifications',
          before: Math.max(...page.map((n) => n.created)),
        });
        setUnread(0);
      }
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  const show = (value: boolean) => {
    setOpen(value);
    if (!value) return;
    marked.current = false;
    setFilter('all');
    setToasts([]);
    setRows([]);
    void load('');
  };
  const pick = (id: string) => {
    setFilter(id);
    setRows([]);
    void load(kindsOf(id));
  };
  const go = (n: NotificationRow) => {
    setOpen(false);
    setToasts((current) => current.filter((t) => t.id !== n.id));
    if (n.kind === 'gift') onGift(n.giftRecipient || undefined);
    else if (n.kind === 'follow') onProfile(n.actorId);
    else if (n.kind === 'market')
      window.location.assign(
        n.lotKind && n.lotKey
          ? '/market?lot=' + n.lotKind + '&key=' + encodeURIComponent(n.lotKey)
          : '/market?view=assets',
      );
    else if (
      n.postId &&
      ['like', 'comment', 'support', 'post'].includes(n.kind)
    )
      onPost(n.postId);
    else onChat(n.actorId);
  };

  return (
    <>
      <button
        className="icon-button notifications-bell"
        aria-label={'Уведомления' + (unread ? `, ${unread} новых` : '')}
        onClick={() => show(true)}
      >
        <Bell size={19} />
        {unread > 0 && <i>{unread > 9 ? '9+' : unread}</i>}
      </button>
      <Dialog open={open} onOpenChange={show}>
        <DialogContent className="noct-dialog notifications-dialog">
          <DialogTitle>Уведомления</DialogTitle>
          <DialogDescription>
            Реакции, комментарии, подписчики и сообщения.
          </DialogDescription>
          <div className="notification-filters">
            {filters.map((f) => (
              <button
                key={f.id}
                aria-pressed={filter === f.id}
                onClick={() => pick(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {error && (
            <p className="realtime-error" role="alert">
              {error}
            </p>
          )}
          <div className="notification-list" aria-busy={loading}>
            {rows.map((n) => {
              const d = describe(n, me);
              return (
                <button
                  key={n.id}
                  className={'notification-row' + (n.read ? '' : ' unread')}
                  onClick={() => go(n)}
                >
                  <Face n={n} d={d} size={42} />
                  <span className="notification-copy">
                    <Who n={n} />
                    <span className="notification-action">
                      {d.text}
                      {d.amount && (
                        <b className="notification-amount"> · {d.amount}</b>
                      )}
                    </span>
                    {d.quote && (
                      <span className="notification-quote">{d.quote}</span>
                    )}
                  </span>
                  <span className="notification-side">
                    <Stamp time={n.created} compact />
                    {n.postImage && (
                      <img
                        className="notification-thumb"
                        src={'/api/media/' + encodeURIComponent(n.postImage)}
                        alt=""
                        loading="lazy"
                      />
                    )}
                  </span>
                </button>
              );
            })}
            {!rows.length && !loading && !error && (
              <p className="realtime-empty">
                {filter === 'all'
                  ? 'Здесь появятся реакции, комментарии и новые подписчики.'
                  : 'Таких уведомлений пока нет.'}
              </p>
            )}
            {!rows.length &&
              loading &&
              [0, 1, 2].map((i) => (
                <span key={i} className="notification-skeleton" />
              ))}
          </div>
          {more && (
            <button
              className="secondary notification-more"
              disabled={loading}
              onClick={() => void load(kindsOf(filter), rows.at(-1))}
            >
              {loading ? 'Загружаем…' : 'Показать ещё'}
            </button>
          )}
          <PushSettings />
        </DialogContent>
      </Dialog>
      {mounted &&
        createPortal(
          <section
            className="notification-toasts"
            aria-label="Новые уведомления"
            aria-live="polite"
          >
            {toasts.map((n) => (
              <Toast
                key={n.id + ':' + n.created}
                n={n}
                d={describe(n, me)}
                onOpen={() => go(n)}
                onClose={() =>
                  setToasts((current) => current.filter((t) => t !== n))
                }
              />
            ))}
          </section>,
          document.body,
        )}
    </>
  );
}

/** A pop-up that leaves after six seconds, but not while the pointer is on it. */
function Toast({
  n,
  d,
  onOpen,
  onClose,
}: {
  n: NotificationRow;
  d: Described;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [hover, setHover] = useState(false),
    [leaving, setLeaving] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (hover || leaving) return;
    const t = setTimeout(() => setLeaving(true), 6000);
    return () => clearTimeout(t);
  }, [hover, leaving]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => close.current(), 200);
    return () => clearTimeout(t);
  }, [leaving]);
  return (
    <div
      className={'notification-toast' + (leaving ? ' leaving' : '')}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button className="notification-toast-open" onClick={onOpen}>
        <Face n={n} d={d} size={38} />
        <span className="notification-copy">
          <Who n={n} />
          <span className="notification-action">
            {d.quote ? d.text + ': ' + d.quote : d.text}
            {d.amount && <b className="notification-amount"> · {d.amount}</b>}
          </span>
        </span>
      </button>
      <button
        className="notification-toast-close"
        aria-label="Скрыть уведомление"
        onClick={() => setLeaving(true)}
      >
        <X size={15} />
      </button>
    </div>
  );
}
