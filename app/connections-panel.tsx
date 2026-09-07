'use client';
/* The effect loads this profile's relations and ignores replies after it closes. */
/* eslint-disable react/react-compiler */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  LoaderCircle,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import { Avatar } from './post-card';
import { request, type ConnectionsPage, type Person } from '@/lib/client';

export function ConnectionsPanel({
  profileId,
  kind,
  busy,
  onProfile,
}: {
  profileId: string;
  kind: 'followers' | 'following';
  busy: boolean;
  onProfile: (id: string) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [hasMore, setHasMore] = useState(false);
  const live = useRef(false),
    generation = useRef(0),
    cursor = useRef<string | null>(null);
  const load = useCallback(
    async (append = false) => {
      const gen = ++generation.current;
      setLoading(true);
      setError('');
      try {
        const query = new URLSearchParams({
          action: 'connections',
          id: profileId,
          kind,
        });
        if (append && cursor.current) query.set('after', cursor.current);
        const page = await request<ConnectionsPage>('?' + query);
        if (!live.current || gen !== generation.current) return;
        cursor.current = page.nextCursor;
        setHasMore(page.hasMore);
        setPeople((old) =>
          append
            ? [
                ...old,
                ...page.people.filter(
                  (p) => !old.some((existing) => existing.id === p.id),
                ),
              ]
            : page.people,
        );
      } catch (e) {
        if (live.current && gen === generation.current)
          setError((e as Error).message);
      } finally {
        if (live.current && gen === generation.current) setLoading(false);
      }
    },
    [profileId, kind],
  );
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  return (
    <section
      className="connections-panel"
      aria-label={
        kind === 'followers' ? 'Список подписчиков' : 'Список подписок'
      }
    >
      <ul className="connections-list" aria-busy={loading}>
        {people.map((person) => (
          <li key={person.id}>
            <button
              className="connection-person"
              disabled={busy}
              onClick={() => onProfile(person.id)}
            >
              <Avatar person={person} size={44} />
              <span className="connection-person-copy">
                <strong>{person.name}</strong>
                <small>
                  @{person.handle}
                  {person.kind === 'channel' && ' · канал'}
                </small>
              </span>
              <ArrowUpRight size={17} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {loading && (
        <output className="connections-status">
          <LoaderCircle size={20} className="spin" aria-hidden="true" />
          Загружаем {kind === 'followers' ? 'подписчиков' : 'подписки'}…
        </output>
      )}
      {!loading && !error && !people.length && (
        <div className="connections-empty">
          <UsersRound size={28} aria-hidden="true" />
          <strong>
            {kind === 'followers'
              ? 'Пока нет подписчиков'
              : 'Пока нет подписок'}
          </strong>
          <p>
            {kind === 'followers'
              ? 'Здесь появятся те, кто подписался на этот профиль.'
              : 'Здесь появятся люди и каналы, на которые подписан этот профиль.'}
          </p>
        </div>
      )}
      {error && (
        <div className="connections-error">
          <p className="form-error" role="alert">
            {error}
          </p>
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void load(people.length > 0)}
          >
            <RefreshCw size={14} /> Попробовать снова
          </button>
        </div>
      )}
      {hasMore && !error && (
        <button
          className="secondary load-more"
          disabled={loading}
          onClick={() => void load(true)}
        >
          Показать ещё
        </button>
      )}
    </section>
  );
}
