'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useState } from 'react';
import { Plus, Search, Camera, Megaphone, X, ArrowUpRight } from 'lucide-react';
import { request, upload, type Profile } from '@/lib/client';
import { Avatar, Empty } from './post-card';
import { MAX_OWNED_CHANNELS } from '@/lib/channel-limits';
export function ChannelsPanel({
  me,
  onOpen,
  readOnly = false,
}: {
  me: Profile;
  readOnly?: boolean;
  onOpen: (id: string) => void;
}) {
  const [channels, setChannels] = useState<Profile[]>([]),
    [query, setQuery] = useState(''),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(''),
    [handle, setHandle] = useState(''),
    [bio, setBio] = useState(''),
    [avatar, setAvatar] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(
      () =>
        request<Profile[]>('?action=channels&q=' + encodeURIComponent(query))
          .then((rows) => {
            if (live) {
              setChannels(rows);
              setError('');
            }
          })
          .catch((e) => {
            if (live) setError(e.message);
          })
          .finally(() => {
            if (live) setLoading(false);
          }),
      query ? 200 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  return (
    <div className="channels-page">
      <div className="channels-toolbar">
        <div className="searchbox">
          <Search size={17} />
          <input
            aria-label="Поиск каналов"
            placeholder="Название или @юзернейм"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className="primary"
          disabled={readOnly}
          onClick={() => setCreating((v) => !v)}
        >
          <Plus size={16} />
          Создать
        </button>
      </div>
      {creating && !readOnly && (
        <form
          className="channel-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            try {
              const channel = await request<Profile>('', {
                action: 'createChannel',
                name,
                handle,
                bio,
                avatar,
              });
              onOpen(channel.id);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="row">
            <h2>Новый канал</h2>
            <span className="grow" />
            <button
              type="button"
              className="icon-button"
              onClick={() => setCreating(false)}
              aria-label="Закрыть создание канала"
            >
              <X size={18} />
            </button>
          </div>
          <p className="meta">
            Максимум {MAX_OWNED_CHANNELS} канала на один аккаунт.
          </p>
          <fieldset disabled={busy}>
            <div className="row">
              <Avatar person={{ name: name || 'Канал', avatar }} size={56} />
              <label className="secondary channel-avatar-upload">
                <Camera size={15} />
                Фотография
                <input
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    try {
                      const m = await upload(file, 'avatar');
                      setAvatar(m.url!);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
            </div>
            <label>
              Название
              <input
                value={name}
                required
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                placeholder="О чём твой канал?"
              />
            </label>
            <label>
              Юзернейм
              <input
                value={handle}
                required
                maxLength={25}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@my_channel"
              />
              <span className="meta">
                4–24 символа: латинские буквы, цифры и _.
              </span>
            </label>
            <label>
              Описание
              <textarea
                value={bio}
                maxLength={300}
                rows={3}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Что здесь будут читать"
              />
            </label>
            <button
              className="primary"
              disabled={!name.trim() || !handle.trim()}
            >
              {busy ? 'Создаём…' : 'Создать канал'}
            </button>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="meta">Загружаем каналы…</p>}
      {channels.map((c) => (
        <button
          key={c.id}
          className="channel-card"
          onClick={() => onOpen(c.id)}
        >
          <Avatar person={c} size={48} />
          <span>
            <strong>
              {c.name}
              {c.ownerId === me.id && (
                <small className="badge">Твой канал</small>
              )}
            </strong>
            <small>
              @{c.handle} · {c.followers.toLocaleString('ru-RU')} подписчиков
            </small>
            {c.channelRole && c.channelRole !== 'owner' && (
              <small>
                {c.channelRole === 'admin' ? 'Администратор' : 'Редактор'}
              </small>
            )}
            {c.bio && <p>{c.bio}</p>}
            {c.restriction && (
              <small className="channel-restriction-label">
                {c.restriction.mode === 'blocked'
                  ? 'Канал заблокирован'
                  : 'Только чтение'}{' '}
                · {c.restriction.reason}
              </small>
            )}
          </span>
          <ArrowUpRight size={17} />
        </button>
      ))}
      {!loading && !channels.length && !creating && (
        <Empty>
          <Megaphone size={26} />
          <strong>{query ? 'Каналы не найдены' : 'Каналов пока нет'}</strong>
          <p>Создай канал и публикуй от его имени.</p>
        </Empty>
      )}
    </div>
  );
}
