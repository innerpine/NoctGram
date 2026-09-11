'use client';
import { DisplayName } from './profile-identity';
import { reconcileSnapshot } from '@/lib/reconcile-snapshot';
import { ProfileLink } from './profile-link';
/* eslint-disable react/react-compiler */
import { useEffect, useId, useRef, useState } from 'react';
import { Switch } from '@base-ui/react/switch';
import {
  Bell,
  BellRing,
  Check,
  Phone,
  MessageCircle,
  Newspaper,
  Gift,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { request, type Person } from '@/lib/client';
import { Avatar } from './post-card';
type NotificationRow = Person & {
  actorId: string;
  kind: string;
  targetId: string;
  created: number;
  read: number;
};
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
export function PushSettings({ compact = false }: { compact?: boolean }) {
  const id = useId();
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
      {compact ? (
        <div className="push-setting-row">
          <span>
            <label htmlFor={id}>
              <strong id={id + '-label'}>Уведомления на этом устройстве</strong>
            </label>
            <small id={id + '-note'}>
              Сообщения, звонки и новые публикации — даже когда вкладка закрыта.
            </small>
          </span>
          <Switch.Root
            id={id}
            className="privacy-switch push-switch"
            aria-labelledby={id + '-label'}
            aria-describedby={id + '-note'}
            checked={!!config?.enabled}
            disabled={
              busy ||
              !config ||
              (!config.enabled && (!supported || !config.publicKey))
            }
            onCheckedChange={() => void toggle()}
          >
            <Switch.Thumb className="privacy-switch-thumb" />
          </Switch.Root>
        </div>
      ) : (
        <>
          <div className="row">
            <BellRing size={19} />
            <strong>Push-уведомления</strong>
          </div>
          <p className="meta">
            Сообщения, аудиозвонки и посты твоих подписок — даже когда вкладка
            закрыта.
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
        </>
      )}
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
  onPost,
  onChat,
  onGift,
}: {
  me: string;
  onPost: (id: string) => void;
  onChat: (id: string) => void;
  onGift: () => void;
}) {
  const [rows, setRows] = useState<NotificationRow[]>([]),
    [unread, setUnread] = useState(0),
    [open, setOpen] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true,
      t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (document.hidden) return;
        if (!open) {
          const data = await request<{ unread: number }>(
            '?action=notificationCount',
          );
          if (live) {
            setUnread(data.unread);
            setError('');
          }
          return;
        }
        const data = await request<NotificationRow[]>('?action=notifications');
        if (!live) return;
        setRows((previous) => reconcileSnapshot(previous, data));
        setUnread(data.filter((n) => !n.read).length);
        setError('');
        if (open && data.some((n) => !n.read)) {
          await request('', {
            action: 'readNotifications',
            before: Math.max(...data.map((n) => n.created)),
          });
          if (live) {
            setRows(data.map((n) => ({ ...n, read: 1 })));
            setUnread(0);
          }
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) t = setTimeout(tick, open ? 8000 : 15000);
      }
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [me, open]);
  return (
    <>
      <button
        className="icon-button notifications-bell"
        aria-label={'Уведомления' + (unread ? `, ${unread} новых` : '')}
        onClick={() => setOpen(true)}
      >
        <Bell size={19} />
        {unread > 0 && <i>{unread > 9 ? '9+' : unread}</i>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="noct-dialog">
          <DialogTitle>Уведомления</DialogTitle>
          <DialogDescription>Важное от твоих людей.</DialogDescription>
          <PushSettings />
          {error && (
            <p className="realtime-error" role="alert">
              {error}
            </p>
          )}
          <div className="notification-list">
            {rows.length ? (
              rows.map((n) => (
                <div
                  key={n.id}
                  className={'notification-row ' + (!n.read ? 'unread' : '')}
                >
                  <ProfileLink
                    target={{ id: n.actorId }}
                    aria-label={'Профиль ' + n.name}
                  >
                    <Avatar person={n} size={38} />
                  </ProfileLink>
                  <span className="notification-copy">
                    <strong>
                      <ProfileLink target={{ id: n.actorId }}>
                        <DisplayName person={n} />
                      </ProfileLink>
                    </strong>
                    <small>
                      <button
                        className="notification-open"
                        onClick={() => {
                          setOpen(false);
                          if (n.kind === 'gift') onGift();
                          else if (n.kind === 'post') onPost(n.targetId);
                          else onChat(n.actorId);
                        }}
                      >
                        {n.kind === 'gift' ? (
                          <Gift size={13} />
                        ) : n.kind === 'call' ? (
                          <Phone size={13} />
                        ) : n.kind === 'post' ? (
                          <Newspaper size={13} />
                        ) : (
                          <MessageCircle size={13} />
                        )}{' '}
                        {n.kind === 'gift'
                          ? 'Новый подарок'
                          : n.kind === 'call'
                            ? 'Аудиозвонок'
                            : n.kind === 'post'
                              ? 'Новая публикация'
                              : 'Новое сообщение'}
                      </button>
                    </small>
                  </span>
                  <time>
                    {new Date(n.created).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </time>
                </div>
              ))
            ) : (
              <p className="realtime-empty">Здесь появятся новые события.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
