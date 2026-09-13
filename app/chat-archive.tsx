'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  MoreHorizontal,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { request } from '@/lib/client';
import { roomAction } from '@/lib/rooms-client';
import { ChatNotificationsItem } from './chat-notifications';

export function ArchiveRow({
  owner,
  id,
  kind,
  archived,
  onDone,
  children,
}: {
  owner: string;
  id: string;
  kind: 'person' | 'room';
  archived: boolean;
  onDone: () => Promise<unknown>;
  children: ReactNode;
}) {
  const alive = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const move = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      if (kind === 'room')
        await roomAction({
          action: 'archive',
          id,
          actor: owner,
          archived: !archived,
        });
      else
        await request('', {
          action: 'archiveChat',
          peer: id,
          actor: owner,
          archived: !archived,
        });
      if (alive.current) await onDone();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : 'Не удалось переместить чат');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className="archive-row-wrap">
      {children}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          className="icon-button archive-row-menu"
          aria-label="Действия с чатом"
          disabled={busy}
        >
          <MoreHorizontal size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="room-menu">
          {kind === 'person' && menuOpen && (
            <ChatNotificationsItem
              key={owner + ':' + id}
              owner={owner}
              peer={id}
            />
          )}
          <DropdownMenuItem onClick={() => void move()}>
            {archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{' '}
            {archived ? 'Вернуть из архива' : 'В архив'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <span className="archive-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
export function ArchiveFolderButton({
  archived,
  count,
  unread,
  onClick,
}: {
  archived: boolean;
  count: number;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button className="archive-folder" onClick={onClick}>
      <span className="archive-folder-icon">
        {archived ? <ArrowLeft size={19} /> : <Archive size={19} />}
      </span>
      <span>
        <strong>{archived ? 'Все диалоги' : 'Архив'}</strong>
        <small>
          {archived
            ? 'Вернуться к разговорам'
            : count
              ? `${count} чатов`
              : 'Сохрани здесь тихие разговоры'}
        </small>
      </span>
      {!archived && unread > 0 && (
        <span className="unread">{unread > 99 ? '99+' : unread}</span>
      )}
    </button>
  );
}
