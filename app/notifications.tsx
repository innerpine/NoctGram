'use client';
import { DisplayName } from './profile-identity';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  Check,
  Phone,
  MessageCircle,
  Newspaper,
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
}: {
  me: string;
  onPost: (id: string) => void;
  onChat: (id: string) => void;
}) {
  const [rows, setRows] = useState<NotificationRow[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true,
      t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const data = await request<NotificationRow[]>('?action=notifications');
        if (!live) return;
        setRows(data);
        setError('');
        if (open && data.some((n) => !n.read)) {
          await request('', {
            action: 'readNotifications',
            before: Math.max(...data.map((n) => n.created)),
          });
          if (live) setRows(data.map((n) => ({ ...n, read: 1 })));
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) t = setTimeout(tick, 8000);
      }
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [me, open]);
  const unread = rows.filter((n) => !n.read).length;
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
                <button
                  key={n.id}
                  className={'notification-row ' + (!n.read ? 'unread' : '')}
                  onClick={() => {
                    setOpen(false);
                    if (n.kind === 'post') onPost(n.targetId);
                    else onChat(n.actorId);
                  }}
                >
                  <Avatar person={n} size={38} />
                  <span>
                    <strong>
                      <DisplayName person={n} />
                    </strong>
                    <small>
                      {n.kind === 'call' ? (
                        <Phone size={13} />
                      ) : n.kind === 'post' ? (
                        <Newspaper size={13} />
                      ) : (
                        <MessageCircle size={13} />
                      )}{' '}
                      {n.kind === 'call'
                        ? 'Аудиозвонок'
                        : n.kind === 'post'
                          ? 'Новая публикация'
                          : 'Новое сообщение'}
                    </small>
                  </span>
                  <time>
                    {new Date(n.created).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </time>
                </button>
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
