'use client';
/* eslint-disable react/react-compiler, next/no-html-link-for-pages */
import { useEffect, useRef, useState } from 'react';
import {
  Mail,
  KeyRound,
  LogOut,
  Trash2,
  HardDrive,
  Download,
  ShieldCheck,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { authRequest } from '@/lib/auth-client';
type Status = {
  email: string | null;
  emailSession: boolean;
  verifiedUntil: number;
  sessions: number;
  recoveryCodes: number;
  channels: { name: string; handle: string }[];
  storage: {
    bytes: number;
    files: number;
    limitBytes: number;
    limitFiles: number;
  };
};
type Challenge = {
  challengeId: string;
  email: string;
  expiresAt: number;
  resendAt: number;
  kind: 'reauth' | 'change';
};
export function AccountPanel() {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(''),
    [challenge, setChallenge] = useState<Challenge | null>(null),
    [code, setCode] = useState(''),
    [codes, setCodes] = useState<string[]>([]),
    [remove, setRemove] = useState(false),
    [confirm, setConfirm] = useState(''),
    [channels, setChannels] = useState(false),
    [now, setNow] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    void authRequest<Status>('account')
      .then((r) => {
        if (live) setStatus(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const refresh = async () => setStatus(await authRequest<Status>('account'));
  const fresh = !!status && status.verifiedUntil > now;
  const start = (kind: 'reauth' | 'change') =>
    void run(async () => {
      const r = await authRequest<Omit<Challenge, 'kind'>>(
        kind === 'reauth' ? 'reauth-start' : 'email-change-start',
        kind === 'reauth' ? {} : { email },
      );
      setChallenge({ ...r, kind });
      setCode('');
    });
  const download = () => {
    const blob = new Blob(
      [
        'NoctGram — резервные коды\nКаждый код используется один раз. Храните их отдельно от почты. Действуют 1 год.\n\n' +
          codes.join('\n'),
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'noctgram-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="account-panel">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="moderation-notice">{notice}</output>}
      {!status ? (
        <output className="meta">Загружаем настройки…</output>
      ) : (
        <>
          <section className="account-section">
            <div className="account-section-heading">
              <Mail size={20} />
              <div>
                <h3>Почта и доступ</h3>
                <p>{status.email || 'Почта ещё не привязана'}</p>
              </div>
            </div>
            {!status.emailSession ? (
              <>
                <p>Для управления доступом войдите через привязанную почту.</p>
                <a
                  className="secondary"
                  href={status.email ? '/login' : '/login?link=1'}
                >
                  {status.email ? 'Войти по почте' : 'Привязать почту'}
                </a>
              </>
            ) : (
              <>
                {!fresh && !challenge && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => start('reauth')}
                  >
                    <ShieldCheck size={16} /> Подтвердить доступ кодом
                  </button>
                )}
                {fresh && !challenge && (
                  <p className="account-proof">
                    <ShieldCheck size={15} /> Доступ подтверждён на несколько
                    минут
                  </p>
                )}
                {challenge ? (
                  <form
                    className="account-code"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await authRequest(
                          challenge.kind === 'reauth'
                            ? 'reauth-verify'
                            : 'email-change-verify',
                          { challengeId: challenge.challengeId, code },
                        );
                        setChallenge(null);
                        setCode('');
                        setCodes([]);
                        setNotice(
                          challenge.kind === 'reauth'
                            ? 'Доступ подтверждён.'
                            : 'Почта изменена. Остальные устройства отключены. Сохраните новый набор резервных кодов.',
                        );
                        await refresh();
                      });
                    }}
                  >
                    <p>
                      Введите код, отправленный на{' '}
                      <strong>{challenge.email}</strong>
                    </p>
                    <InputOTP
                      maxLength={6}
                      value={code}
                      onChange={setCode}
                      disabled={busy}
                      aria-label="Код из письма"
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }, (_, i) => (
                          <InputOTPSlot key={i} index={i} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                    <div className="account-actions">
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          code.length !== 6 ||
                          now >= challenge.expiresAt
                        }
                      >
                        Подтвердить
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || now < challenge.resendAt}
                        onClick={() => start(challenge.kind)}
                      >
                        {now < challenge.resendAt
                          ? `Повторить через ${Math.ceil((challenge.resendAt - now) / 1000)} с`
                          : 'Отправить снова'}
                      </button>
                      <button
                        type="button"
                        className="account-text-button"
                        disabled={busy}
                        onClick={() => setChallenge(null)}
                      >
                        Отмена
                      </button>
                    </div>
                    {now >= challenge.expiresAt && (
                      <p className="form-error">
                        Срок кода истёк. Запросите новый.
                      </p>
                    )}
                  </form>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      start('change');
                    }}
                  >
                    <label className="account-field">
                      Новая почта
                      <input
                        type="email"
                        autoComplete="email"
                        maxLength={254}
                        required
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={busy || !fresh}
                      />
                    </label>
                    <button
                      className="secondary"
                      disabled={busy || !fresh || !email}
                    >
                      Сменить почту
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
          <section className="account-section">
            <div className="account-section-heading">
              <KeyRound size={20} />
              <div>
                <h3>Резервные коды</h3>
                <p>Для входа, если доступ к почте потеряется</p>
              </div>
            </div>
            <p>
              Осталось кодов: {status.recoveryCodes}. Каждый действует один раз
              в течение года. Новый набор заменяет предыдущий.
            </p>
            <button
              className="secondary"
              disabled={busy || !fresh}
              onClick={() =>
                void run(async () => {
                  const r = await authRequest<{ codes: string[] }>(
                    'recovery-codes',
                    {},
                  );
                  setCodes(r.codes);
                  await refresh();
                })
              }
            >
              {status.recoveryCodes
                ? 'Заменить резервные коды'
                : 'Создать резервные коды'}
            </button>
            {codes.length > 0 && (
              <div className="recovery-codes">
                <p>Сохраните сейчас: повторно показать эти коды нельзя.</p>
                <div>
                  {codes.map((c) => (
                    <code key={c}>{c}</code>
                  ))}
                </div>
                <button className="primary" onClick={download}>
                  <Download size={16} /> Скачать коды
                </button>
              </div>
            )}
          </section>
          <section className="account-section">
            <div className="account-section-heading">
              <LogOut size={20} />
              <div>
                <h3>Устройства</h3>
                <p>Активных сессий: {status.sessions}</p>
              </div>
            </div>
            <p>
              Выход завершит все сессии входа по почте, включая текущую, звонки
              и push-подписки.
            </p>
            <button
              className="secondary"
              disabled={busy || !status.emailSession}
              onClick={() =>
                void run(async () => {
                  await authRequest('logout-all', {});
                  window.location.assign('/login');
                })
              }
            >
              Выйти со всех устройств
            </button>
          </section>
          <section className="account-section">
            <div className="account-section-heading">
              <HardDrive size={20} />
              <div>
                <h3>Вложения</h3>
                <p>
                  {(status.storage.bytes / 1048576).toFixed(1)} из 512 МБ ·{' '}
                  {status.storage.files} из 500 файлов
                </p>
              </div>
            </div>
            <progress
              value={status.storage.bytes}
              max={status.storage.limitBytes}
              aria-label="Использовано хранилища"
            />
            <p>
              Неиспользуемые вложения очищаются автоматически, не раньше чем
              через 24 часа после загрузки. Личные аудиофайлы имеют отдельную
              квоту 512 МБ.
            </p>
          </section>
          <section className="account-section account-danger">
            <div className="account-section-heading">
              <Trash2 size={20} />
              <div>
                <h3>Удалить аккаунт</h3>
                <p>Это действие нельзя отменить</p>
              </div>
            </div>
            {!remove ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setRemove(true)}
              >
                Перейти к удалению
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await authRequest('delete-account', {
                      confirm,
                      deleteChannels: channels,
                    });
                    window.location.assign('/login');
                  });
                }}
              >
                <p>
                  Будут удалены профиль, личные публикации, комментарии,
                  переписки, связи и интеграции. Записи о переводах Stars и
                  доказательства модерации сохраняются с идентификатором
                  удалённого аккаунта.
                </p>
                {status.channels.length > 0 && (
                  <>
                    <p>
                      Ваши каналы:{' '}
                      {status.channels.map((c) => '@' + c.handle).join(', ')}.
                    </p>
                    <label className="account-check" htmlFor="delete-channels">
                      <Checkbox
                        id="delete-channels"
                        checked={channels}
                        onCheckedChange={(v) => setChannels(v === true)}
                        disabled={busy}
                      />{' '}
                      Удалить также мои каналы и их публикации
                    </label>
                  </>
                )}
                <label className="account-field">
                  Введите УДАЛИТЬ
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </label>
                {!fresh && (
                  <p className="meta">
                    Сначала подтвердите доступ кодом в разделе «Почта и доступ»
                    выше.
                  </p>
                )}
                <div className="account-actions">
                  <button
                    className="primary danger-button"
                    disabled={
                      busy ||
                      !fresh ||
                      confirm !== 'УДАЛИТЬ' ||
                      (status.channels.length > 0 && !channels)
                    }
                  >
                    Удалить навсегда
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setRemove(false)}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
