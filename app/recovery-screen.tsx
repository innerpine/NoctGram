'use client';
/* eslint-disable next/no-html-link-for-pages */
import { useRef, useState } from 'react';
import { KeyRound, ArrowLeft } from 'lucide-react';
import { AuthFrame } from './auth-screen';
import { authRequest } from '@/lib/auth-client';
export function RecoveryScreen() {
  const [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  return (
    <AuthFrame>
      <form
        className="auth-step"
        onSubmit={(e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          void authRequest<{ redirectTo: string }>('recover', { code })
            .then((r) => window.location.assign(r.redirectTo))
            .catch((e) => setError(e.message))
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <span className="auth-symbol">
          <KeyRound size={25} />
        </span>
        <h1>Восстановить доступ</h1>
        <p className="auth-description">
          Введите один из резервных кодов, сохранённых в настройках аккаунта.
          После входа смените почту и сохраните новый набор кодов.
        </p>
        <label className="auth-field">
          Резервный код
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={80}
            required
            disabled={busy}
            placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary auth-submit" disabled={busy || !code.trim()}>
          {busy ? 'Проверяем…' : 'Восстановить доступ'}
        </button>
        <p className="auth-footnote">
          Если резервных кодов нет, восстановите доступ к почтовому ящику у
          почтового сервиса. Одного юзернейма для входа недостаточно.
        </p>
        <a href="/login" className="auth-text-button">
          <ArrowLeft size={16} /> Вход по почте
        </a>
      </form>
    </AuthFrame>
  );
}
