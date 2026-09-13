'use client';
import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { chatRequest } from '@/lib/chat-client';

export function ChatNotificationsItem({
  owner,
  peer,
}: {
  owner: string;
  peer: string;
}) {
  const [state, setState] = useState<{ muted: boolean } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lifetime = useRef<{ active: boolean } | null>(null),
    locked = useRef(false);
  useEffect(() => {
    const current = { active: true },
      controller = new AbortController();
    lifetime.current = current;
    if (owner && peer) {
      void chatRequest<{ muted: boolean }>(
        '/api/chat-notifications?' +
          new URLSearchParams({ actor: owner, peer }),
        {
          cache: 'no-store',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        },
      )
        .then((result) => {
          if (current.active) setState(result);
        })
        .catch((e: unknown) => {
          if (current.active && !controller.signal.aborted)
            setError(
              e instanceof Error ? e.message : 'Не удалось загрузить настройку',
            );
        });
    }
    return () => {
      current.active = false;
      controller.abort();
    };
  }, [owner, peer]);
  const toggle = async () => {
    const current = lifetime.current;
    if (!state || locked.current || !current?.active) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await chatRequest<{ muted: boolean }>(
        '/api/chat-notifications',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actor: owner, peer, muted: !state.muted }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (current.active) setState(saved);
    } catch (e) {
      if (current.active)
        setError(
          e instanceof Error ? e.message : 'Не удалось сохранить настройку',
        );
    } finally {
      if (current.active) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <>
      <DropdownMenuItem
        closeOnClick={false}
        disabled={!state || busy}
        onClick={(event) => {
          event.preventDefault();
          void toggle();
        }}
      >
        {state?.muted ? <Bell size={17} /> : <BellOff size={17} />}
        {busy
          ? 'Сохраняем…'
          : !state
            ? 'Уведомления…'
            : state.muted
              ? 'Включить уведомления'
              : 'Выключить уведомления'}
      </DropdownMenuItem>
      {error && (
        <p className="chat-notifications-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
