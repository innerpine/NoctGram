'use client';
import { useState } from 'react';
import {
  Lock,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Unlock,
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
import {
  GENERAL_TOPIC,
  TOPIC_COLORS,
  TOPIC_EMOJI,
  TOPIC_TITLE_LIMIT,
  type RoomTopic,
} from '@/lib/room-topic-shared';
import { emojiFallback } from '@/lib/premium-emoji';
import { TopicIcon } from './topic-icon';

const clock = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});
const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
const day = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
});
function when(time: number) {
  const date = new Date(time),
    now = new Date();
  if (date.toDateString() === now.toDateString()) return clock.format(date);
  if (now.getTime() - time < 6 * 86400000) return weekday.format(date);
  return day.format(date);
}
const reason = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось изменить тему';

export type TopicDraft = { title: string; color: number; emoji: string };
export function TopicEditorDialog({
  open,
  initial,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  initial?: TopicDraft;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: TopicDraft) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title || ''),
    [color, setColor] = useState(initial?.color ?? 0),
    [emoji, setEmoji] = useState(initial?.emoji || ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="noct-dialog topic-editor-dialog">
        <DialogTitle>{initial ? 'Изменить тему' : 'Новая тема'}</DialogTitle>
        <DialogDescription>
          Название, цвет и значок помогут найти тему в списке.
        </DialogDescription>
        <form
          className="topic-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !title.trim()) return;
            setBusy(true);
            setError('');
            void onSubmit({ title, color, emoji })
              .then(() => onOpenChange(false))
              .catch((cause) => setError(reason(cause)))
              .finally(() => setBusy(false));
          }}
        >
          <div className="topic-editor-title">
            <TopicIcon
              title={title || 'Т'}
              color={color}
              emoji={emoji}
              size={44}
            />
            <input
              className="room-text-input"
              aria-label="Название темы"
              placeholder="Название темы"
              value={title}
              maxLength={TOPIC_TITLE_LIMIT}
              required
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <fieldset className="topic-colors" disabled={busy}>
            <legend>Цвет</legend>
            {TOPIC_COLORS.map((value, index) => (
              <button
                type="button"
                key={value}
                className={color === index ? 'selected' : ''}
                style={{ background: value }}
                aria-label={'Цвет ' + (index + 1)}
                aria-pressed={color === index}
                onClick={() => setColor(index)}
              />
            ))}
          </fieldset>
          <fieldset className="topic-emoji" disabled={busy}>
            <legend>Значок</legend>
            <button
              type="button"
              className={!emoji ? 'selected' : ''}
              aria-pressed={!emoji}
              onClick={() => setEmoji('')}
            >
              <TopicIcon title={title || 'Т'} color={color} size={26} />
            </button>
            {TOPIC_EMOJI.map((value) => (
              <button
                type="button"
                key={value}
                className={emoji === value ? 'selected' : ''}
                aria-label={'Значок ' + value}
                aria-pressed={emoji === value}
                onClick={() => setEmoji(value)}
              >
                {value}
              </button>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="room-error">
              {error}
            </p>
          )}
          <div className="chat-operation-buttons">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </button>
            <button className="primary" disabled={busy || !title.trim()}>
              {busy && <LoaderCircle className="spin" size={16} />}
              {initial ? 'Сохранить' : 'Создать тему'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The topic list of a forum group, shown in place of the message history.
export function RoomTopicList({
  room,
  meId,
  disabled,
  onOpen,
  onChanged,
}: {
  room: RoomDetail;
  meId: string;
  disabled: boolean;
  onOpen: (topic: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<RoomTopic | 'new' | null>(null),
    [removing, setRemoving] = useState<RoomTopic | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const manager = room.role === 'owner' || room.role === 'admin';
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const result = await roomAction<{ id?: string }>({
        actor: meId,
        id: room.id,
        ...body,
      });
      await onChanged();
      return result;
    } catch (cause) {
      setError(reason(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  };
  const topics = room.topics || [];
  return (
    <div className="room-topic-list">
      {manager && (
        <button
          type="button"
          className="room-topic-create"
          disabled={disabled || busy}
          onClick={() => setEditing('new')}
        >
          <Plus size={18} />
          Создать тему
        </button>
      )}
      {error && (
        <div className="room-error" role="alert">
          {error}
        </div>
      )}
      {topics.map((topic) => {
        const general = topic.id === GENERAL_TOPIC;
        const editable =
          !general && !disabled && (manager || topic.createdBy === meId);
        const last = topic.lastMessage;
        return (
          <div
            key={topic.id}
            className={'room-topic-row' + (topic.closedAt ? ' closed' : '')}
          >
            <button
              type="button"
              className="room-topic-open"
              aria-label={'Открыть тему ' + topic.title}
              onClick={() => onOpen(topic.id)}
            >
              <TopicIcon
                title={topic.title}
                color={topic.color}
                emoji={topic.emoji}
                general={general}
                size={40}
              />
              <span className="room-topic-copy">
                <strong>
                  {topic.title}
                  {!!topic.closedAt && (
                    <Lock size={12} aria-label="Тема закрыта" />
                  )}
                </strong>
                <small>
                  {last
                    ? (last.sender === meId ? 'Вы' : last.senderName) +
                      ': ' +
                      (emojiFallback(last.text) || 'Сообщение')
                    : general
                      ? 'Общие разговоры группы'
                      : 'Пока нет сообщений'}
                </small>
              </span>
              <span className="room-topic-meta">
                {last && <time>{when(last.created)}</time>}
                {!!topic.unread && (
                  <span className="unread">
                    {topic.unread > 99 ? '99+' : topic.unread}
                  </span>
                )}
              </span>
            </button>
            {editable && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="room-topic-more icon-button"
                  aria-label={'Действия с темой ' + topic.title}
                >
                  <MoreHorizontal size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="chat-options-menu" align="end">
                  <DropdownMenuItem onClick={() => setEditing(topic)}>
                    <Pencil size={15} />
                    Изменить
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      void act({
                        action: topic.closedAt ? 'topicReopen' : 'topicClose',
                        topicId: topic.id,
                      }).catch(() => {})
                    }
                  >
                    {topic.closedAt ? <Unlock size={15} /> : <Lock size={15} />}
                    {topic.closedAt ? 'Открыть тему' : 'Закрыть тему'}
                  </DropdownMenuItem>
                  {manager && (
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setRemoving(topic)}
                    >
                      <Trash2 size={15} />
                      Удалить
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}
      {editing && (
        <TopicEditorDialog
          key={editing === 'new' ? 'new' : editing.id}
          open
          initial={
            editing === 'new'
              ? undefined
              : {
                  title: editing.title,
                  color: editing.color,
                  emoji: editing.emoji,
                }
          }
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSubmit={async (draft) => {
            if (editing === 'new') {
              const created = await act({ action: 'topicCreate', ...draft });
              if (created.id) onOpen(created.id);
            } else
              await act({
                action: 'topicUpdate',
                topicId: editing.id,
                ...draft,
              });
          }}
        />
      )}
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <DialogContent className="noct-dialog chat-operation-dialog">
          <DialogTitle>Удалить тему «{removing?.title}»?</DialogTitle>
          <DialogDescription>
            Все сообщения темы удалятся у всех участников.
          </DialogDescription>
          <div className="chat-operation-buttons">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              Отмена
            </button>
            <button
              className="chat-delete-confirm"
              disabled={busy}
              onClick={() =>
                removing &&
                void act({ action: 'topicDelete', topicId: removing.id })
                  .then(() => setRemoving(null))
                  .catch(() => {})
              }
            >
              {busy && <LoaderCircle className="spin" size={16} />}
              Удалить тему
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
