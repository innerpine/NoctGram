'use client';
import { DisplayName } from './profile-identity';
import { ProfileLink } from './profile-link';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import { Clock3, UsersRound, Trash2, Check, Search } from 'lucide-react';
import { Select } from '@base-ui/react/select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { request, type Person, type Profile, type Post } from '@/lib/client';
import { Avatar } from './post-card';
import { GiveawayCreateButton } from './giveaway-create';
export function localDate(value = Date.now() + 3600000) {
  const date = new Date(value);
  return new Date(value - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function ChannelTools({
  profile,
  revision = 0,
  actorId,
  onCreated,
}: {
  profile: Profile;
  revision?: number;
  actorId?: string;
  onCreated?: () => void;
}) {
  const [panel, setPanel] = useState(''),
    [open, setOpen] = useState(false),
    [members, setMembers] = useState<(Person & { role: string })[]>([]),
    [queue, setQueue] = useState<(Post & { publisherHandle: string })[]>([]),
    [query, setQuery] = useState(''),
    [found, setFound] = useState<Person[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setError('');
    request<unknown>(
      '?action=' +
        (panel === 'team' ? 'channelTeam' : 'scheduled') +
        '&id=' +
        encodeURIComponent(profile.id),
    )
      .then((r) => {
        if (!live) return;
        if (panel === 'team')
          setMembers((r as { members: typeof members }).members);
        else setQueue(r as typeof queue);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open, panel, profile.id, version, revision]);
  useEffect(() => {
    if (!open || panel !== 'team' || !query.trim()) {
      setFound([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void request<Person[]>('?action=people&q=' + encodeURIComponent(query))
        .then((v) => {
          if (live) setFound(v.filter((p) => p.id !== profile.ownerId));
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, open, panel, profile.ownerId]);
  async function mutate(body: object) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await request('', body);
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const role = (p: Person, value: string) =>
    void mutate({
      action: 'channelMember',
      channelId: profile.id,
      id: p.id,
      role: value,
    });
  const launch = (v: string) => {
    setPanel(v);
    setOpen(true);
  };
  return (
    <>
      <div className="channel-tools">
        {profile.kind === 'channel' && actorId && profile.ownerId === actorId && (
          <GiveawayCreateButton
            targetKind="channel"
            targetId={profile.id}
            targetName={profile.name}
            actorId={actorId}
            onCreated={onCreated}
          />
        )}
        <button className="secondary" onClick={() => launch('queue')}>
          <Clock3 size={15} /> Отложенные
        </button>
        {profile.kind === 'channel' && (
          <button className="secondary" onClick={() => launch('team')}>
            <UsersRound size={15} /> Команда канала
          </button>
        )}
        {profile.channelRole && profile.channelRole !== 'owner' && (
          <small className="meta">
            {profile.channelRole === 'admin' ? 'Администратор' : 'Редактор'}
          </small>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="noct-dialog">
          <DialogTitle>
            {panel === 'team' ? 'Команда канала' : 'Отложенные публикации'}
          </DialogTitle>
          <DialogDescription>
            {panel === 'team'
              ? 'Администратор редактирует канал и управляет постами. Редактор публикует и управляет своей очередью. Назначать роли может владелец.'
              : 'Публикации появятся по времени сервера, даже если ты закроешь Noctgram. Время указано в часовом поясе твоего устройства.'}
          </DialogDescription>
          {error && (
            <p className="realtime-error" role="alert">
              {error}
            </p>
          )}
          {panel === 'team' ? (
            <div className="realtime-form">
              <p className="meta">Владелец канала сохраняет полный доступ.</p>
              {members.map((p) => (
                <div className="realtime-person" key={p.id}>
                  <ProfileLink
                    target={{ id: p.id }}
                    aria-label={'Профиль ' + p.name}
                  >
                    <Avatar person={p} size={36} />
                  </ProfileLink>
                  <span>
                    <ProfileLink target={{ id: p.id }}>
                      <DisplayName person={p} />
                    </ProfileLink>
                    <small>
                      <ProfileLink target={{ id: p.id }}>
                        @{p.handle}
                      </ProfileLink>
                    </small>
                  </span>
                  <span className="grow" />
                  {profile.canManageMembers ? (
                    <>
                      <Select.Root
                        value={p.role}
                        onValueChange={(v) => {
                          if (v) role(p, v);
                        }}
                        disabled={busy}
                      >
                        <Select.Trigger className="secondary">
                          {p.role === 'admin' ? 'Администратор' : 'Редактор'}
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Positioner
                            sideOffset={5}
                            className="privacy-select-positioner"
                          >
                            <Select.Popup className="privacy-select-popup">
                              {[
                                ['admin', 'Администратор'],
                                ['editor', 'Редактор'],
                              ].map(([v, label]) => (
                                <Select.Item
                                  className="privacy-select-item"
                                  key={v}
                                  value={v}
                                >
                                  <Select.ItemText>{label}</Select.ItemText>
                                  <Select.ItemIndicator>
                                    <Check size={15} />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ))}
                            </Select.Popup>
                          </Select.Positioner>
                        </Select.Portal>
                      </Select.Root>
                      <button
                        className="icon-button"
                        aria-label={'Убрать ' + p.name + ' из команды'}
                        disabled={busy}
                        onClick={() => role(p, 'remove')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  ) : (
                    <small>
                      {p.role === 'admin' ? 'Администратор' : 'Редактор'}
                    </small>
                  )}
                </div>
              ))}
              {!members.length && (
                <p className="meta">В команде пока только владелец.</p>
              )}
              {profile.canManageMembers && (
                <>
                  <label className="realtime-search">
                    <Search size={16} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Найти участника по имени или @юзернейму"
                      aria-label="Найти участника"
                    />
                  </label>
                  {found
                    .filter((p) => !members.some((m) => m.id === p.id))
                    .map((p) => (
                      <div key={p.id} className="realtime-person">
                        <ProfileLink
                          target={{ id: p.id }}
                          aria-label={'Профиль ' + p.name}
                        >
                          <Avatar person={p} size={32} />
                        </ProfileLink>
                        <span>
                          <ProfileLink target={{ id: p.id }}>
                            <DisplayName person={p} />
                          </ProfileLink>
                          <small>
                            <ProfileLink target={{ id: p.id }}>
                              @{p.handle}
                            </ProfileLink>
                          </small>
                        </span>
                        <span className="grow" />
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => role(p, 'editor')}
                        >
                          Добавить редактора
                        </button>
                      </div>
                    ))}
                  <p className="meta">
                    При удалении участника его будущие публикации отменяются.
                    Опубликованные посты сохраняются.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="schedule-list">
              {queue.length ? (
                queue.map((p) => (
                  <ScheduledRow
                    key={p.id}
                    post={p}
                    busy={busy}
                    onSave={(at) =>
                      void mutate({
                        action: 'reschedule',
                        id: p.id,
                        publishAt: at,
                      })
                    }
                    onCancel={() =>
                      void mutate({ action: 'cancelScheduled', id: p.id })
                    }
                  />
                ))
              ) : (
                <p className="realtime-empty">
                  В очереди пока пусто. Нажми на часы в редакторе публикации.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function ScheduledRow({
  post,
  busy,
  onSave,
  onCancel,
}: {
  post: Post & { publisherHandle: string };
  busy: boolean;
  onSave: (at: number) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(localDate(post.publishAt)),
    [editing, setEditing] = useState(false);
  return (
    <article className="scheduled-row">
      <div className="row">
        <Clock3 size={16} />
        <strong>{new Date(post.publishAt!).toLocaleString('ru-RU')}</strong>
      </div>
      <p>{post.text || post.code || 'Медиапубликация'}</p>
      <small className="meta">
        {post.media.length > 0 ? `${post.media.length} вложений · ` : ''}
        {post.poll.length > 0 ? 'Опрос · ' : ''}@{post.publisherHandle}
      </small>
      {post.cancelledAt ? (
        <p className="meta">Отменена</p>
      ) : (
        <>
          <div className="row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setEditing((v) => !v)}
            >
              Перенести
            </button>
            <button className="text-button" disabled={busy} onClick={onCancel}>
              Отменить публикацию
            </button>
          </div>
          {editing && (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                onSave(new Date(date).getTime());
              }}
            >
              <input
                required
                type="datetime-local"
                min={localDate(Date.now() + 60000)}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Новое время публикации"
              />
              <button className="primary" disabled={busy}>
                Сохранить
              </button>
            </form>
          )}
        </>
      )}
    </article>
  );
}
