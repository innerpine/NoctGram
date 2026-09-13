'use client';
import { DisplayName } from './profile-identity';
import { ProfileLink } from './profile-link';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import { UsersRound, Trash2, Check, Search } from 'lucide-react';
import { Select } from '@base-ui/react/select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { request, type Person, type Profile } from '@/lib/client';
import { Avatar } from './post-card';
import { GiveawayCreateButton } from './giveaway-create';
export function ChannelTools({
  profile,
  actorId,
  onCreated,
}: {
  profile: Profile;
  actorId?: string;
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [members, setMembers] = useState<(Person & { role: string })[]>([]),
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
    request<{ members: typeof members }>(
      '?action=channelTeam&id=' + encodeURIComponent(profile.id),
    )
      .then((r) => {
        if (!live) return;
        setMembers(r.members);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open, profile.id, version]);
  useEffect(() => {
    if (!open || !query.trim()) {
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
  }, [query, open, profile.ownerId]);
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
  if (profile.kind !== 'channel') return null;
  return (
    <>
      <div className="channel-tools">
        {profile.kind === 'channel' && profile.canManagePosts && actorId && (
          <GiveawayCreateButton
            targetKind="channel"
            targetId={profile.id}
            targetName={profile.name}
            actorId={actorId}
            onCreated={onCreated}
          />
        )}
        <button className="secondary" onClick={() => setOpen(true)}>
          <UsersRound size={15} /> Команда канала
        </button>
        {profile.channelRole && profile.channelRole !== 'owner' && (
          <small className="meta">
            {profile.channelRole === 'admin' ? 'Администратор' : 'Редактор'}
          </small>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="noct-dialog">
          <DialogTitle>Команда канала</DialogTitle>
          <DialogDescription>
            Администратор редактирует канал и управляет публикациями. Редактор
            публикует и изменяет свои посты. Назначать роли может владелец.
          </DialogDescription>
          {error && (
            <p className="realtime-error" role="alert">
              {error}
            </p>
          )}
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
                    <ProfileLink target={{ id: p.id }}>@{p.handle}</ProfileLink>
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
                  Удалённый участник потеряет доступ к управлению каналом.
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
