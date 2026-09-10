'use client';
import { emojiFallback } from '@/lib/premium-emoji';
/* eslint-disable react/react-compiler */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LockKeyhole, Users, RefreshCw } from 'lucide-react';
import { roomRequest } from '@/lib/rooms-client';
import type { RoomPreview, RoomSummary } from '@/lib/rooms-types';
import { Avatar } from './post-card';

export function useRoomList(owner: string, active: boolean) {
  const [state, setState] = useState<{
    owner: string;
    rooms: RoomSummary[];
    error: string;
  }>({ owner: '', rooms: [], error: '' });
  const current = useRef(owner),
    revision = useRef(0),
    fetching = useRef(false),
    controller = useRef<AbortController | null>(null);
  current.current = owner;
  const refresh = useCallback(async () => {
    if (!owner) return;
    const ticket = ++revision.current;
    controller.current?.abort();
    controller.current = new AbortController();
    fetching.current = true;
    try {
      const pages = await Promise.all(
        ['0', '1'].map((archived) =>
          roomRequest<{ rooms: RoomSummary[] }>(
            { action: 'list', actor: owner, archived },
            controller.current!.signal,
          ),
        ),
      );
      if (current.current === owner && ticket === revision.current)
        setState({
          owner,
          rooms: [
            ...new Map(
              pages.flatMap((data) => data.rooms).map((r) => [r.id, r]),
            ).values(),
          ],
          error: '',
        });
    } catch (error) {
      if (current.current === owner && ticket === revision.current)
        setState((previous) => ({
          owner,
          rooms:
            ![401, 403].includes(
              Number((error as { status?: number }).status),
            ) && previous.owner === owner
              ? previous.rooms
              : [],
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось загрузить группы',
        }));
    } finally {
      if (ticket === revision.current) fetching.current = false;
    }
  }, [owner]);
  useEffect(() => {
    if (!owner) return;
    const abortLatestRequest = () => controller.current?.abort();
    void refresh();
    const timer = setInterval(
      () => {
        if (!document.hidden && !fetching.current) void refresh();
      },
      active ? 5000 : 20000,
    );
    return () => {
      clearInterval(timer);
      // Invalidate every request started during this subscription.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      revision.current++;
      abortLatestRequest();
      fetching.current = false;
    };
  }, [owner, active, refresh]);
  return {
    rooms: state.owner === owner ? state.rooms : [],
    error: state.owner === owner ? state.error : '',
    refresh,
  };
}

export function RoomAvatar({
  room,
  size = 38,
}: {
  room: Pick<RoomPreview, 'kind' | 'name' | 'avatar'>;
  size?: number;
}) {
  return (
    <span className="room-avatar-wrap">
      <Avatar
        person={{
          name: room.name || 'Группа',
          avatar: room.avatar,
        }}
        size={size}
      />
      <span className="room-avatar-kind" aria-hidden="true">
        {room.kind === 'secret' ? (
          <LockKeyhole size={10} />
        ) : (
          <Users size={10} />
        )}
      </span>
    </span>
  );
}
export function RoomThreadRow({
  room,
  active,
  onOpen,
}: {
  room: RoomSummary;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={'thread-row room-thread ' + (active ? 'active' : '')}
      onClick={onOpen}
      aria-label={
        'Открыть ' +
        (room.kind === 'secret' ? 'секретный чат ' : 'группу ') +
        room.name
      }
    >
      <RoomAvatar room={room} />
      <span className="thread-copy">
        <strong>{room.name || 'Секретный чат'}</strong>
        <small>
          {room.kind === 'secret'
            ? 'Со сквозным шифрованием'
            : emojiFallback(room.lastMessage?.text || '') ||
              `${room.memberCount} участников`}
        </small>
      </span>
      {!!room.unread && (
        <span className="unread">{room.unread > 99 ? '99+' : room.unread}</span>
      )}
    </button>
  );
}

export function PublicRoomSearch({
  query,
  owner,
  onOpen,
}: {
  query: string;
  owner: string;
  onOpen: (username: string) => void;
}) {
  const [result, setResult] = useState<{
    query: string;
    owner: string;
    rooms: RoomPreview[];
    error: string;
  } | null>(null);
  const [revision, retry] = useState(0);
  const normalized = query.trim().replace(/^@/, '').toLowerCase();
  useEffect(() => {
    if (!owner || normalized.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void roomRequest<{ rooms: RoomPreview[] }>(
        { action: 'search', q: normalized, actor: owner },
        controller.signal,
      )
        .then((data) => {
          if (!controller.signal.aborted)
            setResult({
              query: normalized,
              owner,
              rooms: data.rooms,
              error: '',
            });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setResult({
              query: normalized,
              owner,
              rooms: [],
              error: error.message,
            });
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [normalized, owner, revision]);
  if (
    !owner ||
    normalized.length < 2 ||
    result?.query !== normalized ||
    result.owner !== owner
  )
    return null;
  if (result.error)
    return (
      <div className="room-search-error">
        <span>Поиск групп недоступен</span>
        <button
          className="icon-button"
          aria-label="Повторить поиск групп"
          onClick={() => retry((v) => v + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
    );
  if (!result.rooms.length) return null;
  return (
    <div className="room-search-results">
      <h3>
        <Users size={15} /> Группы
      </h3>
      {result.rooms.map((room) => (
        <button
          className="room-search-row"
          key={room.id}
          onClick={() => onOpen(room.username!)}
        >
          <RoomAvatar room={room} />
          <span>
            <strong>{room.name}</strong>
            <small>
              @{room.username} · {room.memberCount} участников
            </small>
          </span>
          <span className="room-kind-chip">Группа</span>
        </button>
      ))}
    </div>
  );
}
