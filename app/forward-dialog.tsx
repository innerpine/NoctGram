'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useState } from 'react';
import { Check, Forward, LoaderCircle, Search, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Message, Person } from '@/lib/client';
import type { RoomSummary } from '@/lib/rooms-types';
import { chatRequest } from '@/lib/chat-client';
import { messageSummary } from '@/lib/chat-message-display';
import {
  FORWARD_TARGET_LIMIT,
  loadForwardTargets,
  type ForwardChoice,
  type ForwardResponse,
  type ForwardSource,
} from '@/lib/forward-client';
import { useDialogMutation } from './chat-dialog-mutation';
import { ChatEmojiText } from './chat-emoji-text';
import { Avatar } from './profile-identity';
import { SAVED_MESSAGES, SavedMessagesAvatar } from './saved-messages';

type Option = ForwardChoice & {
  subtitle: string;
  person?: Person;
  room?: RoomSummary;
  time: number;
};
function personOption(person: Person): Option {
  return {
    key: 'dm:' + person.id,
    target: { dm: { peer: person.id } },
    name: person.name,
    subtitle: person.handle ? '@' + person.handle : 'Личный чат',
    person,
    time: person.lastTime || 0,
  };
}
function roomOption(room: RoomSummary): Option {
  return {
    key: 'room:' + room.id,
    target: { room: { roomId: room.id } },
    name: room.name || 'Группа',
    subtitle: `Группа · ${room.memberCount} участников`,
    room,
    time: room.lastMessage?.created || room.updatedAt,
  };
}

// Forwards messages or a feed post to up to ten chats at once, with
// «Избранное» first, like Telegram's share sheet. An optional comment is sent
// before the forwarded messages.
export function ChatForwardDialog({
  me,
  source,
  preview,
  count,
  messages,
  peer,
  threads = [],
  rooms = [],
  fetchTargets = false,
  onClose,
  onDone,
}: {
  me: Pick<Person, 'id'>;
  source?: ForwardSource;
  preview?: string;
  count?: number;
  messages?: Message[];
  peer?: Pick<Person, 'id'>;
  threads?: Person[];
  rooms?: RoomSummary[];
  fetchTargets?: boolean;
  onClose: () => void;
  onDone: (result: ForwardResponse, chosen: ForwardChoice[]) => void;
}) {
  const [origin] = useState<ForwardSource>(
    () =>
      source ?? {
        dm: {
          peer: peer?.id || '',
          ids: [...(messages || [])]
            .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
            .map((message) => message.id),
        },
      },
  );
  const total = count ?? messages?.length ?? 1;
  const summary =
    preview ?? (messages?.length ? messageSummary(messages[0]) : '');
  const [key] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState(''),
    [found, setFound] = useState<Person[]>([]),
    [searchError, setSearchError] = useState(''),
    [searching, setSearching] = useState(false),
    [loaded, setLoaded] = useState<{
      threads: Person[];
      rooms: RoomSummary[];
    } | null>(null),
    [chosen, setChosen] = useState<ForwardChoice[]>([]),
    [comment, setComment] = useState(''),
    [limit, setLimit] = useState(false);
  const mutation = useDialogMutation<ForwardResponse>(
    (result) => onDone(result, chosen),
    onClose,
  );
  useEffect(() => {
    if (!fetchTargets || !me.id) return;
    const controller = new AbortController();
    void loadForwardTargets(me.id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setLoaded(value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [fetchTargets, me.id]);
  useEffect(() => {
    const controller = new AbortController();
    setSearchError('');
    if (!query.trim()) {
      setFound([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void chatRequest<Person[]>(
        '/api/social?action=people&q=' + encodeURIComponent(query.trim()),
        { signal: controller.signal },
      )
        .then((rows) => {
          if (!controller.signal.aborted) setFound(rows);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setSearchError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const person = (item: Person) =>
    item.id !== me.id &&
    item.id !== 'noctgram' &&
    (!item.kind || item.kind === 'person');
  const people = new Map<string, Person>();
  for (const item of [...threads, ...(loaded?.threads || [])])
    if (person(item)) people.set(item.id, item);
  const groups = new Map<string, RoomSummary>();
  for (const room of [...rooms, ...(loaded?.rooms || [])])
    if (room.kind === 'group') groups.set(room.id, room);
  const needle = query.trim().toLowerCase().replace(/^@/, '');
  const matches = (option: Option) =>
    !needle ||
    option.name.toLowerCase().includes(needle) ||
    !!option.person?.handle?.toLowerCase().includes(needle);
  const recent = [
    ...[...people.values()].map(personOption),
    ...[...groups.values()].map(roomOption),
  ]
    .filter(matches)
    .sort((a, b) => b.time - a.time);
  const extra = found
    .filter((item) => person(item) && !people.has(item.id))
    .map(personOption);
  const saved: Option = {
    key: 'dm:' + me.id,
    target: { dm: { peer: me.id } },
    name: SAVED_MESSAGES,
    subtitle: 'Сохранить для себя',
    saved: true,
    time: Infinity,
  };
  const options = [
    ...(!needle || SAVED_MESSAGES.toLowerCase().includes(needle)
      ? [saved]
      : []),
    ...recent,
    ...extra,
  ];
  const toggle = (option: Option) => {
    const active = chosen.some((item) => item.key === option.key);
    setLimit(!active && chosen.length >= FORWARD_TARGET_LIMIT);
    if (active) setChosen(chosen.filter((item) => item.key !== option.key));
    else if (chosen.length < FORWARD_TARGET_LIMIT)
      setChosen([
        ...chosen,
        {
          key: option.key,
          target: option.target,
          name: option.name,
          ...(option.saved ? { saved: true } : {}),
        },
      ]);
  };
  const post = 'post' in origin;
  return (
    <Dialog {...mutation.dialogProps}>
      <DialogContent
        className="noct-dialog chat-operation-dialog chat-forward-dialog"
        showCloseButton={!mutation.frozen}
      >
        <DialogTitle>
          {post
            ? 'Поделиться публикацией'
            : total > 1
              ? `Переслать · ${total}`
              : 'Переслать сообщение'}
        </DialogTitle>
        <DialogDescription>
          Выбери до {FORWARD_TARGET_LIMIT} чатов — можно отправить и себе в «
          {SAVED_MESSAGES}».
        </DialogDescription>
        {!!summary && (
          <div className="chat-operation-preview">
            <ChatEmojiText text={summary} mentions={false} />
          </div>
        )}
        <label className="chat-forward-search">
          <Search size={18} />
          <input
            aria-label="Найти чат"
            placeholder="Имя, @ник или группа"
            value={query}
            disabled={mutation.frozen}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="chat-forward-people" aria-label="Чаты">
          {options.map((option) => {
            const active = chosen.some((item) => item.key === option.key);
            return (
              <button
                type="button"
                key={option.key}
                disabled={mutation.frozen}
                className={active ? 'chosen' : ''}
                aria-pressed={active}
                onClick={() => toggle(option)}
              >
                {option.saved ? (
                  <SavedMessagesAvatar size={36} />
                ) : option.room ? (
                  <span className="room-avatar-wrap">
                    <Avatar
                      person={{ name: option.name, avatar: option.room.avatar }}
                      size={36}
                    />
                    <span className="room-avatar-kind" aria-hidden="true">
                      <Users size={10} />
                    </span>
                  </span>
                ) : (
                  <Avatar person={option.person!} size={36} />
                )}
                <span className="chat-forward-person-copy">
                  <strong>{option.name}</strong>
                  <small>{option.subtitle}</small>
                </span>
                <span className="chat-forward-check" aria-hidden="true">
                  {active && <Check size={14} />}
                </span>
              </button>
            );
          })}
          {options.length === 0 && (
            <p>
              {searchError ||
                (searching ? 'Ищем…' : 'Ничего не нашли. Попробуй @ник')}
            </p>
          )}
        </div>
        {chosen.length > 0 && (
          <p className="chat-operation-note">
            {limit ? 'Можно выбрать до 10 чатов. ' : ''}Получатели:{' '}
            <strong>{chosen.map((item) => item.name).join(', ')}</strong>
          </p>
        )}
        {chosen.length > 0 && (
          <textarea
            className="chat-forward-comment"
            aria-label="Комментарий к пересылке"
            placeholder="Добавить комментарий"
            rows={2}
            maxLength={4000}
            value={comment}
            disabled={mutation.frozen}
            onChange={(event) => setComment(event.target.value)}
          />
        )}
        {mutation.error && (
          <p role="alert" className="chat-send-error">
            {mutation.error}
          </p>
        )}
        <div className="chat-operation-buttons">
          <button
            className="secondary"
            disabled={mutation.frozen}
            onClick={mutation.close}
          >
            Отмена
          </button>
          <button
            className="primary"
            disabled={!chosen.length || mutation.busy}
            onClick={() =>
              void mutation.submit(
                {
                  key,
                  source: origin,
                  targets: chosen.map((item) => item.target),
                  ...(comment.trim() ? { comment: comment.trim() } : {}),
                },
                '/api/chat-forward',
              )
            }
          >
            {mutation.busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Forward size={17} />
            )}
            {mutation.uncertain
              ? 'Повторить'
              : chosen.length > 1
                ? `Отправить в ${chosen.length}`
                : 'Отправить'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
