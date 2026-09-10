'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  Link,
  LoaderCircle,
  LockKeyhole,
  Users,
  Globe,
  MoreHorizontal,
  UserPlus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { roomAction } from '@/lib/rooms-client';
import type { RoomDetail } from '@/lib/rooms-types';
import type { Person } from '@/lib/client';
import { request } from '@/lib/client';
import { Avatar } from './post-card';

export function RoomManagement({
  room,
  open,
  onOpenChange,
  onRefresh,
  onLeave,
  disabled,
}: {
  room: RoomDetail;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onRefresh: () => Promise<unknown>;
  onLeave: () => void;
  disabled: boolean;
}) {
  const [tab, setTab] = useState('members'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [name, setName] = useState(room.name),
    [description, setDescription] = useState(room.description);
  const [visibility, setVisibility] = useState(room.visibility),
    [username, setUsername] = useState(room.username || '');
  const [invite, setInvite] = useState(''),
    [copied, setCopied] = useState(false),
    [query, setQuery] = useState(''),
    [people, setPeople] = useState<Person[]>([]);
  const [confirmation, setConfirmation] = useState<{
    action: string;
    userId?: string;
    role?: string;
    message: string;
  } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const memberIds = JSON.stringify(room.members.map((member) => member.userId));
  const [peopleLoading, setPeopleLoading] = useState(false);
  const manage = room.role === 'owner' || room.role === 'admin';
  useEffect(() => {
    if (!manage) setTab('members');
  }, [manage]);
  useEffect(() => {
    if (!open) return;
    setName(room.name);
    setDescription(room.description);
    setVisibility(room.visibility);
    setUsername(room.username || '');
    setError('');
    setInvite('');
    setCopied(false);
  }, [
    open,
    room.id,
    room.name,
    room.description,
    room.visibility,
    room.username,
  ]);
  useEffect(() => {
    setPeople([]);
    if (!open || !manage || query.trim().length < 2) {
      setPeopleLoading(false);
      return;
    }
    setPeopleLoading(true);
    let alive = true;
    const timer = setTimeout(() => {
      void request<Person[]>('?action=people&q=' + encodeURIComponent(query))
        .then((data) => {
          if (alive)
            setPeople(
              data.filter(
                (person) =>
                  (!person.kind || person.kind === 'person') &&
                  person.id !== 'noctgram' &&
                  person.id !== room.me &&
                  !(JSON.parse(memberIds) as string[]).includes(person.id),
              ),
            );
        })
        .catch((error) => {
          if (alive) setError(error.message);
        })
        .finally(() => {
          if (alive) setPeopleLoading(false);
        });
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, query, manage, memberIds, room.me]);
  const perform = async (
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (busy || (disabled && action !== 'leave')) return false;
    setBusy(true);
    setError('');
    try {
      await roomAction({ action, actor: room.me, id: room.id, ...extra });
      if (!mounted.current) return false;
      if (action === 'leave') {
        onOpenChange(false);
        onLeave();
      } else await onRefresh();
      if (!mounted.current) return false;
      setConfirmation(null);
      return true;
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : 'Не удалось выполнить действие',
        );
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
      onOpenChangeComplete={(value) => {
        if (!value) {
          setConfirmation(null);
          setQuery('');
          setCopied(false);
        }
      }}
    >
      <DialogContent
        className="noct-dialog room-manage-dialog"
        overlayClassName="room-dialog-overlay"
      >
        <DialogTitle>{room.name}</DialogTitle>
        <DialogDescription>
          {room.memberCount} участников ·{' '}
          {room.visibility === 'public'
            ? 'Публичная группа'
            : 'Приватная группа'}
        </DialogDescription>
        <div className="room-tabs" aria-label="Настройки группы">
          <button
            className={tab === 'members' ? 'active' : ''}
            onClick={() => setTab('members')}
          >
            <Users size={15} />
            Участники
          </button>
          {manage && (
            <button
              className={tab === 'info' ? 'active' : ''}
              onClick={() => setTab('info')}
            >
              О группе
            </button>
          )}
          <button
            className={tab === 'link' ? 'active' : ''}
            onClick={() => setTab('link')}
          >
            <Link size={15} />
            Ссылка
          </button>
        </div>
        <div className="room-manage-body">
          {tab === 'members' && (
            <>
              {manage && (
                <div className="room-add-member">
                  <label className="room-field">
                    <span>
                      <UserPlus size={14} /> Добавить участника
                    </span>
                    <input
                      className="room-text-input"
                      value={query}
                      maxLength={100}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Найти по имени или @юзернейму"
                    />
                  </label>
                  {peopleLoading && (
                    <p className="room-note">Ищем участников…</p>
                  )}
                  {!peopleLoading &&
                    query.trim().length >= 2 &&
                    !people.length && (
                      <p className="room-note">Новых участников не найдено.</p>
                    )}
                  {room.memberCount >= 200 && (
                    <p className="room-note">В группе уже 200 участников.</p>
                  )}
                  {people.map((person) => (
                    <button
                      key={person.id}
                      className="room-member-add"
                      disabled={busy || disabled || room.memberCount >= 200}
                      onClick={() =>
                        void perform('addMember', { userId: person.id }).then(
                          (done) => {
                            if (done && mounted.current) setQuery('');
                          },
                        )
                      }
                    >
                      <Avatar person={person} size={30} />
                      <span>
                        {person.name}
                        <small>@{person.handle}</small>
                      </span>
                      <UserPlus size={16} />
                    </button>
                  ))}
                </div>
              )}
              {room.members.map((member) => (
                <div className="room-member-row" key={member.userId}>
                  <Avatar
                    person={{
                      name: member.name,
                      avatar: member.avatar,
                    }}
                    size={34}
                  />
                  <span className="room-member-copy">
                    <strong>{member.name}</strong>
                    <small>
                      {member.handle ? '@' + member.handle : 'Участник'}
                    </small>
                  </span>
                  {member.role !== 'member' && (
                    <span className="room-member-role">
                      {member.role === 'owner' ? 'владелец' : 'админ'}
                    </span>
                  )}
                  {manage &&
                    member.userId !== room.me &&
                    member.role !== 'owner' &&
                    (room.role === 'owner' || member.role === 'member') && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="icon-button"
                          aria-label={'Управлять участником ' + member.name}
                          disabled={busy || disabled}
                        >
                          <MoreHorizontal size={17} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          className="chat-options-menu"
                          align="end"
                        >
                          {room.role === 'owner' && (
                            <DropdownMenuItem
                              onClick={() =>
                                void perform('role', {
                                  userId: member.userId,
                                  role:
                                    member.role === 'admin'
                                      ? 'member'
                                      : 'admin',
                                })
                              }
                            >
                              {member.role === 'admin'
                                ? 'Снять администратора'
                                : 'Назначить администратором'}
                            </DropdownMenuItem>
                          )}
                          {room.role === 'owner' && (
                            <DropdownMenuItem
                              onClick={() =>
                                setConfirmation({
                                  action: 'role',
                                  userId: member.userId,
                                  role: 'owner',
                                  message: `Передать группу ${member.name}? Управление группой перейдёт этому участнику.`,
                                })
                              }
                            >
                              Передать владение
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                              setConfirmation({
                                action: 'removeMember',
                                userId: member.userId,
                                message: `Удалить ${member.name} из группы и закрыть повторный вход?`,
                              })
                            }
                          >
                            Удалить из группы
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                </div>
              ))}
            </>
          )}
          {tab === 'info' && manage && (
            <form
              className="room-edit-form"
              onSubmit={(event) => {
                event.preventDefault();
                void perform('update', {
                  name,
                  description,
                  visibility,
                  username: visibility === 'public' ? username : null,
                });
              }}
            >
              <label className="room-field">
                <span>Название</span>
                <input
                  className="room-text-input"
                  value={name}
                  maxLength={100}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="room-field">
                <span>Описание</span>
                <textarea
                  className="room-text-input"
                  value={description}
                  maxLength={500}
                  rows={3}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <fieldset className="room-visibility">
                <legend>Доступ к группе</legend>
                {(['private', 'public'] as const).map((value) => (
                  <label
                    key={value}
                    className={visibility === value ? 'selected' : ''}
                  >
                    <input
                      type="radio"
                      name={'visibility-' + room.id}
                      checked={visibility === value}
                      onChange={() => setVisibility(value)}
                    />
                    {value === 'public' ? (
                      <Globe size={17} />
                    ) : (
                      <LockKeyhole size={17} />
                    )}
                    <span>
                      {value === 'public' ? 'Публичная' : 'Приватная'}
                      <small>
                        {value === 'public'
                          ? 'Доступна в поиске'
                          : 'Вход по приглашению'}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {visibility === 'public' && (
                <label className="room-field">
                  <span>Юзернейм группы</span>
                  <input
                    className="room-text-input"
                    value={username}
                    placeholder="@noct_friends"
                    minLength={4}
                    maxLength={24}
                    pattern="[a-z][a-z0-9_]{3,23}"
                    required
                    onChange={(event) =>
                      setUsername(
                        event.target.value.replace(/^@/, '').toLowerCase(),
                      )
                    }
                  />
                </label>
              )}
              <button className="primary" disabled={busy || disabled}>
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  'Сохранить'
                )}
              </button>
            </form>
          )}
          {tab === 'link' && (
            <div className="room-invite-section">
              {room.visibility === 'public' ? (
                <>
                  <Globe size={30} />
                  <h3>@{room.username}</h3>
                  <p>Группу можно найти в поиске NoctGram.</p>
                </>
              ) : (
                <>
                  <LockKeyhole size={30} />
                  <h3>Приглашение в группу</h3>
                  <p>
                    {manage
                      ? 'Новая ссылка заменит предыдущую. Передай её тем, кого хочешь пригласить.'
                      : 'Попроси ссылку у владельца или администратора.'}
                  </p>
                </>
              )}
              {(room.visibility === 'public' || invite) && (
                <>
                  <input
                    aria-label="Ссылка на группу"
                    className="room-text-input"
                    readOnly
                    value={
                      room.visibility === 'public'
                        ? new URL(
                            '/?group=' + room.username,
                            typeof window === 'undefined'
                              ? 'http://localhost'
                              : window.location.origin,
                          ).href
                        : invite
                    }
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button
                    className="secondary"
                    onClick={() => {
                      const value =
                        room.visibility === 'public'
                          ? new URL(
                              '/?group=' + room.username,
                              window.location.origin,
                            ).href
                          : invite;
                      void navigator.clipboard
                        .writeText(value)
                        .then(() => setCopied(true))
                        .catch(() =>
                          setError('Скопируй ссылку из поля вручную.'),
                        );
                    }}
                  >
                    <Copy size={15} />
                    {copied ? 'Скопировано' : 'Скопировать'}
                  </button>
                </>
              )}
              {room.visibility === 'private' && manage && (
                <button
                  className="secondary"
                  disabled={busy || disabled}
                  onClick={() => {
                    setBusy(true);
                    setError('');
                    void roomAction<{ inviteUrl: string }>({
                      action: 'invite',
                      actor: room.me,
                      id: room.id,
                    })
                      .then((data) => {
                        if (!mounted.current) return;
                        setInvite(
                          new URL(data.inviteUrl, window.location.origin).href,
                        );
                        setCopied(false);
                      })
                      .catch((error) => {
                        if (mounted.current) setError(error.message);
                      })
                      .finally(() => {
                        if (mounted.current) setBusy(false);
                      });
                  }}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Link size={15} />
                  )}
                  {invite ? 'Заменить ссылку' : 'Создать ссылку'}
                </button>
              )}
            </div>
          )}
        </div>
        {confirmation && (
          <div className="room-confirm" role="alert">
            <p>{confirmation.message}</p>
            <div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                Отмена
              </button>
              <button
                className="danger-button"
                disabled={busy || (disabled && confirmation.action !== 'leave')}
                onClick={() => {
                  const { action, message: _message, ...extra } = confirmation;
                  void perform(action, extra);
                }}
              >
                Подтвердить
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="room-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="room-leave text-button"
          disabled={busy}
          onClick={() =>
            setConfirmation({
              action: 'leave',
              message:
                room.role === 'owner' && room.memberCount > 1
                  ? 'Перед выходом передай владение другому участнику в меню рядом с его именем.'
                  : 'Покинуть группу? Для возвращения понадобится действующее приглашение или публичная ссылка.',
            })
          }
        >
          Покинуть группу
        </button>
      </DialogContent>
    </Dialog>
  );
}
