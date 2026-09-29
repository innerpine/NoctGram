'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  List,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react';
import { chatRequest } from '@/lib/chat-client';
import type { SearchHit, SearchPage } from '@/lib/message-search';
import { normalizeSearch, searchSnippet } from '@/lib/search-text';
import { emojiFallback } from '@/lib/premium-emoji';
import { Avatar } from './profile-identity';
import { SAVED_MESSAGES, SavedMessagesAvatar } from './saved-messages';

const day = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
});
const clock = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});
const when = (time: number) =>
  new Date(time).toDateString() === new Date().toDateString()
    ? clock.format(time)
    : day.format(time);

export type ChatSearchScope =
  | { peer: string }
  | { room: string; topic?: string };
async function searchPage(
  meId: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  return chatRequest<SearchPage>(
    '/api/chat-search?' + new URLSearchParams({ ...params, actor: meId }),
    { signal, cache: 'no-store' },
  );
}
function Snippet({ text, query }: { text: string; query: string }) {
  const plain = emojiFallback(text);
  const part = searchSnippet(plain, query);
  if (part.start < 0) return <>{part.text}</>;
  return (
    <>
      {part.text.slice(0, part.start)}
      <mark>{part.text.slice(part.start, part.start + part.length)}</mark>
      {part.text.slice(part.start + part.length)}
    </>
  );
}

// Search inside one chat: a counter, older/newer arrows and a result list.
export function ChatSearchBar({
  meId,
  scope,
  onJump,
  onClose,
}: {
  meId: string;
  scope: ChatSearchScope;
  onJump: (hit: SearchHit) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [hits, setHits] = useState<SearchHit[]>([]),
    [total, setTotal] = useState(0),
    [next, setNext] = useState<string | null>(null),
    [index, setIndex] = useState(-1),
    [listOpen, setListOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const params: Record<string, string> =
    'peer' in scope
      ? { scope: 'chat', peer: scope.peer }
      : {
          scope: 'chat',
          room: scope.room,
          ...(scope.topic ? { topic: scope.topic } : {}),
        };
  const key = JSON.stringify(params);
  const latest = useRef({ onJump });
  latest.current = { onJump };
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    if (!normalizeSearch(query)) {
      setHits([]);
      setTotal(0);
      setNext(null);
      setIndex(-1);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void searchPage(
        meId,
        { ...JSON.parse(key), q: query.trim() },
        controller.signal,
      )
        .then((page) => {
          if (controller.signal.aborted) return;
          setHits(page.items);
          setTotal(page.total ?? page.items.length);
          setNext(page.next);
          setIndex(page.items.length ? 0 : -1);
          if (page.items[0]) latest.current.onJump(page.items[0]);
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error ? cause.message : 'Поиск недоступен',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, key, meId]);
  const go = async (target: number) => {
    if (target < 0 || loading) return;
    let list = hits;
    if (target >= list.length) {
      if (!next) return;
      setLoading(true);
      try {
        const page = await searchPage(meId, {
          ...params,
          q: query.trim(),
          before: next,
        });
        list = [...hits, ...page.items];
        setHits(list);
        setNext(page.next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Поиск недоступен');
        return;
      } finally {
        setLoading(false);
      }
    }
    if (!list[target]) return;
    setIndex(target);
    onJump(list[target]);
  };
  return (
    <div className="chat-search-bar">
      <div className="chat-search-row">
        <Search size={17} aria-hidden="true" />
        <input
          ref={input}
          aria-label="Поиск по сообщениям"
          placeholder="Поиск по сообщениям"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            else if (event.key === 'Enter') {
              event.preventDefault();
              void go(event.shiftKey ? index - 1 : index + 1);
            }
          }}
        />
        {loading && <LoaderCircle className="spin" size={15} />}
        <span className="chat-search-count" aria-live="polite">
          {normalizeSearch(query)
            ? total
              ? `${index + 1} из ${total}`
              : loading
                ? ''
                : 'Нет совпадений'
            : ''}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Более раннее совпадение"
          disabled={index + 1 >= total}
          onClick={() => void go(index + 1)}
        >
          <ChevronUp size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Более позднее совпадение"
          disabled={index <= 0}
          onClick={() => void go(index - 1)}
        >
          <ChevronDown size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Список совпадений"
          aria-pressed={listOpen}
          disabled={!hits.length}
          onClick={() => setListOpen(!listOpen)}
        >
          <List size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть поиск"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      {error && (
        <p className="chat-search-error" role="alert">
          {error}
        </p>
      )}
      {listOpen && hits.length > 0 && (
        <div className="chat-search-results">
          {hits.map((hit, position) => (
            <button
              type="button"
              key={hit.id}
              className={position === index ? 'current' : ''}
              onClick={() => {
                setIndex(position);
                setListOpen(false);
                onJump(hit);
              }}
            >
              <Avatar person={{ name: hit.senderName, avatar: '' }} size={30} />
              <span className="chat-search-copy">
                <strong>
                  {hit.sender === meId ? 'Вы' : hit.senderName}
                  <time>{when(hit.created)}</time>
                </strong>
                <small>
                  <Snippet text={hit.text} query={query} />
                </small>
              </span>
            </button>
          ))}
          {next && (
            <button
              type="button"
              className="chat-search-more"
              disabled={loading}
              onClick={() => void go(hits.length)}
            >
              Показать ещё
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export type ListSearchChat = {
  key: string;
  name: string;
  subtitle: string;
  avatar: string;
  saved?: boolean;
  open: () => void;
};
// Search above the chat list: matching chats first, then messages from all
// direct chats and groups.
export function ChatListSearch({
  meId,
  chats,
  onOpenHit,
}: {
  meId: string;
  chats: ListSearchChat[];
  onOpenHit: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState(''),
    [hits, setHits] = useState<SearchHit[]>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const needle = normalizeSearch(query);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setHits([]);
    setNext(null);
    if (!needle || !meId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void searchPage(
        meId,
        { scope: 'all', q: query.trim() },
        controller.signal,
      )
        .then((page) => {
          if (controller.signal.aborted) return;
          setHits(page.items);
          setNext(page.next);
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error ? cause.message : 'Поиск недоступен',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // The trimmed query drives the request; needle only gates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, meId]);
  const found = needle
    ? chats.filter((chat) => normalizeSearch(chat.name).includes(needle))
    : [];
  return (
    <div className={'chat-list-search' + (needle ? ' active' : '')}>
      <label className="chat-list-search-field">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label="Поиск по чатам и сообщениям"
          placeholder="Поиск"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label="Очистить поиск"
            onClick={() => setQuery('')}
          >
            <X size={15} />
          </button>
        )}
      </label>
      {needle && (
        <div className="chat-list-search-results">
          {found.length > 0 && <h3>Чаты</h3>}
          {found.map((chat) => (
            <button
              type="button"
              key={chat.key}
              className="thread-row"
              onClick={() => {
                setQuery('');
                chat.open();
              }}
            >
              {chat.saved ? (
                <SavedMessagesAvatar size={38} />
              ) : (
                <Avatar
                  person={{ name: chat.name, avatar: chat.avatar }}
                  size={38}
                />
              )}
              <span className="thread-copy">
                <strong>{chat.name}</strong>
                <small>{chat.subtitle}</small>
              </span>
            </button>
          ))}
          <h3>Сообщения</h3>
          {hits.map((hit) => (
            <button
              type="button"
              key={hit.kind + hit.id}
              className="thread-row chat-search-hit"
              onClick={() => {
                setQuery('');
                onOpenHit(hit);
              }}
            >
              {hit.kind === 'dm' && hit.chatId === meId ? (
                <SavedMessagesAvatar size={38} />
              ) : (
                <Avatar
                  person={{ name: hit.chatName, avatar: hit.chatAvatar }}
                  size={38}
                />
              )}
              <span className="thread-copy">
                <strong>
                  <span className="chat-search-name">
                    {hit.kind === 'dm' && hit.chatId === meId
                      ? SAVED_MESSAGES
                      : hit.chatName}
                  </span>
                  <time>{when(hit.created)}</time>
                </strong>
                <small>
                  {hit.kind === 'room' &&
                    (hit.sender === meId ? 'Вы: ' : hit.senderName + ': ')}
                  <Snippet text={hit.text} query={query} />
                </small>
              </span>
            </button>
          ))}
          {loading && (
            <p className="chat-list-search-note">
              <LoaderCircle className="spin" size={15} /> Ищем…
            </p>
          )}
          {!loading && !hits.length && !error && (
            <p className="chat-list-search-note">Сообщений не найдено</p>
          )}
          {error && (
            <p className="chat-list-search-note" role="alert">
              {error}
            </p>
          )}
          {next && !loading && (
            <button
              type="button"
              className="chat-search-more"
              onClick={() => {
                setLoading(true);
                void searchPage(meId, {
                  scope: 'all',
                  q: query.trim(),
                  before: next,
                })
                  .then((page) => {
                    setHits((current) => [...current, ...page.items]);
                    setNext(page.next);
                  })
                  .catch((cause) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : 'Поиск недоступен',
                    ),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              Показать ещё
            </button>
          )}
        </div>
      )}
    </div>
  );
}
