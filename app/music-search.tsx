'use client';
/* eslint-disable next/no-img-element, react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Headphones,
  LoaderCircle,
  Play,
  Plus,
  Search,
} from 'lucide-react';
import { formatMusicTime, type MusicTrack } from '@/lib/music-links';
import { useMusic } from '@/lib/music-context';

type Results = { items: MusicTrack[]; nextPage: string | null };
export function MusicSearch({
  onAdd,
  savedUrls = [],
  disabled = false,
  playlist = false,
}: {
  onAdd: (track: MusicTrack) => Promise<void>;
  savedUrls?: string[];
  disabled?: boolean;
  playlist?: boolean;
}) {
  const music = useMusic();
  const [query, setQuery] = useState(''),
    [searched, setSearched] = useState('');
  const [result, setResult] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [adding, setAdding] = useState(''),
    [saved, setSaved] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const request = useRef<AbortController | null>(null),
    lock = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  function edit(value: string) {
    request.current?.abort();
    setQuery(value);
    setLoading(false);
    setResult(null);
    setError('');
    setNote('');
  }
  async function search(page = '1') {
    const term = query.trim();
    if (!term) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    setNote('');
    if (page === '1') {
      setResult(null);
      setSearched(term);
    }
    try {
      const response = await fetch(
        '/api/music/soundcloud?' +
          new URLSearchParams({ action: 'search', q: term, page }),
        { signal: controller.signal },
      );
      const data = (await response.json()) as Results & { error?: string };
      if (!response.ok)
        throw new Error(
          data.error || 'Не удалось найти музыку. Попробуйте ещё раз.',
        );
      if (controller.signal.aborted) return;
      setResult((previous) => {
        const rows =
          page === '1'
            ? data.items
            : [...(previous?.items || []), ...data.items];
        return {
          items: [...new Map(rows.map((t) => [t.url, t])).values()],
          nextPage: data.nextPage,
        };
      });
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  async function add(track: MusicTrack) {
    if (disabled || lock.current) return;
    lock.current = true;
    setAdding(track.url);
    setError('');
    setNote('');
    try {
      await onAdd(track);
      if (mounted.current) {
        setSaved((current) => [...current, track.url]);
        setNote(
          playlist
            ? 'Песня добавлена в плейлист'
            : 'Песня добавлена в «Мою музыку»',
        );
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) setAdding('');
    }
  }
  return (
    <section
      className="music-search music-content-enter"
      aria-label="Поиск музыки SoundCloud"
    >
      <form
        className="music-link-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          type="search"
          aria-label="Название песни или исполнитель"
          placeholder="Название песни или исполнитель"
          value={query}
          maxLength={150}
          onChange={(e) => edit(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
        <button
          type="submit"
          className="music-search-submit"
          disabled={!query.trim() || loading}
          aria-label="Найти музыку"
          title="Найти музыку"
        >
          {loading ? (
            <LoaderCircle size={19} className="spin" aria-hidden="true" />
          ) : (
            <Search size={19} aria-hidden="true" />
          )}
        </button>
      </form>
      <p className="music-search-caption">
        Поиск в SoundCloud · подключать аккаунт не нужно
      </p>
      {error && (
        <p className="music-error" role="alert">
          {error}
        </p>
      )}
      {note && <output className="service-notice">{note}</output>}
      {result && (
        <div
          className="music-search-results music-content-enter"
          key={searched}
          aria-label={'Результаты поиска: ' + searched}
        >
          {result.items.map((track) => {
            const added =
              saved.includes(track.url) || savedUrls.includes(track.url);
            return (
              <div className="music-track" key={track.url}>
                <button
                  type="button"
                  className="music-track-play"
                  aria-label={'Слушать ' + track.title}
                  onClick={() => music?.play(track, result.items)}
                >
                  {track.artwork ? (
                    <img src={track.artwork} alt="" loading="lazy" />
                  ) : (
                    <Headphones size={20} />
                  )}
                  <span>
                    <Play size={16} fill="currentColor" />
                  </span>
                </button>
                <div className="music-track-text">
                  <button
                    type="button"
                    onClick={() => music?.play(track, result.items)}
                  >
                    {track.title}
                  </button>
                  <span className="music-track-artist">{track.artist}</span>
                  <a
                    className="music-source"
                    href={track.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    SoundCloud
                  </a>
                </div>
                {!!track.durationMs && (
                  <small className="music-search-duration">
                    {formatMusicTime(track.durationMs)}
                  </small>
                )}
                <button
                  type="button"
                  className="icon-button music-search-add"
                  disabled={disabled || !!adding || added}
                  aria-label={
                    added
                      ? 'Добавлено: ' + track.title
                      : `Добавить ${playlist ? 'в плейлист' : 'в мою музыку'}: ${track.title}`
                  }
                  title={
                    added
                      ? 'Добавлено'
                      : playlist
                        ? 'Добавить в плейлист'
                        : 'Добавить в мою музыку'
                  }
                  onClick={() => void add(track)}
                >
                  {adding === track.url ? (
                    <LoaderCircle size={19} className="spin" />
                  ) : added ? (
                    <Check size={19} />
                  ) : (
                    <Plus size={20} />
                  )}
                </button>
              </div>
            );
          })}
          {!result.items.length && !loading && (
            <p className="music-search-empty">
              Ничего не найдено. Попробуйте другое название или имя исполнителя.
            </p>
          )}
        </div>
      )}
      {loading && (
        <output className="music-search-loading">
          <LoaderCircle size={20} className="spin" /> Ищем музыку…
        </output>
      )}
      {result?.nextPage && (
        <button
          className="secondary music-search-more"
          disabled={loading}
          onClick={() => void search(result.nextPage!)}
        >
          Показать ещё
        </button>
      )}
    </section>
  );
}
