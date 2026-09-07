'use client';
import { SignOutButton } from './sign-out-button';
/* eslint-disable next/no-html-link-for-pages */
import { useRef, useState } from 'react';
import {
  LockKeyhole,
  EyeOff,
  ArrowLeft,
  Check,
  Download,
  RefreshCw,
} from 'lucide-react';
import { request, type Profile } from '@/lib/client';
export const accountDate = (time: number) =>
  new Date(time).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
function AppealForm({
  me,
  onUpdate,
}: {
  me: Profile;
  onUpdate: (p: Profile) => void;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const appeal =
    me.appeal?.eventId === me.restriction?.eventId ? me.appeal : null;
  if (appeal)
    return (
      <div className="account-appeal-status">
        <Check size={18} />
        <div>
          <strong>
            {appeal.status === 'pending'
              ? 'Обращение отправлено'
              : appeal.status === 'accepted'
                ? 'Обращение принято'
                : 'Обращение рассмотрено'}
          </strong>
          <p>
            {appeal.status === 'pending'
              ? 'Модератор рассмотрит обращение. Решение появится здесь.'
              : appeal.reviewNote}
          </p>
        </div>
      </div>
    );
  return (
    <div className="account-appeal">
      {!open ? (
        <button className="primary" onClick={() => setOpen(true)}>
          Оспорить решение
        </button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current || !text.trim()) return;
            lock.current = true;
            setBusy(true);
            setError('');
            try {
              onUpdate(await request<Profile>('', { action: 'appeal', text }));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          <label>
            Почему ограничение стоит пересмотреть
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              required
              rows={4}
              disabled={busy}
            />
          </label>
          <div className="account-actions">
            <button className="primary" disabled={busy || !text.trim()}>
              {busy ? 'Отправляем…' : 'Отправить обращение'}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Отмена
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
export function ReadOnlyNotice({
  me,
  onUpdate,
}: {
  me: Profile;
  onUpdate: (p: Profile) => void;
}) {
  const [details, setDetails] = useState(false);
  const r = me.restriction;
  if (!r) return null;
  return (
    <section className="account-readonly">
      <span className="account-readonly-icon">
        <EyeOff size={18} />
      </span>
      <div>
        <strong>Режим только чтения</strong>
        <p>
          Публикации, реакции, подписки и сообщения отключены{' '}
          {r.expiresAt
            ? 'до ' + accountDate(r.expiresAt)
            : 'до снятия ограничения'}
          . Лента, профили и сохранённое доступны.
        </p>
        <button
          className="secondary"
          aria-expanded={details}
          onClick={() => setDetails((v) => !v)}
        >
          {details ? 'Скрыть подробности' : 'Причина и обжалование'}
        </button>
        {details && (
          <div className="account-restriction-details">
            <p>{r.reason}</p>
            <AppealForm me={me} onUpdate={onUpdate} />
          </div>
        )}
      </div>
    </section>
  );
}
export function BlockedAccount({
  me,
  onUpdate,
  onRefresh,
}: {
  me: Profile;
  onUpdate: (p: Profile) => void;
  onRefresh: () => Promise<void>;
}) {
  const [exporting, setExporting] = useState(false),
    [error, setError] = useState('');
  const r = me.restriction!;
  return (
    <main className="account-blocked-shell">
      <section className="account-blocked-card">
        <span className="account-blocked-badge">
          <LockKeyhole size={32} strokeWidth={1.4} />
        </span>
        <h1>Аккаунт заблокирован</h1>
        <p className="account-lead">
          @{me.handle} скрыт для других: профиль, публикации и сообщения
          недоступны. Вход сохранён, чтобы оспорить решение и скачать копию
          данных.
        </p>
        <dl className="account-decision">
          <div>
            <dt>Причина</dt>
            <dd>{r.reason}</dd>
          </div>
          <div>
            <dt>Срок</dt>
            <dd>
              {r.expiresAt
                ? 'До ' + accountDate(r.expiresAt)
                : 'Бессрочная блокировка'}
            </dd>
          </div>
          <div>
            <dt>Дата решения</dt>
            <dd>{accountDate(r.created)}</dd>
          </div>
        </dl>
        <AppealForm me={me} onUpdate={onUpdate} />
        <div className="account-actions">
          <button
            className="secondary"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              setError('');
              try {
                const data = await request('?action=exportAccount');
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(data, null, 2)], {
                    type: 'application/json',
                  }),
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = 'noctgram-account.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download size={16} />
            {exporting ? 'Готовим…' : 'Скачать данные'}
          </button>
          <button
            className="secondary"
            onClick={() => {
              setError('');
              void onRefresh().catch((e) => setError(e.message));
            }}
          >
            <RefreshCw size={15} />
            Проверить статус
          </button>
          <SignOutButton className="account-signout">Выйти</SignOutButton>
        </div>
        <p className="account-note">
          Копия в JSON содержит тексты и сведения о файлах. Фото и видео в неё
          не включены.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
export function SuspendedProfile({
  profile,
  onBack,
}: {
  profile: Profile;
  onBack: () => void;
}) {
  return (
    <section className="account-suspended">
      <div className="account-suspended-cover">
        <button
          className="back-button"
          onClick={onBack}
          aria-label="Вернуться в ленту"
        >
          <ArrowLeft size={18} />
        </button>
      </div>
      <div className="account-suspended-body">
        <span className="account-suspended-avatar">
          <LockKeyhole size={30} strokeWidth={1.5} />
        </span>
        <h2>
          {profile.kind === 'channel'
            ? 'Канал заблокирован'
            : 'Аккаунт заблокирован'}
        </h2>
        <p>
          @{profile.handle} недоступен. Публикации, подписчики и сообщения
          скрыты.
        </p>
        {profile.blockedAt && (
          <dl className="account-decision">
            <div>
              <dt>Заблокирован</dt>
              <dd>{accountDate(profile.blockedAt)}</dd>
            </div>
          </dl>
        )}
        <button className="secondary" onClick={onBack}>
          Вернуться в ленту
        </button>
      </div>
    </section>
  );
}
