'use client';
import { useState, type ReactNode } from 'react';
import { authRequest } from '@/lib/auth-client';
export function SignOutButton({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError('');
          void authRequest<{ redirectTo: string }>('logout', {})
            .then((r) => window.location.assign(r.redirectTo))
            .catch((e) => {
              setError(e.message);
              setBusy(false);
            });
        }}
      >
        {children}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
