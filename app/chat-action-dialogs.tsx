'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import { Check, Forward, LoaderCircle, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Message, Person } from '@/lib/client';
import { chatRequest } from '@/lib/chat-client';
import { ChatTextEditor } from './chat-text-editor';
import { ChatEmojiText } from './chat-emoji-text';
import { messageSummary } from '@/lib/chat-message-display';
import { Avatar } from './profile-identity';

function useMutation(onDone: () => void, onClose: () => void) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState('');
  const attempt = useRef<Record<string, unknown> | null>(null),
    locked = useRef(false),
    completed = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const submit = async (body: Record<string, unknown>) => {
    if (locked.current || !open) return;
    locked.current = true;
    setBusy(true);
    setError('');
    attempt.current ??= body;
    try {
      await chatRequest('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt.current),
        signal: AbortSignal.timeout(30000),
      });
      if (alive.current) {
        completed.current = true;
        setOpen(false);
        onDone();
      }
    } catch (error) {
      if (!alive.current) return;
      const status = (error as { status?: number }).status;
      const unknown = !status || status >= 500;
      setUncertain(unknown);
      if (!unknown) attempt.current = null;
      setError(
        unknown
          ? 'Ответ не получен. Повтори действие — оно не продублируется.'
          : error instanceof Error
            ? error.message
            : 'Не удалось выполнить действие',
      );
    } finally {
      locked.current = completed.current;
      if (alive.current) setBusy(completed.current);
    }
  };
  const close = () => {
    if (!locked.current && !uncertain) {
      locked.current = true;
      setOpen(false);
    }
  };
  return {
    busy: busy || !open,
    frozen: busy || uncertain || !open,
    uncertain,
    error,
    submit,
    close,
    dialogProps: {
      open,
      onOpenChange: (next: boolean) => {
        if (!next) close();
      },
      onOpenChangeComplete: (next: boolean) => {
        if (!next) onClose();
      },
    },
  };
}
type Shared = { peer: Person; onClose: () => void; onDone: () => void };
export function ChatDeleteDialog({
  messages,
  peer,
  onClose,
  onDone,
}: Shared & { messages: Message[] }) {
  const [everyone, setEveryone] = useState(false);
  const mutation = useMutation(onDone, onClose);
  const messageWord = {
    one: 'сообщение',
    few: 'сообщения',
    many: 'сообщений',
    other: 'сообщений',
    zero: 'сообщений',
    two: 'сообщения',
  }[new Intl.PluralRules('ru').select(messages.length)];
  return (
    <Dialog {...mutation.dialogProps}>
      <DialogContent
        className="noct-dialog chat-operation-dialog chat-delete-dialog"
        overlayClassName="chat-delete-backdrop"
        showCloseButton={false}
      >
        <DialogTitle>
          {messages.length > 1
            ? `Удалить ${messages.length} ${messageWord}?`
            : 'Удалить сообщение?'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Без галочки сообщения удалятся только у тебя.
        </DialogDescription>
        <label className="chat-delete-choice">
          <input
            type="checkbox"
            checked={everyone}
            disabled={mutation.frozen}
            onChange={(event) => setEveryone(event.target.checked)}
          />
          <span>
            Также удалить для <bdi>{peer.name}</bdi>
          </span>
        </label>
        {messages.some((message) => message.gift) && (
          <p className="chat-operation-note">
            Сам подарок останется в профиле получателя.
          </p>
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
            className="chat-delete-confirm"
            disabled={mutation.busy}
            onClick={() =>
              void mutation.submit({
                action: 'messageDelete',
                peer: peer.id,
                ids: messages.map((message) => message.id),
                everyone,
              })
            }
          >
            {mutation.busy && <LoaderCircle className="spin" size={17} />}
            {mutation.busy
              ? 'Удаляем…'
              : mutation.uncertain
                ? 'Повторить'
                : 'Удалить'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function ChatEditDialog({
  message,
  peer,
  onClose,
  onDone,
}: Shared & { message: Message }) {
  const [text, setText] = useState(message.text);
  const mutation = useMutation(onDone, onClose);
  return (
    <Dialog {...mutation.dialogProps}>
      <DialogContent
        className="noct-dialog chat-operation-dialog"
        showCloseButton={!mutation.frozen}
      >
        <DialogTitle>
          {message.attachments?.length
            ? 'Изменить подпись'
            : 'Изменить сообщение'}
        </DialogTitle>
        <DialogDescription>Изменения увидит и собеседник.</DialogDescription>
        <ChatTextEditor
          className="chat-edit-text"
          label="Текст сообщения"
          value={text}
          disabled={mutation.frozen}
          onChange={setText}
        />
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
            disabled={
              mutation.busy || (!text.trim() && !message.attachments?.length)
            }
            onClick={() =>
              void mutation.submit({
                action: 'messageEdit',
                peer: peer.id,
                id: message.id,
                text,
                revision: message.editedAt || 0,
              })
            }
          >
            {mutation.busy && <LoaderCircle className="spin" size={17} />}
            {mutation.uncertain ? 'Повторить' : 'Сохранить'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function ChatForwardDialog({
  messages,
  peer,
  me,
  threads,
  onClose,
  onDone,
}: Shared & { messages: Message[]; me: Person; threads: Person[] }) {
  const [query, setQuery] = useState(''),
    [people, setPeople] = useState(threads),
    [recipient, setRecipient] = useState<Person | null>(null),
    [searchError, setSearchError] = useState(''),
    [searching, setSearching] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const mutation = useMutation(onDone, onClose);
  useEffect(() => {
    const controller = new AbortController();
    setSearchError('');
    if (!query.trim()) {
      setPeople(threads);
      setSearching(false);
      return;
    }
    setPeople([]);
    setSearching(true);
    const timer = setTimeout(() => {
      void chatRequest<Person[]>(
        '/api/social?action=people&q=' + encodeURIComponent(query.trim()),
        { signal: controller.signal },
      )
        .then((rows) => {
          if (!controller.signal.aborted) setPeople(rows);
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
  }, [query, threads]);
  const recipients = people.filter(
    (person) =>
      person.id !== me.id &&
      person.id !== 'noctgram' &&
      (!person.kind || person.kind === 'person'),
  );
  return (
    <Dialog {...mutation.dialogProps}>
      <DialogContent
        className="noct-dialog chat-operation-dialog chat-forward-dialog"
        showCloseButton={!mutation.frozen}
      >
        <DialogTitle>
          Переслать
          {messages.length > 1 ? ` · ${messages.length}` : ' сообщение'}
        </DialogTitle>
        <DialogDescription>
          Выбери, кому отправить{' '}
          {messages.length > 1 ? 'выбранные сообщения' : 'это сообщение'}.
        </DialogDescription>
        <div className="chat-operation-preview">
          <ChatEmojiText text={messageSummary(messages[0])} mentions={false} />
        </div>
        <label className="chat-forward-search">
          <Search size={18} />
          <input
            aria-label="Найти получателя"
            placeholder="Имя или @ник"
            value={query}
            disabled={mutation.frozen}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="chat-forward-people">
          {recipients.map((person) => (
            <button
              type="button"
              key={person.id}
              disabled={mutation.frozen}
              className={recipient?.id === person.id ? 'chosen' : ''}
              aria-pressed={recipient?.id === person.id}
              onClick={() => setRecipient(person)}
            >
              <Avatar person={person} size={36} />
              <span className="chat-forward-person-copy">
                <strong>{person.name}</strong>
                <small>@{person.handle}</small>
              </span>
              {recipient?.id === person.id && <Check size={18} />}
            </button>
          ))}
          {!recipients.length && (
            <p>
              {searchError ||
                (searching
                  ? 'Ищем…'
                  : query
                    ? 'Никого не нашли'
                    : 'Найди получателя по имени или @нику')}
            </p>
          )}
        </div>
        {recipient && (
          <p className="chat-operation-note">
            Получатель: <strong>{recipient.name}</strong>
          </p>
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
            disabled={!recipient || mutation.busy}
            onClick={() =>
              void mutation.submit({
                action: 'messageForward',
                peer: peer.id,
                ids: [...messages]
                  .sort(
                    (a, b) => a.created - b.created || a.id.localeCompare(b.id),
                  )
                  .map((message) => message.id),
                recipient: recipient!.id,
                key,
              })
            }
          >
            {mutation.busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Forward size={17} />
            )}
            {mutation.uncertain ? 'Повторить пересылку' : 'Переслать'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
