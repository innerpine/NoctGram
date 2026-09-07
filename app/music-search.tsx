'use client';
/* eslint-disable react/react-compiler, next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Check,
  Cloud,
  Headphones,
  LoaderCircle,
  Play,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  formatMusicTime,
  musicRequest,
  type MusicTrack,
} from '@/lib/music-links';
import { useMusic } from './music-provider';

export function MusicSearch({
  signedIn,
  readOnly,
  savedUrls,
  onSaved,
}: {
  signedIn: boolean;
  readOnly: boolean;
  savedUrls: string[];
  onSaved: () => void;
}) {
  const params = useSearchParams();
  const incoming = params.get('search') || '';
  const [query, setQuery] = useState(incoming.slice(0, 150));
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [searched, setSearched] = useState('');
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState('');
  const [error, setError] = useState(''),
    [connect, setConnect] = useState(false);
  const request = useRef<AbortController | null>(null);
  const music = useMusic();
  useEffect(() => {
    setQuery(incoming.slice(0, 150));
  }, [incoming]);
  useEffect(() => () => request.current?.abort(), []);
  async function search() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setConnect(false);
    setTracks([]);
    setSearched('');
    const value = query.trim();
    try {
      const response = await fetch(
        '/api/music/services/soundcloud/search?q=' + encodeURIComponent(value),
        { signal: controller.signal, cache: 'no-store' },
      );
      const result = (await response.json()) as {
        items: MusicTrack[];
        error?: string;
        code?: string;
      };
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setConnect(
          [
            'MUSIC_SETUP_REQUIRED',
            'MUSIC_NOT_CONNECTED',
            'MUSIC_RECONNECT',
          ].includes(result.code || ''),
        );
        throw new Error(result.error || 'Поиск временно недоступен.');
      }
      setTracks(result.items);
      setSearched(value);
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function save(track: MusicTrack) {
    setSaving(track.url);
    setError('');
    try {
      await musicRequest('save', { url: track.url });
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving('');
    }
  }
  return (
    <section className="music-add music-search card" aria-label="Поиск музыки">
      <label htmlFor="music-search">
        <Search size={17} /> Найти песню{' '}
        <span className="music-search-provider">
          <Cloud size={15} /> SoundCloud
        </span>
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <input
          id="music-search"
          type="search"
          value={query}
          maxLength={150}
          placeholder="Название или исполнитель"
          disabled={!signedIn}
          onChange={(event) => {
            request.current?.abort();
            setBusy(false);
            setQuery(event.target.value);
            setTracks([]);
            setSearched('');
            setError('');
            setConnect(false);
          }}
        />
        <button
          className="primary"
          disabled={!signedIn || busy || query.trim().length < 2}
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : 'Найти'}
        </button>
        {(searched || error) && (
          <button
            type="button"
            className="icon-button"
            aria-label="Очистить поиск"
            onClick={() => {
              request.current?.abort();
              setQuery('');
              setSearched('');
              setTracks([]);
              setError('');
              setConnect(false);
              setBusy(false);
            }}
          >
            <X size={16} />
          </button>
        )}
      </form>
      {error && (
        <div className="music-error" role="alert">
          {error}{' '}
          {connect && (
            <Link href="/music/services?provider=soundcloud">
              Настроить SoundCloud
            </Link>
          )}
        </div>
      )}
      {!searched && !error && (
        <p>
          Найдите доступную запись, послушайте и добавьте в свою музыку. Поиск
          использует подключение SoundCloud.
        </p>
      )}
      {searched && (
        <output className="service-library-note">
          {tracks.length
            ? `Результаты по запросу «${searched}»`
            : 'Ничего не найдено. Попробуйте название без дополнительных пометок или имя исполнителя.'}
        </output>
      )}
      <div className="music-track-list">
        {tracks.map((track) => (
          <div className="music-track" key={track.url}>
            <button
              className="music-track-play"
              aria-label={'Слушать ' + track.title}
              onClick={() => music?.play(track, tracks)}
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
              <button onClick={() => music?.play(track, tracks)}>
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
              className="icon-button"
              disabled={readOnly || !!saving || savedUrls.includes(track.url)}
              aria-label={
                (savedUrls.includes(track.url)
                  ? 'Уже в моей музыке: '
                  : 'Сохранить ') + track.title
              }
              onClick={() => void save(track)}
            >
              {saving === track.url ? (
                <LoaderCircle className="spin" size={17} />
              ) : savedUrls.includes(track.url) ? (
                <Check size={17} />
              ) : (
                <Plus size={17} />
              )}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
