'use client';
/* eslint-disable react/react-compiler, next/no-img-element, next/no-html-link-for-pages */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  LoaderCircle,
  Mail,
  X,
} from 'lucide-react';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { NoctLogo } from './stars-icon';
import {
  authRequest,
  AuthRequestError,
  type AuthStatus,
} from '@/lib/auth-client';
import { upload } from '@/lib/client';
import { SignOutButton } from './sign-out-button';

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <a className="auth-brand" href="/" aria-label="Noctgram — на главную">
        <NoctLogo size={44} />
        <span>noctgram</span>
      </a>
      <section className="auth-card">{children}</section>
    </main>
  );
}
export function EmailLogin() {
  const [status, setStatus] = useState<AuthStatus | null>(null),
    [link, setLink] = useState(false),
    [step, setStep] = useState<'email' | 'code' | 'done'>('email'),
    [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [expiresAt, setExpiresAt] = useState(0),
    [resendAt, setResendAt] = useState(0),
    [now, setNow] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    const linking =
      new URLSearchParams(window.location.search).get('link') === '1';
    setLink(linking);
    setNow(Date.now());
    void authRequest<AuthStatus>('session')
      .then((r) => {
        if (!live) return;
        setStatus(r);
        if (r.challenge && r.challenge.link === linking) {
          setEmail(r.challenge.email);
          setExpiresAt(r.challenge.expiresAt);
          setResendAt(r.challenge.resendAt);
          setStep('code');
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!resendAt && !expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt, expiresAt]);
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof AuthRequestError && e.retryAfter)
        setResendAt(Date.now() + e.retryAfter * 1000);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      const r = await authRequest<{ expiresAt: number; resendAt: number }>(
        'start',
        { email: email.trim(), link },
      );
      setEmail(email.trim());
      setCode('');
      setExpiresAt(r.expiresAt);
      setResendAt(r.resendAt);
      setNow(Date.now());
      setStep('code');
    });
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const expired = !!expiresAt && now >= expiresAt;
  const alreadyIn = status?.user && !link;
  const alreadyLinked = link && status?.user?.email;
  return (
    <AuthFrame>
      {!status ? (
        <>
          <h1>Вход в Noctgram</h1>
          {error ? (
            <>
              <p className="form-error" role="alert">
                {error}
              </p>
              <button
                className="secondary"
                onClick={() => window.location.reload()}
              >
                Повторить
              </button>
            </>
          ) : (
            <output className="auth-loading">
              <LoaderCircle size={20} /> Подготавливаем вход…
            </output>
          )}
        </>
      ) : step === 'done' || alreadyLinked ? (
        <div className="auth-step" key="done">
          <span className="auth-symbol">
            <Check size={25} />
          </span>
          <h1>Почта привязана</h1>
          <p className="auth-description">
            Теперь можно входить по коду, отправленному на{' '}
            <strong>{alreadyLinked || email}</strong>.
          </p>
          <a href="/" className="primary auth-submit">
            Вернуться в Noctgram <ArrowRight size={17} />
          </a>
        </div>
      ) : alreadyIn ? (
        <div className="auth-step" key="signed-in">
          <h1>С возвращением</h1>
          <p className="auth-description">
            Вы вошли как <strong>@{status.user!.handle}</strong>.
          </p>
          <a
            href={status.user!.onboardingComplete ? '/' : '/welcome'}
            className="primary auth-submit"
          >
            Продолжить <ArrowRight size={17} />
          </a>
          {!status.user!.email && (
            <a className="secondary auth-submit" href="/login?link=1">
              Привязать почту для входа
            </a>
          )}
          <SignOutButton className="auth-text-button">
            Войти в другой аккаунт
          </SignOutButton>
        </div>
      ) : link && !status.user ? (
        <div className="auth-step">
          <h1>Сначала войдите</h1>
          <p className="auth-description">
            Чтобы сохранить профиль и публикации, привяжите почту из своего
            аккаунта.
          </p>
          {status.sitesEnabled && (
            <a
              className="primary auth-submit"
              href="/signin-with-chatgpt?return_to=%2Flogin%3Flink%3D1"
              target="_top"
            >
              Войти через ChatGPT
            </a>
          )}
          <a href="/login" className="auth-text-button">
            Войти по почте
          </a>
        </div>
      ) : step === 'email' ? (
        <form
          className="auth-step"
          key="email"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <span className="auth-symbol">
            <Mail size={25} />
          </span>
          <h1>{link ? 'Почта для входа' : 'Войти в Noctgram'}</h1>
          <p className="auth-description">
            {link ? (
              <>
                Привяжите почту к <strong>@{status.user?.handle}</strong>.
                Профиль и публикации сохранятся.
              </>
            ) : (
              'Отправим одноразовый код на вашу почту.'
            )}
          </p>
          <label className="auth-field">
            Электронная почта
            <input
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              disabled={busy}
            />
          </label>
          {!status.emailEnabled && (
            <output className="auth-info">
              Отправка писем ещё не подключена.
              {status.sitesEnabled ? ' Пока доступен вход через ChatGPT.' : ''}
            </output>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary auth-submit"
            disabled={busy || !status.emailEnabled || wait > 0}
          >
            {busy ? (
              <>
                <LoaderCircle size={17} className="auth-spin" /> Отправляем…
              </>
            ) : wait > 0 ? (
              `Повторить через ${wait} с`
            ) : (
              <>
                Получить код <ArrowRight size={17} />
              </>
            )}
          </button>
          {!link && (
            <p className="auth-footnote">
              Впервые здесь? После подтверждения почты выберите имя, юзернейм и
              аватарку.
            </p>
          )}
          {status.sitesEnabled && !link && (
            <>
              <div className="auth-divider">
                <span>или</span>
              </div>
              <a
                className="secondary auth-submit"
                href="/signin-with-chatgpt?return_to=%2F"
                target="_top"
              >
                Войти через ChatGPT
              </a>
            </>
          )}
          {link && (
            <a className="auth-text-button" href="/">
              Вернуться в профиль
            </a>
          )}
        </form>
      ) : (
        <form
          className="auth-step"
          key="code"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await authRequest<{
                linked: boolean;
                redirectTo: string;
              }>('verify', { code });
              if (r.linked) setStep('done');
              else window.location.replace(r.redirectTo);
            });
          }}
        >
          <button
            type="button"
            className="auth-back"
            disabled={busy}
            onClick={() => {
              setStep('email');
              setCode('');
              setError('');
            }}
          >
            <ArrowLeft size={16} /> Изменить почту
          </button>
          <h1>Проверьте почту</h1>
          <p className="auth-description">
            Введите шесть цифр из письма, отправленного на{' '}
            <strong>{email}</strong>.
          </p>
          <InputOTP
            maxLength={6}
            value={code}
            onChange={(v) => {
              setCode(v);
              setError('');
            }}
            pattern="^[0-9]*$"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Код из письма"
            aria-invalid={!!error}
            disabled={busy || expired}
            containerClassName="auth-otp"
          >
            <InputOTPGroup>
              {Array.from({ length: 6 }, (_, i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <p className="auth-footnote">
            {expired
              ? 'Код истёк. Запросите новое письмо.'
              : 'Код действует 5 минут. Если письма нет, проверьте «Спам».'}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary auth-submit"
            disabled={busy || code.length !== 6 || expired}
          >
            {busy ? (
              <>
                <LoaderCircle size={17} className="auth-spin" /> Проверяем…
              </>
            ) : (
              'Подтвердить и продолжить'
            )}
          </button>
          <button
            className="auth-text-button"
            type="button"
            disabled={busy || wait > 0}
            onClick={() => void send()}
          >
            {wait > 0
              ? `Отправить снова через ${wait} с`
              : 'Отправить код ещё раз'}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}

export function WelcomeProfile() {
  const [ready, setReady] = useState(false),
    [name, setName] = useState(''),
    [handle, setHandle] = useState(''),
    [avatar, setAvatar] = useState(''),
    [uploading, setUploading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null),
    lock = useRef(false);
  useEffect(() => {
    let live = true;
    void authRequest<AuthStatus>('session')
      .then((r) => {
        if (!live) return;
        if (!r.user) return window.location.replace('/login');
        if (r.user.onboardingComplete) return window.location.replace('/');
        setReady(true);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <AuthFrame>
      {!ready ? (
        <>
          <h1>Ваш профиль</h1>
          {error ? (
            <>
              <p className="form-error" role="alert">
                {error}
              </p>
              <button
                className="secondary"
                onClick={() => window.location.reload()}
              >
                Повторить
              </button>
            </>
          ) : (
            <output className="auth-loading">
              <LoaderCircle size={20} /> Загружаем…
            </output>
          )}
        </>
      ) : (
        <form
          className="auth-step"
          onSubmit={(e) => {
            e.preventDefault();
            if (lock.current || uploading) return;
            lock.current = true;
            setBusy(true);
            setError('');
            void authRequest<{ redirectTo: string }>('onboarding', {
              name,
              handle,
              avatar,
            })
              .then((r) => window.location.replace(r.redirectTo))
              .catch((e) => {
                if (e instanceof AuthRequestError && e.status === 401)
                  return window.location.replace('/login');
                setError(e.message);
              })
              .finally(() => {
                lock.current = false;
                setBusy(false);
              });
          }}
        >
          <div className="auth-eyebrow">
            <Check size={14} /> Почта подтверждена
          </div>
          <h1>Как вас представить?</h1>
          <p className="auth-description">
            Добавьте немного себя. Всё это можно изменить в профиле.
          </p>
          <div className="auth-avatar-row">
            <button
              type="button"
              className="auth-avatar"
              aria-label={avatar ? 'Изменить аватарку' : 'Добавить аватарку'}
              disabled={busy || uploading}
              onClick={() => fileRef.current?.click()}
            >
              {avatar ? (
                <img src={avatar} alt="Ваша аватарка" />
              ) : (
                <Camera size={27} strokeWidth={1.5} />
              )}
              {uploading && (
                <span className="auth-avatar-loading">
                  <LoaderCircle size={24} className="auth-spin" />
                </span>
              )}
            </button>
            <div>
              <button
                className="auth-text-button"
                type="button"
                disabled={busy || uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading
                  ? 'Загружаем…'
                  : avatar
                    ? 'Выбрать другое фото'
                    : 'Загрузить аватарку'}
              </button>
              <p className="auth-footnote">До 5 МБ · Можно добавить позже</p>
              {avatar && (
                <button
                  className="auth-remove"
                  type="button"
                  disabled={busy || uploading}
                  onClick={() => setAvatar('')}
                >
                  <X size={13} /> Убрать фото
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file || busy || uploading) return;
                if (file.size > 5 * 1024 * 1024)
                  return setError('Аватарка должна быть меньше 5 МБ.');
                setUploading(true);
                setError('');
                void upload(file)
                  .then((m) => setAvatar(m.url!))
                  .catch((e) => setError(e.message))
                  .finally(() => setUploading(false));
              }}
            />
          </div>
          <label className="auth-field">
            Имя
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как вас зовут?"
              autoComplete="off"
              required
              maxLength={40}
              disabled={busy}
            />
          </label>
          <label className="auth-field">
            Юзернейм
            <input
              value={handle}
              onChange={(e) =>
                setHandle(e.target.value.replace(/^@/, '').toLowerCase())
              }
              placeholder="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              minLength={4}
              maxLength={24}
              pattern="[a-zA-Z0-9_]{4,24}"
              disabled={busy}
            />
          </label>
          <p className="auth-footnote">
            4–24 латинские буквы, цифры или _. По @{handle || 'username'} вас
            смогут найти.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary auth-submit"
            disabled={busy || uploading || !name.trim() || handle.length < 4}
          >
            {busy ? (
              <>
                <LoaderCircle size={17} className="auth-spin" /> Сохраняем…
              </>
            ) : (
              <>
                Начать общение <ArrowRight size={17} />
              </>
            )}
          </button>
          <SignOutButton className="auth-text-button">Выйти</SignOutButton>
        </form>
      )}
    </AuthFrame>
  );
}
