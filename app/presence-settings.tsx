'use client';
/* Settings and debounced search are scoped to the signed-in user. */
/* eslint-disable react/react-compiler */
import { useEffect, useId, useRef, useState } from 'react';
import { Check, Clock3, Eye, EyeOff, Plus, Search, X } from 'lucide-react';
import { request, type Person } from '@/lib/client';
import { Avatar, DisplayName } from './profile-identity';

type Settings = {
  policy: 'everyone' | 'nobody';
  hidden: Person[];
  visible: Person[];
};
export function PresenceSettings({ onChanged }: { onChanged: () => void }) {
  const id = useId();
  const [settings, setSettings] = useState<Settings | null>(null);
  const original = useRef<Settings | null>(null),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [picker, setPicker] = useState(false),
    [query, setQuery] = useState(''),
    [people, setPeople] = useState<Person[]>([]),
    [searching, setSearching] = useState(false),
    [reload, setReload] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    request<Settings>('?action=presencePrivacy')
      .then((value) => {
        if (active) {
          original.current = value;
          setSettings(value);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  useEffect(() => {
    if (picker) search.current?.focus();
  }, [picker]);
  useEffect(() => {
    let active = true;
    setPeople([]);
    setSearching(picker && !!query.trim());
    if (!picker || !query.trim()) return;
    const timer = setTimeout(() => {
      request<Person[]>(
        '?action=privacyPeople&q=' + encodeURIComponent(query.trim()),
      )
        .then((value) => {
          if (active) setPeople(value);
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
  }, [picker, query]);
  const key = settings?.policy === 'everyone' ? 'hidden' : 'visible';
  const list = settings?.[key] || [];
  const changeList = (next: Person[]) => {
    if (settings) {
      setSettings({ ...settings, [key]: next });
      setNotice('');
    }
  };
  const dirty =
    !!settings && JSON.stringify(settings) !== JSON.stringify(original.current);
  return (
    <section
      className="privacy-section presence-settings"
      aria-labelledby={id + '-title'}
    >
      <h3 id={id + '-title'}>
        <Clock3 size={18} /> Статус сети
      </h3>
      <p className="meta">
        Кто видит, что ты в сети, и время последнего посещения.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
          {!settings && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => setReload((value) => value + 1)}
              >
                Повторить
              </button>
            </>
          )}
        </p>
      )}
      {!settings && !error && <p className="meta">Загружаем настройки…</p>}
      {settings && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (locked.current || !dirty) return;
            locked.current = true;
            setBusy(true);
            setError('');
            setNotice('');
            try {
              await request('', {
                action: 'presencePrivacy',
                policy: settings.policy,
                hiddenIds: settings.hidden.map((p) => p.id),
                visibleIds: settings.visible.map((p) => p.id),
              });
              original.current = settings;
              setNotice('Настройки статуса сохранены');
              setPicker(false);
              setQuery('');
              onChanged();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              locked.current = false;
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="presence-fields">
            <legend>Кому показывать</legend>
            <div className="presence-choices">
              {(
                [
                  { value: 'everyone', label: 'Все', icon: Eye },
                  { value: 'nobody', label: 'Никто', icon: EyeOff },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <label
                  key={value}
                  className="presence-choice"
                  data-selected={settings.policy === value}
                >
                  <input
                    type="radio"
                    name={id + '-policy'}
                    value={value}
                    checked={settings.policy === value}
                    onChange={() => {
                      setSettings({ ...settings, policy: value });
                      setPicker(false);
                      setQuery('');
                      setNotice('');
                    }}
                  />
                  <Icon size={18} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="presence-exceptions" key={key}>
              <div className="presence-exceptions-title">
                <h4>
                  {key === 'hidden'
                    ? 'Всегда скрывать от'
                    : 'Всегда показывать'}{' '}
                  <span className="meta">{list.length}</span>
                </h4>
                <button
                  type="button"
                  className="secondary"
                  aria-expanded={picker}
                  onClick={() => setPicker(!picker)}
                >
                  <Plus size={16} /> Добавить
                </button>
              </div>
              <p className="meta">
                {key === 'hidden'
                  ? 'Эти люди не увидят твой статус и время посещения.'
                  : 'Эти люди увидят твой статус и время посещения, даже когда выбрано «Никто».'}
              </p>
              {list.length > 0 && (
                <ul className="presence-people">
                  {list.map((person) => (
                    <li key={person.id}>
                      <Avatar person={person} size={32} />
                      <span className="presence-person-copy">
                        <strong>
                          <DisplayName person={person} />
                        </strong>
                        <small>@{person.handle}</small>
                      </span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={'Убрать исключение: ' + person.name}
                        onClick={() =>
                          changeList(list.filter((p) => p.id !== person.id))
                        }
                      >
                        <X size={17} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {picker && (
                <div className="presence-picker">
                  <label className="privacy-search">
                    <Search size={17} />
                    <input
                      ref={search}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Имя или @ник"
                      aria-label="Найти пользователя для исключения"
                      autoComplete="off"
                    />
                  </label>
                  {!query.trim() && (
                    <p className="meta">
                      Найди человека по имени или имени пользователя.
                    </p>
                  )}
                  {searching && (
                    <p className="meta" aria-live="polite">
                      Ищем…
                    </p>
                  )}
                  {!searching && !!query.trim() && !people.length && (
                    <p className="meta">Никого не нашли.</p>
                  )}
                  <ul className="presence-search-results">
                    {people.map((person) => {
                      const selected = list.some((p) => p.id === person.id);
                      return (
                        <li key={person.id}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            disabled={!selected && list.length >= 100}
                            onClick={() =>
                              changeList(
                                selected
                                  ? list.filter((p) => p.id !== person.id)
                                  : [...list, person],
                              )
                            }
                          >
                            <Avatar person={person} size={32} />
                            <span className="presence-person-copy">
                              <strong>
                                <DisplayName person={person} />
                              </strong>
                              <small>@{person.handle}</small>
                            </span>
                            {selected ? (
                              <Check size={18} />
                            ) : (
                              <Plus size={18} />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {list.length >= 100 && (
                    <p className="meta">
                      В этот список можно добавить до 100 человек.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="presence-actions">
              <button
                type="button"
                className="secondary"
                disabled={!dirty}
                onClick={() => {
                  setSettings(original.current);
                  setPicker(false);
                  setQuery('');
                  setError('');
                  setNotice('');
                }}
              >
                Отмена
              </button>
              <button className="primary" disabled={!dirty}>
                {busy ? 'Сохраняем…' : 'Сохранить статус'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {notice && (
        <output className="presence-notice" aria-live="polite">
          <Check size={16} />
          {notice}
        </output>
      )}
    </section>
  );
}
