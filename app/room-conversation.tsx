'use client';
import { MessageReactions } from './message-reactions';
import type { ReactionEmoji } from '@/lib/message-reactions';
import { EmojiPicker, EmojiPreview } from './premium-emoji';
import { MentionText } from './profile-link';
import { GiveawayCard } from './giveaway-card';
import { GiveawayCreateButton } from './giveaway-create';
/* eslint-disable react/react-compiler */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Reply,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  X,
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
import type { Person } from '@/lib/client';
import type { RoomDetail, RoomMessage, RoomPreview } from '@/lib/rooms-types';
import { roomAction, roomRequest, type RoomTarget } from '@/lib/rooms-client';
import {
  decryptText,
  encryptText,
  ensureKey,
  prepareSession,
  type SecretSession,
} from '@/lib/secret-crypto';
import { RoomAvatar } from './room-list';
import { RoomManagement } from './room-management';
import { Avatar } from './post-card';

const reason = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось загрузить чат';
const time = (date: number) =>
  new Date(date).toLocaleTimeString('ru', {
    hour: '2-digit',
    minute: '2-digit',
  });
export function RoomConversation({
  target,
  me,
  disabled,
  onOpen,
  onBack,
  onProfile,
  onRoomsChanged,
}: {
  target: RoomTarget;
  me: Person;
  disabled: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  onProfile: (id: string) => void;
  onRoomsChanged: () => Promise<unknown>;
}) {
  const [room, setRoom] = useState<RoomDetail | null>(null),
    [preview, setPreview] = useState<RoomPreview | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [mutationError, setMutationError] = useState(''),
    [busy, setBusy] = useState(false);
  const [text, setText] = useState(''),
    [reply, setReply] = useState<RoomMessage | null>(null),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false),
    [safety, setSafety] = useState(''),
    [secretError, setSecretError] = useState(''),
    [secretReady, setSecretReady] = useState(false);
  const [reactionPending, setReactionPending] = useState<Set<string>>(
    () => new Set(),
  );
  const reactionLocks = useRef(new Set<string>());
  const [plaintext, setPlaintext] = useState<Record<string, string>>({}),
    [pending, setPending] = useState(false),
    [older, setOlder] = useState(false);
  const [remove, setRemove] = useState<RoomMessage | null>(null),
    [leaveSecret, setLeaveSecret] = useState(false);
  const alive = useRef(true),
    serial = useRef(0),
    newestRead = useRef('');
  const loadingRequest = useRef(false),
    readController = useRef<AbortController | null>(null);
  const session = useRef<SecretSession | null>(null),
    scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const outgoing = useRef<{
    id: string;
    text: string;
    replyTo: string | null;
    ciphertext?: string;
  } | null>(null);
  const pageBefore = useRef(''),
    paging = useRef(false);
  const sending = useRef(false);
  const load = useCallback(async () => {
    const ticket = ++serial.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    loadingRequest.current = true;
    try {
      if (target.roomId) {
        const data = await roomRequest<RoomDetail>(
          {
            actor: me.id,
            action: 'room',
            id: target.roomId,
            ...(pageBefore.current ? { before: pageBefore.current } : {}),
          },
          controller.signal,
        );
        if (!alive.current || ticket !== serial.current) return;
        if (data.me !== me.id)
          throw Object.assign(
            new Error('Аккаунт изменился. Открой чат снова.'),
            { status: 401 },
          );
        setRoom(data);
        const last = data.messages.at(-1);
        if (last && newestRead.current !== last.id && !document.hidden) {
          newestRead.current = last.id;
          void roomAction({
            actor: me.id,
            action: 'read',
            id: data.id,
            through: last.id,
          })
            .then(onRoomsChanged)
            .catch(() => {
              newestRead.current = '';
            });
        }
      } else {
        const data = await roomRequest<{ room: RoomPreview }>(
          target.invite
            ? { actor: me.id, action: 'resolveInvite', token: target.invite }
            : {
                actor: me.id,
                action: 'resolveGroup',
                username: target.group || '',
              },
          controller.signal,
        );
        if (!alive.current || ticket !== serial.current) return;
        if (data.room.joined) {
          onOpen(data.room.id);
          return;
        }
        setPreview(data.room);
      }
      setError('');
    } catch (error) {
      if (!alive.current || ticket !== serial.current) return;
      if (
        [401, 403, 404].includes(Number((error as { status?: number }).status))
      ) {
        setRoom(null);
        setPreview(null);
        session.current?.dispose();
        session.current = null;
        setPlaintext({});
        setSecretReady(false);
      }
      setError(reason(error));
      throw error;
    } finally {
      if (ticket === serial.current) {
        loadingRequest.current = false;
        if (alive.current) setLoading(false);
      }
    }
  }, [
    target.roomId,
    target.group,
    target.invite,
    me.id,
    onOpen,
    onRoomsChanged,
  ]);
  const latestLoad = useRef(load);
  const reactToMessage = async (
    message: RoomMessage,
    emoji: ReactionEmoji | null,
  ) => {
    if (
      disabled ||
      !room?.canSend ||
      room.kind !== 'group' ||
      message.deletedAt ||
      reactionLocks.current.has(message.id)
    )
      return;
    reactionLocks.current.add(message.id);
    setReactionPending(new Set(reactionLocks.current));
    setMutationError('');
    try {
      await roomAction({
        actor: me.id,
        action: 'reaction',
        id: room.id,
        messageId: message.id,
        emoji,
      });
      if (alive.current) await load();
    } catch (error) {
      if (alive.current) setMutationError(reason(error));
    } finally {
      reactionLocks.current.delete(message.id);
      if (alive.current) setReactionPending(new Set(reactionLocks.current));
    }
  };
  latestLoad.current = load;
  useEffect(() => {
    alive.current = true;
    const abortLatestRequest = () => readController.current?.abort();
    void latestLoad.current().catch(() => {});
    const timer = setInterval(() => {
      if (!document.hidden && !paging.current && !loadingRequest.current)
        void latestLoad.current().catch(() => {});
    }, 3500);
    const visible = () => {
      if (!document.hidden && !loadingRequest.current)
        void latestLoad.current().catch(() => {});
    };
    window.addEventListener('focus', visible);
    return () => {
      alive.current = false;
      // Invalidate the current request generation, not the initial one.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      serial.current++;
      abortLatestRequest();
      clearInterval(timer);
      window.removeEventListener('focus', visible);
      session.current?.dispose();
      session.current = null;
      outgoing.current = null;
    };
  }, [me.id, target.roomId, target.group, target.invite]);
  const keys =
    room?.kind === 'secret'
      ? JSON.stringify(
          room.members.map((member) => ({
            userId: member.userId,
            publicKey: member.publicKey,
          })),
        )
      : '';
  const cryptoRoomId = room?.id,
    cryptoRoomKind = room?.kind,
    roomMessages = room?.messages;
  const [keyRevision, retryKeys] = useState(0);
  useEffect(() => {
    session.current?.dispose();
    session.current = null;
    setSecretReady(false);
    setSafety('');
    setPlaintext({});
    setSecretError('');
    if (!cryptoRoomId || cryptoRoomKind !== 'secret') return;
    const members = JSON.parse(keys) as RoomDetail['members'];
    const own = members.find((member) => member.userId === me.id);
    if (!own?.publicKey) return;
    let current = true;
    void ensureKey(me.id, cryptoRoomId, own.publicKey)
      .then(() =>
        members.some((member) => !member.publicKey)
          ? null
          : prepareSession(me.id, cryptoRoomId, members),
      )
      .then((value) => {
        if (!value) return;
        if (!current || !alive.current) {
          value.dispose();
          return;
        }
        session.current = value;
        setSafety(value.safetyCode);
        setSecretReady(true);
      })
      .catch((error) => {
        if (current && alive.current) setSecretError(reason(error));
      });
    return () => {
      current = false;
      session.current?.dispose();
      session.current = null;
    };
  }, [keys, me.id, cryptoRoomId, cryptoRoomKind, keyRevision]);
  useEffect(() => {
    if (!secretReady || !session.current || !roomMessages) return;
    let current = true;
    const activeSession = session.current;
    void Promise.all(
      roomMessages.map(
        async (message) =>
          [
            message.id,
            message.deletedAt
              ? 'Сообщение удалено'
              : message.ciphertext
                ? await decryptText(activeSession, {
                    id: message.id,
                    sender: message.sender,
                    ciphertext: message.ciphertext,
                  }).catch(() => 'Не удалось проверить это сообщение')
                : 'Зашифрованное сообщение',
          ] as const,
      ),
    ).then((entries) => {
      if (current && alive.current) setPlaintext(Object.fromEntries(entries));
    });
    return () => {
      current = false;
    };
  }, [roomMessages, secretReady]);
  useEffect(() => {
    const list = scroll.current;
    if (list && follow.current) list.scrollTop = list.scrollHeight;
    const item = outgoing.current;
    if (
      item &&
      room?.messages.some(
        (message) => message.id === item.id && message.sender === me.id,
      )
    ) {
      outgoing.current = null;
      setPending(false);
      setText((current) => (current.trim() === item.text ? '' : current));
      setReply(null);
      setMutationError('');
    }
  }, [room?.messages, plaintext, me.id]);
  const refresh = async () => {
    if (!alive.current) return;
    await latestLoad.current();
    if (alive.current) await onRoomsChanged();
  };
  const registerSecret = async () => {
    if (!room || busy || disabled) return;
    setBusy(true);
    setSecretError('');
    try {
      const member = room.members.find((member) => member.userId === me.id);
      const key = await ensureKey(me.id, room.id, member?.publicKey || null);
      if (!alive.current) return;
      await roomAction({
        actor: me.id,
        action: 'acceptSecret',
        id: room.id,
        publicKey: key.publicKey,
      });
      if (alive.current) {
        retryKeys((value) => value + 1);
        await refresh();
      }
    } catch (error) {
      if (alive.current) setSecretError(reason(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const send = async () => {
    if (
      sending.current ||
      !room ||
      disabled ||
      busy ||
      !room.canSend ||
      (!text.trim() && !outgoing.current)
    )
      return;
    sending.current = true;
    setBusy(true);
    setMutationError('');
    const item = outgoing.current || {
      id: crypto.randomUUID(),
      text: text.trim(),
      replyTo: reply?.id || null,
    };
    outgoing.current = item;
    setPending(true);
    try {
      if (room.kind === 'secret') {
        if (!secretReady || !session.current)
          throw new Error('Дождись подключения секретного чата.');
        item.ciphertext ||= await encryptText(session.current, {
          id: item.id,
          sender: me.id,
          text: item.text,
        });
      }
      if (!alive.current) return;
      await roomAction({
        actor: me.id,
        action: 'send',
        id: room.id,
        key: item.id,
        ...(room.kind === 'secret'
          ? { ciphertext: item.ciphertext }
          : { text: item.text, replyTo: item.replyTo }),
      });
      if (alive.current) {
        follow.current = true;
        pageBefore.current = '';
        await refresh();
      }
    } catch (error) {
      if (!alive.current) return;
      setMutationError(reason(error));
      if (
        (Number((error as { status?: number }).status) >= 400 &&
          Number((error as { status?: number }).status) < 500) ||
        (!item.ciphertext && room.kind === 'secret')
      ) {
        outgoing.current = null;
        setPending(false);
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const head = room || preview;
  const ownKey = room?.members.find(
    (member) => member.userId === me.id,
  )?.publicKey;
  const peerKey = room?.members.find(
    (member) => member.userId !== me.id,
  )?.publicKey;
  return (
    <div className="room-workspace">
      <div className="chat-header room-header">
        <button
          className="chat-back icon-button"
          aria-label="Назад к диалогам"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        {head ? (
          <button
            className="chat-peer"
            onClick={() =>
              room &&
              (room.kind === 'secret'
                ? setSafetyOpen(true)
                : setSettingsOpen(true))
            }
          >
            <RoomAvatar room={head} size={34} />
            <span>
              <strong>{head.name || 'Секретный чат'}</strong>
              <small>
                {head.kind === 'secret'
                  ? 'Сквозное шифрование'
                  : `${head.memberCount} участников${head.username ? ' · @' + head.username : ''}`}
              </small>
            </span>
          </button>
        ) : (
          <strong>{loading ? 'Открываем чат…' : 'Чат недоступен'}</strong>
        )}
        {room?.kind === 'group' && (
          <GiveawayCreateButton
            targetKind="group"
            targetId={room.id}
            targetName={room.name}
            actorId={me.id}
            compact
            disabled={disabled || !room.canSend}
            onCreated={() => {
              void refresh().catch((error) => setError(reason(error)));
            }}
          />
        )}
        {room && (
          <button
            className="icon-button"
            aria-label={
              room.kind === 'secret'
                ? 'Проверить шифрование'
                : 'Настройки группы'
            }
            onClick={() =>
              room.kind === 'secret'
                ? setSafetyOpen(true)
                : setSettingsOpen(true)
            }
          >
            {room.kind === 'secret' ? (
              <ShieldCheck size={19} />
            ) : (
              <Settings size={19} />
            )}
          </button>
        )}
      </div>
      {loading && !head && (
        <div className="room-center">
          <LoaderCircle className="spin" size={25} />
          <p>Загружаем разговор…</p>
        </div>
      )}
      {preview && !room && (
        <div className="room-center room-join-preview">
          <RoomAvatar room={preview} size={76} />
          <span className="room-kind-chip">
            <Users size={13} /> Группа
          </span>
          <h2>{preview.name}</h2>
          {preview.description && <p>{preview.description}</p>}
          <small>
            {preview.memberCount} участников ·{' '}
            {preview.visibility === 'public' ? 'публичная' : 'по приглашению'}
          </small>
          <button
            className="primary"
            disabled={busy || disabled}
            onClick={() => {
              setBusy(true);
              setMutationError('');
              void roomAction<RoomDetail>({
                actor: me.id,
                action: 'join',
                ...(target.invite
                  ? { token: target.invite }
                  : { username: target.group }),
              })
                .then((data) => {
                  if (alive.current) {
                    onOpen(data.id);
                    void onRoomsChanged();
                  }
                })
                .catch((error) => {
                  if (alive.current) setMutationError(reason(error));
                })
                .finally(() => {
                  if (alive.current) setBusy(false);
                });
            }}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              'Вступить в группу'
            )}
          </button>
        </div>
      )}
      {room && (
        <>
          {room.kind === 'secret' && (
            <div className="room-secret-status">
              <LockKeyhole size={17} />
              <span>
                {secretReady
                  ? 'Сообщения видны только вам двоим на этих устройствах.'
                  : !ownKey
                    ? 'Прими чат на этом устройстве, чтобы создать ключ шифрования.'
                    : !peerKey
                      ? 'Ждём, когда собеседник примет секретный чат.'
                      : 'Проверяем ключи шифрования…'}
              </span>
              {!ownKey && (
                <button
                  className="secondary"
                  disabled={busy || disabled}
                  onClick={() => void registerSecret()}
                >
                  {busy ? 'Подключаем…' : 'Принять чат'}
                </button>
              )}
              {secretReady && (
                <button
                  className="icon-button"
                  aria-label="Сверить ключ"
                  onClick={() => setSafetyOpen(true)}
                >
                  <KeyRound size={16} />
                </button>
              )}
            </div>
          )}
          {secretError && (
            <div className="room-error" role="alert">
              {secretError}
              <button
                className="text-button"
                onClick={() => retryKeys((value) => value + 1)}
              >
                Проверить снова
              </button>
            </div>
          )}
          <div
            className="room-message-list"
            ref={scroll}
            onScroll={() => {
              const list = scroll.current;
              if (list)
                follow.current =
                  list.scrollHeight - list.scrollTop - list.clientHeight < 90;
            }}
          >
            {room.nextCursor && (
              <button
                className="room-load-earlier"
                disabled={older}
                onClick={() => {
                  const previous = pageBefore.current;
                  pageBefore.current = room.nextCursor!;
                  paging.current = true;
                  setOlder(true);
                  follow.current = false;
                  void latestLoad
                    .current()
                    .then(() => {
                      if (scroll.current) scroll.current.scrollTop = 0;
                    })
                    .catch((error) => {
                      pageBefore.current = previous;
                      if (alive.current) setError(reason(error));
                    })
                    .finally(() => {
                      paging.current = false;
                      if (alive.current) setOlder(false);
                    });
                }}
              >
                {older ? 'Загружаем…' : 'Предыдущие сообщения'}
              </button>
            )}
            {!room.messages.length && (
              <div className="room-history-empty">
                {room.kind === 'secret' ? (
                  <LockKeyhole size={30} />
                ) : (
                  <Users size={30} />
                )}
                <h3>
                  {room.kind === 'secret'
                    ? 'Только между вами'
                    : 'Здесь начинается ваша группа'}
                </h3>
                <p>
                  {room.kind === 'secret'
                    ? 'После принятия чата обоими участниками можно отправить первое сообщение.'
                    : 'Поздоровайся или пригласи участников по ссылке.'}
                </p>
              </div>
            )}
            {room.messages.map((message) => {
              const self = message.sender === me.id;
              const giveawayEvent = !!message.giveawayId && !message.deletedAt;
              const content = message.deletedAt
                ? 'Сообщение удалено'
                : room.kind === 'secret'
                  ? plaintext[message.id] || 'Зашифрованное сообщение'
                  : message.text;
              const quoted = message.replyTo
                ? room.messages.find((item) => item.id === message.replyTo)
                : null;
              return (
                <div
                  key={message.id}
                  className={
                    giveawayEvent
                      ? 'room-giveaway-event'
                      : 'room-message ' + (self ? 'self' : 'other')
                  }
                >
                  {!giveawayEvent && !self && room.kind === 'group' && (
                    <button
                      className="room-message-avatar"
                      aria-label={'Профиль ' + message.senderName}
                      onClick={() => onProfile(message.sender)}
                    >
                      <Avatar
                        person={{
                          name: message.senderName,
                          avatar: message.senderAvatar,
                        }}
                        size={28}
                      />
                    </button>
                  )}
                  <div
                    className={
                      giveawayEvent
                        ? 'room-giveaway-content'
                        : 'room-bubble' + (message.deletedAt ? ' deleted' : '')
                    }
                  >
                    {!giveawayEvent && !self && room.kind === 'group' && (
                      <button
                        className="room-sender"
                        onClick={() => onProfile(message.sender)}
                      >
                        {message.senderName}
                      </button>
                    )}
                    {message.replyTo && (
                      <div className="room-quote">
                        <Reply size={13} />
                        <span>
                          {quoted && !quoted.deletedAt
                            ? quoted.text.slice(0, 160)
                            : 'Ответ на сообщение'}
                        </span>
                      </div>
                    )}
                    {message.giveawayId && !message.deletedAt ? (
                      <GiveawayCard id={message.giveawayId} viewerId={me.id} />
                    ) : (
                      <p>
                        <MentionText text={content} />
                      </p>
                    )}
                    {room.kind === 'group' && !message.deletedAt && (
                      <MessageReactions
                        reactions={message.reactions}
                        disabled={disabled || !room.canSend || busy}
                        pending={reactionPending.has(message.id)}
                        onReact={(emoji) => reactToMessage(message, emoji)}
                      />
                    )}
                    {giveawayEvent ? (
                      <div className="room-giveaway-meta">
                        <button
                          className="room-giveaway-organizer"
                          aria-label={'Организатор: ' + message.senderName}
                          onClick={() => onProfile(message.sender)}
                        >
                          {message.senderName}
                        </button>
                        <span aria-hidden="true">·</span>
                        <span className="room-message-time">
                          <time
                            dateTime={new Date(message.created).toISOString()}
                          >
                            {time(message.created)}
                          </time>
                        </span>
                      </div>
                    ) : (
                      <span className="room-message-time">
                        {time(message.created)}
                        {self && <Check size={12} />}
                      </span>
                    )}
                  </div>
                  {!message.deletedAt && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="room-message-more icon-button"
                        aria-label={
                          giveawayEvent
                            ? 'Действия с розыгрышем'
                            : 'Действия с сообщением'
                        }
                      >
                        <MoreHorizontal size={16} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="chat-options-menu"
                        align="end"
                      >
                        {room.kind === 'group' && (
                          <DropdownMenuItem
                            disabled={disabled || !room.canSend || pending}
                            onClick={() => setReply(message)}
                          >
                            <Reply size={15} />
                            Ответить
                          </DropdownMenuItem>
                        )}
                        {(self ||
                          (room.role !== 'member' &&
                            room.kind === 'group')) && (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setRemove(message)}
                          >
                            <Trash2 size={15} />
                            Удалить у всех
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
          {pageBefore.current && (
            <button
              className="room-return-new"
              onClick={() => {
                pageBefore.current = '';
                follow.current = true;
                void refresh().catch((error) => setError(reason(error)));
              }}
            >
              К новым сообщениям <ChevronDown size={14} />
            </button>
          )}
          {reply && (
            <div className="room-reply-preview">
              <Reply size={17} />
              <span>
                <strong>{reply.senderName}</strong>
                <small>{reply.text.slice(0, 140)}</small>
              </span>
              <button
                className="icon-button"
                aria-label="Отменить ответ"
                disabled={pending}
                onClick={() => setReply(null)}
              >
                <X size={15} />
              </button>
            </div>
          )}
          <EmojiPreview text={text} />
          <form
            className="room-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <EmojiPicker
              premium={!!me.premium}
              text={text}
              onText={setText}
              disabled={disabled || pending || !room.canSend}
            />
            <textarea
              aria-label="Сообщение"
              placeholder={
                room.kind === 'secret'
                  ? 'Зашифрованное сообщение…'
                  : 'Сообщение в группу…'
              }
              rows={1}
              maxLength={4000}
              value={text}
              disabled={
                disabled ||
                !room.canSend ||
                pending ||
                (room.kind === 'secret' && !secretReady)
              }
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="room-send"
              type="submit"
              aria-label={
                pending ? 'Повторить отправку' : 'Отправить сообщение'
              }
              title={pending ? 'Повторить отправку' : 'Отправить'}
              disabled={
                busy ||
                disabled ||
                !room.canSend ||
                !text.trim() ||
                (room.kind === 'secret' && !secretReady)
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={19} />
              ) : (
                <Send size={19} />
              )}
            </button>
          </form>
          {(!room.canSend || disabled) && (
            <p className="room-write-note">
              Отправка сообщений недоступна из-за ограничений аккаунта или
              настроек приватности.
            </p>
          )}
          {pending && !busy && (
            <p className="room-write-note">
              Ждём подтверждения. Повторная отправка не создаст копию сообщения.
            </p>
          )}
          {room.kind === 'group' && (
            <RoomManagement
              key={room.me + ':' + room.id}
              room={room}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              onRefresh={refresh}
              onLeave={() => {
                onBack();
                void onRoomsChanged();
              }}
              disabled={disabled}
            />
          )}
          <Dialog open={safetyOpen} onOpenChange={setSafetyOpen}>
            <DialogContent
              className="noct-dialog room-safety-dialog"
              overlayClassName="room-dialog-overlay"
            >
              <DialogTitle>
                <ShieldCheck size={22} />
                Секретный чат
              </DialogTitle>
              <DialogDescription>
                Ключи хранятся в браузерах участников. На сервер отправляются
                зашифрованные сообщения.
              </DialogDescription>
              {safety ? (
                <>
                  <h3>Сверьте код лично или по другому доверенному каналу</h3>
                  <code className="room-safety-code">{safety}</code>
                  <p className="room-note">
                    Одинаковый код подтверждает, что вы используете одни и те же
                    ключи. Если он отличается — не отправляйте личные данные.
                  </p>
                </>
              ) : (
                <p className="room-note">
                  Код появится, когда оба участника подключат свои устройства.
                </p>
              )}
              <p className="room-note">
                История доступна только в этих браузерах. Очистка данных сайта
                удалит локальный ключ без возможности восстановления. Это
                шифрование без автоматической смены ключа после каждого
                сообщения.
              </p>
              <button
                className="room-leave text-button"
                onClick={() => setLeaveSecret(true)}
              >
                Закрыть секретный чат
              </button>
            </DialogContent>
          </Dialog>
        </>
      )}
      {mutationError && (
        <div className="room-error" role="alert">
          {mutationError}
        </div>
      )}
      {error && (
        <div className="room-error" role="alert">
          <span>{error}</span>
          {!room && (
            <button
              className="secondary"
              onClick={() => {
                setLoading(true);
                void latestLoad.current().catch(() => {});
              }}
            >
              Попробовать снова
            </button>
          )}
        </div>
      )}
      <Dialog
        open={!!remove || leaveSecret}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setRemove(null);
            setLeaveSecret(false);
          }
        }}
      >
        <DialogContent
          className="noct-dialog room-confirm-dialog"
          overlayClassName="room-dialog-overlay"
        >
          <DialogTitle>
            {leaveSecret
              ? 'Закрыть секретный чат?'
              : 'Удалить сообщение у всех?'}
          </DialogTitle>
          <DialogDescription>
            {leaveSecret
              ? 'Переписка перестанет быть доступна обоим участникам. Для нового разговора создайте новый секретный чат.'
              : 'Сообщение больше не будет доступно участникам чата.'}
          </DialogDescription>
          {mutationError && (
            <p className="room-error" role="alert">
              {mutationError}
            </p>
          )}
          <div className="row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setRemove(null);
                setLeaveSecret(false);
              }}
            >
              Отмена
            </button>
            <span className="grow" />
            <button
              className="danger-button"
              disabled={busy || (disabled && !leaveSecret)}
              onClick={() => {
                if (!room) return;
                setBusy(true);
                setMutationError('');
                void roomAction({
                  actor: me.id,
                  action: leaveSecret ? 'leave' : 'deleteMessage',
                  id: room.id,
                  messageId: remove?.id,
                })
                  .then(async () => {
                    if (!alive.current) return;
                    if (leaveSecret) {
                      onBack();
                      await onRoomsChanged();
                    } else {
                      setRemove(null);
                      await refresh();
                    }
                  })
                  .catch((error) => {
                    if (alive.current) setMutationError(reason(error));
                  })
                  .finally(() => {
                    if (alive.current) setBusy(false);
                  });
              }}
            >
              {busy ? 'Подождите…' : 'Подтвердить'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
