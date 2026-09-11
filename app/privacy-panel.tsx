'use client';
import { DisplayName } from './profile-identity';
import { ProfileLink } from './profile-link';
/* Async effects load private settings and cancel stale search results. */
/* eslint-disable react/react-compiler */
import { useEffect, useId, useRef, useState } from 'react';
import {
  Ban,
  Check,
  ChevronDown,
  EyeOff,
  LockKeyhole,
  Search,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { Select } from '@base-ui/react/select';
import { Switch } from '@base-ui/react/switch';
import { request, type Person } from '@/lib/client';
import { Avatar } from './post-card';
import { PresenceSettings } from './presence-settings';

type Settings = {
  hideAdult: boolean;
  messagePolicy: 'everyone' | 'following' | 'nobody';
  blocked: Person[];
};
const messagePolicies = [
  {
    value: 'everyone',
    label: 'Все пользователи',
    description: 'Любой человек в Noctgram',
    icon: UsersRound,
  },
  {
    value: 'following',
    label: 'Только мои подписки',
    description: 'Люди, на которых ты подписан',
    icon: UserRoundCheck,
  },
  {
    value: 'nobody',
    label: 'Никто',
    description: 'Новые сообщения не приходят',
    icon: LockKeyhole,
  },
] as const;
export function PrivacyPanel({ onChanged }: { onChanged: () => void }) {
  const fieldId = useId();
  const [settings, setSettings] = useState<Settings | null>(null),
    [query, setQuery] = useState(''),
    [found, setFound] = useState<(Person & { blockedByMe: number })[]>([]),
    [searching, setSearching] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0);
  const lock = useRef(false);
  const PolicyIcon =
    messagePolicies.find((p) => p.value === settings?.messagePolicy)?.icon ||
    UsersRound;
  useEffect(() => {
    let active = true;
    request<Settings>('?action=privacy')
      .then((r) => {
        if (active) setSettings(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setFound([]);
    setSearching(!!query.trim());
    const timer = setTimeout(() => {
      if (!query.trim()) return;
      request<(Person & { blockedByMe: number })[]>(
        '?action=privacyPeople&q=' + encodeURIComponent(query),
      )
        .then((r) => {
          if (active) setFound(r);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, reload]);
  const perform = async (action: () => Promise<void>, success: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const block = (person: Person, value: boolean) =>
    void perform(
      async () => {
        await request('', { action: 'blockUser', id: person.id, value });
        // Refresh the block list without replacing the content/message preferences.
        const r = await request<Settings>('?action=privacy');
        setSettings((s) => s && { ...s, blocked: r.blocked });
        setReload((n) => n + 1);
      },
      value
        ? 'Пользователь добавлен в чёрный список'
        : 'Пользователь разблокирован',
    );
  const savePreference = (
    patch: Partial<Pick<Settings, 'hideAdult' | 'messagePolicy'>>,
  ) => {
    if (!settings) return;
    void perform(async () => {
      await request('', {
        action: 'privacy',
        hideAdult: patch.hideAdult ?? settings.hideAdult,
        messagePolicy: patch.messagePolicy ?? settings.messagePolicy,
      });
      setSettings((previous) => previous && { ...previous, ...patch });
    }, 'Настройки сохранены');
  };
  return (
    <div className="privacy-panel">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!settings && !error && (
        <p className="connections-status">Загружаем настройки…</p>
      )}
      {settings && (
        <div className="privacy-content">
          <PresenceSettings onChanged={onChanged} />
          <div className="edit-form">
            <fieldset disabled={busy} className="edit-fields">
              <section className="privacy-section">
                <h3>
                  <ShieldCheck size={17} /> Личные сообщения
                </h3>
                <div className="privacy-select-field">
                  <label
                    id={fieldId + '-policy-label'}
                    htmlFor={fieldId + '-policy'}
                  >
                    Кто может мне писать
                  </label>
                  <Select.Root
                    items={messagePolicies}
                    value={settings.messagePolicy}
                    disabled={busy}
                    onValueChange={(value) => {
                      if (value) savePreference({ messagePolicy: value });
                    }}
                  >
                    <Select.Trigger
                      className="privacy-select-trigger"
                      id={fieldId + '-policy'}
                      aria-labelledby={fieldId + '-policy-label'}
                      aria-describedby={fieldId + '-policy-note'}
                    >
                      <PolicyIcon
                        className="privacy-policy-icon"
                        size={18}
                        aria-hidden="true"
                      />
                      <Select.Value className="privacy-select-value" />
                      <Select.Icon className="privacy-select-chevron">
                        <ChevronDown size={16} />
                      </Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Positioner
                        className="privacy-select-positioner"
                        sideOffset={7}
                        align="start"
                        alignItemWithTrigger={false}
                      >
                        <Select.Popup className="privacy-select-menu">
                          <Select.List className="privacy-select-list">
                            {messagePolicies.map(
                              ({ value, label, description, icon: Icon }) => (
                                <Select.Item
                                  className="privacy-select-option"
                                  key={value}
                                  value={value}
                                  label={label}
                                >
                                  <span className="privacy-option-icon">
                                    <Icon size={18} aria-hidden="true" />
                                  </span>
                                  <span className="privacy-option-copy">
                                    <Select.ItemText>{label}</Select.ItemText>
                                    <small>{description}</small>
                                  </span>
                                  <Select.ItemIndicator
                                    className="privacy-option-check"
                                    keepMounted
                                  >
                                    <Check size={15} strokeWidth={2.5} />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ),
                            )}
                          </Select.List>
                        </Select.Popup>
                      </Select.Positioner>
                    </Select.Portal>
                  </Select.Root>
                </div>
                <p className="meta" id={fieldId + '-policy-note'}>
                  Правило действует и в существующих диалогах. История переписки
                  сохраняется.
                </p>
              </section>
              <section className="privacy-section">
                <h3>
                  <EyeOff size={17} /> Нежелательный контент
                </h3>
                <label className="privacy-toggle" htmlFor={fieldId + '-adult'}>
                  <span>
                    <span id={fieldId + '-adult-label'}>
                      Скрывать публикации 18+
                    </span>
                    <small id={fieldId + '-adult-note'}>
                      Посты с этой отметкой исчезнут из ленты, поиска и
                      сохранённого.
                    </small>
                  </span>
                  <Switch.Root
                    className="privacy-switch"
                    id={fieldId + '-adult'}
                    aria-labelledby={fieldId + '-adult-label'}
                    aria-describedby={fieldId + '-adult-note'}
                    checked={settings.hideAdult}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      savePreference({ hideAdult: checked })
                    }
                  >
                    <Switch.Thumb className="privacy-switch-thumb">
                      <Check size={13} strokeWidth={3} aria-hidden="true" />
                    </Switch.Thumb>
                  </Switch.Root>
                </label>
              </section>
            </fieldset>
          </div>
          <section className="privacy-section">
            <h3>
              <Ban size={17} /> Чёрный список{' '}
              <span className="meta">{settings.blocked.length}</span>
            </h3>
            <p className="meta">
              Публикации, комментарии и каналы этих людей скрыты. Сообщения и
              подписки в обе стороны отключены. После разблокировки подписки
              нужно восстановить вручную.
            </p>
            <label className="privacy-search">
              <Search size={16} />
              <input
                aria-label="Найти пользователя для чёрного списка"
                placeholder="Имя или @юзернейм"
                maxLength={100}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {searching && <p className="meta">Ищем…</p>}
            {query.trim() && !searching && !found.length && (
              <p className="meta">Никого не найдено</p>
            )}
            {(query.trim() ? found : settings.blocked).map((p) => {
              const blocked = settings.blocked.some((b) => b.id === p.id);
              return (
                <div className="privacy-person" key={p.id}>
                  <ProfileLink
                    target={{ id: p.id }}
                    aria-label={'Профиль ' + p.name}
                  >
                    <Avatar person={p} size={36} />
                  </ProfileLink>
                  <span>
                    <strong>
                      <ProfileLink target={{ id: p.id }}>
                        <DisplayName person={p} />
                      </ProfileLink>
                    </strong>
                    <small>
                      <ProfileLink target={{ id: p.id }}>
                        @{p.handle}
                      </ProfileLink>
                    </small>
                  </span>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => block(p, !blocked)}
                  >
                    {blocked ? 'Разблокировать' : 'Заблокировать'}
                  </button>
                </div>
              );
            })}
            {!query.trim() && !settings.blocked.length && (
              <p className="privacy-empty">В чёрном списке пока никого.</p>
            )}
          </section>
          <p className="account-note">
            На нежелательное сообщение можно пожаловаться кнопкой с флажком
            рядом с ним. Модератор увидит только выбранное сообщение и причину
            жалобы.
          </p>
        </div>
      )}
      {notice && (
        <output className="moderation-notice" aria-live="polite">
          {notice}
        </output>
      )}
    </div>
  );
}
