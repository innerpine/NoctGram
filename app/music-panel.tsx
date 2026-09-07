'use client';
/* Async subscriptions intentionally update loading state; provider artwork keeps its attribution. */
/* eslint-disable react/react-compiler, next/no-img-element, next/no-html-link-for-pages */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Headphones,
  Link2,
  LoaderCircle,
  Play,
  RefreshCw,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import {
  musicRequest,
  parseMusicLink,
  type MusicTrack,
} from '@/lib/music-links';
import { useMusic } from './music-provider';
import { Avatar } from './post-card';
import type { Person } from '@/lib/client';

type RankedTrack = MusicTrack & { plays: number };
type MusicData = {
  participate: boolean;
  library: MusicTrack[];
  discoveries: MusicTrack[];
  tracks: RankedTrack[];
  artists: {
    artist: string;
    authorUrl: string;
    plays: number;
    tracks: number;
  }[];
  listeners: (Person & { plays: number; tracks: number })[];
};

export function MusicPanel({
  signedIn,
  readOnly,
  onProfile,
}: {
  signedIn: boolean;
  readOnly: boolean;
  onProfile: (id: string) => void;
}) {
  const [tab, setTab] = useState('discover'),
    [chart, setChart] = useState('tracks');
  const [url, setUrl] = useState(''),
    [error, setError] = useState('');
  const [data, setData] = useState<MusicData | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const music = useMusic();
  const refresh = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true);
    setError('');
    try {
      setData(await musicRequest<MusicData>('home'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [signedIn]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const update = () => {
      void refresh();
    };
    window.addEventListener('noctgram:music-refresh', update);
    return () => window.removeEventListener('noctgram:music-refresh', update);
  }, [refresh]);
  async function save() {
    const link = parseMusicLink(url);
    if (!link) {
      setError('Вставьте публичную ссылку на трек или плейлист SoundCloud.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await musicRequest('save', { url: link.url });
      setUrl('');
      await refresh();
      setTab('library');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function participate(value: boolean) {
    setBusy(true);
    setError('');
    try {
      await musicRequest('preferences', { participate: value });
      window.dispatchEvent(new Event('noctgram:music-preferences'));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError('');
    try {
      await musicRequest('remove', { id });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rows =
    tab === 'library' ? data?.library || [] : data?.discoveries || [];
  function trackRows(tracks: MusicTrack[], ranked = false) {
    return (
      <div className="music-track-list">
        {tracks.map((track, i) => (
          <div className="music-track" key={track.id}>
            {ranked && (
              <span className="music-rank">
                {String(i + 1).padStart(2, '0')}
              </span>
            )}
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
                SoundCloud{track.kind === 'playlist' ? ' · плейлист' : ''}
              </a>
            </div>
            {ranked && (
              <span className="music-count">
                <strong>{(track as RankedTrack).plays}</strong>
                <small>прослушиваний</small>
              </span>
            )}
            {tab === 'library' && (
              <button
                className="icon-button"
                disabled={busy || readOnly}
                onClick={() => void remove(track.id)}
                aria-label={'Убрать ' + track.title + ' из моей музыки'}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="music-page">
      <div className="music-intro">
        <span className="music-intro-icon">
          <Headphones size={26} />
        </span>
        <div>
          <h2>На своей волне</h2>
          <p>Музыка рядом. Разговор продолжается.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Обновить музыку"
          disabled={loading || !signedIn}
          onClick={() => void refresh()}
        >
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
        </button>
      </div>
      <Link href="/music/services" className="music-services-link">
        <Headphones size={21} />
        <span>
          <strong>Подключить музыкальные сервисы</strong>
          <small>Ваши аккаунты и плейлисты</small>
        </span>
        <ArrowUpRight size={19} />
      </Link>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(String(v))}
        className="music-tabs"
      >
        <TabsList>
          <TabsTrigger value="discover">Открытия</TabsTrigger>
          <TabsTrigger value="charts">Чарт недели</TabsTrigger>
          <TabsTrigger value="library">Моя музыка</TabsTrigger>
        </TabsList>
      </Tabs>
      <section className="music-add card">
        <label htmlFor="music-link">
          <Link2 size={16} /> Добавить музыку по ссылке
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            id="music-link"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://soundcloud.com/…"
            disabled={busy || readOnly || !signedIn}
          />
          <button
            className="primary"
            disabled={busy || readOnly || !signedIn || !url.trim()}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : 'Добавить'}
          </button>
        </form>
        <p>
          Публичный трек или плейлист SoundCloud. Сохранится в вашей музыке и
          появится в открытиях.
        </p>
      </section>
      {error && (
        <p className="music-error" role="alert">
          {error}
        </p>
      )}
      {!signedIn ? (
        <div className="music-empty">
          <Headphones size={30} />
          <h3>Ваша музыка — рядом с друзьями</h3>
          <p>Войдите, чтобы сохранять треки и открывать музыку сообщества.</p>
          <a href="/login">
            Войти в Noctgram <ArrowUpRight size={16} />
          </a>
        </div>
      ) : !data && loading ? (
        <output className="music-empty">
          <LoaderCircle className="spin" size={26} />
          <span>Загружаем музыку…</span>
        </output>
      ) : (
        data && (
          <>
            {tab === 'charts' ? (
              <section className="music-chart card">
                <div className="music-section-heading">
                  <Trophy size={18} />
                  <h3>На повторе у Noctgram</h3>
                  <span>7 дней</span>
                </div>
                <Tabs value={chart} onValueChange={(v) => setChart(String(v))}>
                  <TabsList>
                    <TabsTrigger value="tracks">Треки</TabsTrigger>
                    <TabsTrigger value="artists">Исполнители</TabsTrigger>
                    <TabsTrigger value="listeners">Слушатели</TabsTrigger>
                  </TabsList>
                </Tabs>
                {chart === 'tracks' && trackRows(data.tracks, true)}
                {chart === 'artists' &&
                  data.artists.map((artist, i) => (
                    <div className="music-ranking-row" key={artist.authorUrl}>
                      <span className="music-rank">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="music-avatar">
                        <Headphones size={20} />
                      </span>
                      <span>
                        <strong>{artist.artist}</strong>
                        <small>SoundCloud · треков: {artist.tracks}</small>
                      </span>
                      <b>{artist.plays}</b>
                    </div>
                  ))}
                {chart === 'listeners' &&
                  data.listeners.map((person, i) => (
                    <button
                      className="music-ranking-row"
                      key={person.id}
                      onClick={() => onProfile(person.id)}
                    >
                      <span className="music-rank">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <Avatar person={person} />
                      <span>
                        <strong>{person.name}</strong>
                        <small>
                          @{person.handle} · треков: {person.tracks}
                        </small>
                      </span>
                      <b>{person.plays}</b>
                    </button>
                  ))}
                {(chart === 'tracks'
                  ? data.tracks
                  : chart === 'artists'
                    ? data.artists
                    : data.listeners
                ).length === 0 && (
                  <div className="music-empty">
                    <Trophy size={28} />
                    <h3>Первое место ещё свободно</h3>
                    <p>Чарт появится после первых прослушиваний участников.</p>
                  </div>
                )}
                <p className="music-footnote">
                  Засчитываем 30 секунд воспроизведения в Noctgram: один трек от
                  одного участника — раз в сутки по UTC. Переход по ссылке не
                  считается.
                </p>
              </section>
            ) : (
              <section className="music-collection card">
                <div className="music-section-heading">
                  <Sparkles size={18} />
                  <h3>
                    {tab === 'library'
                      ? 'Ваши сохранённые треки'
                      : 'Открыто сообществом'}
                  </h3>
                  <span>{rows.length}</span>
                </div>
                {trackRows(rows)}
                {rows.length === 0 && (
                  <div className="music-empty">
                    <Headphones size={30} />
                    <h3>
                      {tab === 'library'
                        ? 'Соберите своё звучание'
                        : 'У каждой ночи свой саундтрек'}
                    </h3>
                    <p>
                      Добавьте первую ссылку выше. Плеер останется с вами в
                      ленте и диалогах.
                    </p>
                  </div>
                )}
              </section>
            )}
            <section className="music-participation card">
              <div>
                <h3>Участвовать в чарте</h3>
                <p>
                  Ваше имя и число прослушиваний появятся в рейтинге. При
                  выключении история участия удаляется.
                </p>
              </div>
              <Switch
                aria-label="Участвовать в музыкальном чарте"
                checked={data.participate}
                disabled={busy || (readOnly && !data.participate)}
                onCheckedChange={(v) => void participate(v)}
              />
            </section>
          </>
        )
      )}
    </div>
  );
}
