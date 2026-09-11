'use client';
import { useEffect, useState } from 'react';
import { ArrowLeftRight, Check, LoaderCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { authRequest } from '@/lib/auth-client';
import type { Person } from '@/lib/client';
import { Avatar } from './post-card';

type Accounts = { principalId: string; activeId: string; accounts: Person[] };
let pageInstance = '';
export function AccountSwitcher({ userId }: { userId: string }) {
  const [data, setData] = useState<Accounts | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    // Initialize only in the browser, never at Cloudflare module startup.
    pageInstance ||= crypto.randomUUID();
    let disposed = false;
    void authRequest<Accounts>('accounts')
      .then((value) => {
        if (!disposed) setData(value);
      })
      .catch(() => {});
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('noct-account-switch');
    if (channel)
      channel.onmessage = (event) => {
        if (event.data !== pageInstance) window.location.reload();
      };
    return () => {
      disposed = true;
      channel?.close();
    };
  }, [userId]);
  if (!data || (data.accounts.length < 2 && data.activeId === data.principalId))
    return null;
  async function select(accountId: string) {
    setBusy(accountId);
    setError('');
    try {
      const result = await authRequest<{ redirectTo: string }>(
        'switch-account',
        { accountId },
      );
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('noct-account-switch');
        channel.postMessage(pageInstance);
        channel.close();
      }
      window.location.assign(result.redirectTo);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось переключить аккаунт.',
      );
      setBusy('');
    }
  }
  return (
    <>
      <button
        type="button"
        className="managed-account-trigger"
        onClick={() => setOpen(true)}
      >
        <ArrowLeftRight size={17} />
        <span>Сменить аккаунт</span>
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="managed-account-dialog">
          <DialogTitle>Ваши аккаунты</DialogTitle>
          <DialogDescription>
            Выберите, от чьего имени пользоваться Noctgram.
          </DialogDescription>
          <div className="managed-account-list">
            {data.accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className="managed-account-option"
                aria-pressed={data.activeId === account.id}
                disabled={!!busy}
                onClick={() => void select(account.id)}
              >
                <Avatar person={account} />
                <span>
                  <strong>{account.name}</strong>
                  <small>
                    @{account.handle} ·{' '}
                    {account.id === data.principalId
                      ? 'Личный аккаунт'
                      : 'Общий аккаунт'}
                  </small>
                </span>
                {busy === account.id ? (
                  <LoaderCircle size={18} className="spin" />
                ) : data.activeId === account.id ? (
                  <Check size={18} />
                ) : null}
              </button>
            ))}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
