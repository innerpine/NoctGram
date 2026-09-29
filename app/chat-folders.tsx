'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FolderPlus,
  LoaderCircle,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  FOLDER_TITLE_LIMIT,
  folderIncludes,
  type ChatFolder,
  type FolderChat,
} from '@/lib/chat-folders-filter';
import {
  currentFolders,
  deleteChatFolder,
  reorderChatFolders,
  saveChatFolder,
  useChatFolders,
  type FolderDraft,
} from '@/lib/chat-folders-store';

export type FolderPick = FolderChat & { name: string };
const FOLDER_EMOJI = [
  '📁',
  '💼',
  '👥',
  '❤️',
  '⭐',
  '🎮',
  '📚',
  '🏠',
  '✈️',
  '🔔',
];
const reason = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось сохранить папку';

function ChatPicker({
  label,
  chats,
  value,
  blocked,
  onChange,
}: {
  label: string;
  chats: FolderPick[];
  value: string[];
  blocked: string[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const chosen = chats.filter((chat) => value.includes(chat.key));
  const needle = query.trim().toLocaleLowerCase('ru');
  return (
    <fieldset className="folder-picker">
      <legend>{label}</legend>
      {chosen.map((chat) => (
        <span key={chat.key} className="folder-chip">
          {chat.name}
          <button
            type="button"
            aria-label={'Убрать ' + chat.name}
            onClick={() => onChange(value.filter((key) => key !== chat.key))}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="folder-picker-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Готово' : 'Выбрать чаты'}
      </button>
      {open && (
        <div className="folder-picker-list">
          <label className="chat-forward-search">
            <Search size={16} />
            <input
              aria-label={'Найти чат: ' + label}
              placeholder="Имя чата"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {chats
            .filter(
              (chat) =>
                !blocked.includes(chat.key) &&
                (!needle || chat.name.toLocaleLowerCase('ru').includes(needle)),
            )
            .map((chat) => {
              const active = value.includes(chat.key);
              return (
                <button
                  type="button"
                  key={chat.key}
                  aria-pressed={active}
                  className={active ? 'chosen' : ''}
                  onClick={() =>
                    onChange(
                      active
                        ? value.filter((key) => key !== chat.key)
                        : [...value, chat.key],
                    )
                  }
                >
                  <span>{chat.name}</span>
                  <small>
                    {chat.kind === 'person'
                      ? 'Личный'
                      : chat.kind === 'group'
                        ? 'Группа'
                        : 'Секретный'}
                  </small>
                  {active && <Check size={15} />}
                </button>
              );
            })}
        </div>
      )}
    </fieldset>
  );
}

export function FolderEditorDialog({
  owner,
  folder,
  chats,
  onClose,
  onSaved,
}: {
  owner: string;
  folder: ChatFolder | null;
  chats: FolderPick[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [draft, setDraft] = useState<FolderDraft>(() =>
    folder
      ? { ...folder }
      : {
          title: '',
          emoji: '📁',
          includePersonal: false,
          includeGroups: false,
          includeSecret: false,
          excludeRead: false,
          excludeArchived: false,
          includePeers: [],
          excludePeers: [],
        },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const patch = (value: Partial<FolderDraft>) =>
    setDraft((current) => ({ ...current, ...value }));
  const toggle = (
    key:
      | 'includePersonal'
      | 'includeGroups'
      | 'includeSecret'
      | 'excludeRead'
      | 'excludeArchived',
    text: string,
  ) => (
    <label className="folder-option">
      <input
        type="checkbox"
        checked={draft[key]}
        disabled={busy}
        onChange={(event) => patch({ [key]: event.target.checked })}
      />
      <span>{text}</span>
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="noct-dialog folder-editor-dialog">
        <DialogTitle>{folder ? 'Изменить папку' : 'Новая папка'}</DialogTitle>
        <DialogDescription>
          Папка покажет только выбранные типы чатов и отмеченные чаты.
        </DialogDescription>
        <form
          className="folder-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            void saveChatFolder(owner, draft)
              .then((result) => {
                onSaved(result.id || draft.id || '');
                onClose();
              })
              .catch((cause) => setError(reason(cause)))
              .finally(() => setBusy(false));
          }}
        >
          <div className="folder-title-row">
            <span className="folder-emoji-preview" aria-hidden="true">
              {draft.emoji || '📁'}
            </span>
            <input
              className="room-text-input"
              aria-label="Название папки"
              placeholder="Название папки"
              value={draft.title}
              maxLength={FOLDER_TITLE_LIMIT}
              required
              disabled={busy}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </div>
          <div className="folder-emoji">
            {FOLDER_EMOJI.map((value) => (
              <button
                type="button"
                key={value}
                aria-label={'Значок ' + value}
                aria-pressed={draft.emoji === value}
                className={draft.emoji === value ? 'selected' : ''}
                onClick={() => patch({ emoji: value })}
              >
                {value}
              </button>
            ))}
          </div>
          <fieldset className="folder-types">
            <legend>Типы чатов</legend>
            {toggle('includePersonal', 'Личные')}
            {toggle('includeGroups', 'Группы')}
            {toggle('includeSecret', 'Секретные')}
          </fieldset>
          <ChatPicker
            label="Всегда показывать"
            chats={chats}
            value={draft.includePeers}
            blocked={draft.excludePeers}
            onChange={(includePeers) => patch({ includePeers })}
          />
          <ChatPicker
            label="Не показывать"
            chats={chats}
            value={draft.excludePeers}
            blocked={draft.includePeers}
            onChange={(excludePeers) => patch({ excludePeers })}
          />
          <fieldset className="folder-types">
            <legend>Скрыть</legend>
            {toggle('excludeRead', 'Прочитанные')}
            {toggle('excludeArchived', 'Архивные')}
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
              onClick={onClose}
            >
              Отмена
            </button>
            <button className="primary" disabled={busy || !draft.title.trim()}>
              {busy && <LoaderCircle className="spin" size={16} />}
              {folder ? 'Сохранить' : 'Создать папку'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Folder tabs above the chat list with unread badges, like Telegram.
export function ChatFolderBar({
  owner,
  chats,
  active,
  onSelect,
}: {
  owner: string;
  chats: FolderPick[];
  active: string;
  onSelect: (folder: ChatFolder | null) => void;
}) {
  const { folders, limit } = useChatFolders(owner);
  const [editing, setEditing] = useState<ChatFolder | 'new' | null>(null),
    [error, setError] = useState('');
  // Keep the selected folder in step with edits and deletions.
  useEffect(() => {
    if (!active) return;
    const current = folders.find((folder) => folder.id === active);
    onSelect(current || null);
  }, [folders, active, onSelect]);
  const move = (index: number, step: number) => {
    const ids = folders.map((folder) => folder.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + step, 0, id);
    void reorderChatFolders(owner, ids).catch((cause) =>
      setError(reason(cause)),
    );
  };
  const unread = (folder: ChatFolder) =>
    chats.filter((chat) => chat.unread > 0 && folderIncludes(folder, chat))
      .length;
  return (
    <>
      <div className="chat-folder-bar" role="tablist" aria-label="Папки чатов">
        <button
          type="button"
          role="tab"
          aria-selected={!active}
          className={!active ? 'active' : ''}
          onClick={() => onSelect(null)}
        >
          Все чаты
        </button>
        {folders.map((folder, index) => {
          const count = unread(folder);
          return (
            <ContextMenu key={folder.id}>
              <ContextMenuTrigger
                render={
                  <button type="button" aria-label={'Папка ' + folder.title} />
                }
                role="tab"
                aria-selected={active === folder.id}
                className={active === folder.id ? 'active' : ''}
                onClick={() => onSelect(folder)}
              >
                {folder.emoji && <span aria-hidden="true">{folder.emoji}</span>}
                {folder.title}
                {count > 0 && (
                  <span className="unread">{count > 99 ? '99+' : count}</span>
                )}
              </ContextMenuTrigger>
              <ContextMenuContent className="chat-action-menu">
                <ContextMenuItem onClick={() => setEditing(folder)}>
                  <Pencil />
                  Изменить папку
                </ContextMenuItem>
                {index > 0 && (
                  <ContextMenuItem onClick={() => move(index, -1)}>
                    <ArrowLeft />
                    Сдвинуть левее
                  </ContextMenuItem>
                )}
                {index < folders.length - 1 && (
                  <ContextMenuItem onClick={() => move(index, 1)}>
                    <ArrowRight />
                    Сдвинуть правее
                  </ContextMenuItem>
                )}
                <ContextMenuItem
                  variant="destructive"
                  onClick={() =>
                    void deleteChatFolder(owner, folder.id).catch((cause) =>
                      setError(reason(cause)),
                    )
                  }
                >
                  <Trash2 />
                  Удалить папку
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {folders.length < limit && (
          <button
            type="button"
            className="chat-folder-add icon-button"
            aria-label="Новая папка"
            title="Новая папка"
            onClick={() => setEditing('new')}
          >
            <FolderPlus size={16} />
          </button>
        )}
      </div>
      {error && (
        <p className="archive-error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <FolderEditorDialog
          owner={owner}
          folder={editing === 'new' ? null : editing}
          chats={chats}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            if (editing !== 'new' || !id) return;
            const created = currentFolders().find((folder) => folder.id === id);
            if (created) onSelect(created);
          }}
        />
      )}
    </>
  );
}
