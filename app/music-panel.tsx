'use client';
/* Async subscriptions intentionally update loading state; provider artwork keeps its attribution. */
/* eslint-disable react/react-compiler, next/no-img-element, next/no-html-link-for-pages */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Headphones,
  Link2,
  LoaderCircle,
  Play,
  Plus,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  musicRequest,
  musicProviderName,
  parseMusicLink,
  type MusicTrack,
} from '@/lib/music-links';
import { useMusic } from '@/lib/music-context';
import { MusicPlaylists } from './music-playlists';
import { MusicSearch } from './music-search';
import { MusicAudioUpload } from './music-audio-upload';
import { MusicLeaderboard, type ListenerScore } from './music-leaderboard';
import type { Person } from '@/lib/client';

type RankedTrack = MusicTrack & { plays: number };
type MusicData = {
  profile: Person | null;
  library: MusicTrack[];
  discoveries: MusicTrack[];
  tracks: RankedTrack[];
  artists: {
    artist: string;
    authorUrl: string;
    plays: number;
    tracks: number;
    provider: string;
  }[];
  listeners: (Person & { plays: number; tracks: number })[];
  mine: ListenerScore | null;
  period: string;
  updatedAt: number;
};

export function MusicPanel({
  signedIn,
  readOnly,
  onProfile,
  onServices,
  tab,
  onTabChange,
}: {
  signedIn: boolean;
  readOnly: boolean;
  onProfile: (id: string) => void;
  onServices?: () => void;
  tab: string;
  onTabChange: (value: string) => void;
}) {
  const [chart, setChart] = useState('listeners');
  const [period, setPeriod] = useState('7');
  const [url, setUrl] = useState(''),
    [error, setError] = useState('');
  const [data, setData] = useState<MusicData | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const music = useMusic();
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    if (!signedIn) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const result = await musicRequest<MusicData>('home', undefined, {
        charts: tab === 'charts' ? '1' : '0',
        leaders: '1',
        period,
      });
      if (version === requestVersion.current) setData(result);
    } catch (e) {
      if (version === requestVersion.current) setError((e as Error).message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [signedIn, tab, period]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!signedIn) return;
    const update = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [tab, signedIn, refresh]);
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
      setError(
        'Вставьте ссылку SoundCloud, Spotify, YouTube или YouTube Music.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await musicRequest('save', { url: link.url });
      setUrl('');
      await refresh();
      onTabChange('library');
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
  const rows = data?.library || [];
  function trackRows(tracks: MusicTrack[], ranked = false) {
    return (
      <div className="music-track-list">
        {tracks.map((track, i) => (
          <div
            className="music-track"
            key={track.id}
            style={{ '--row-index': Math.min(i, 7) } as CSSProperties}
          >
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
                {musicProviderName(track.provider)}
                {track.kind === 'playlist' ? ' · плейлист' : ''}
              </a>
              {track.provider === 'spotify' && (
                <small className="music-audio-caption">
                  {track.audioUrl ? 'Ваш аудиофайл' : 'Spotify Premium'}
                </small>
              )}
              {track.provider === 'spotify' && track.audioUrl && (
                <button
                  className="music-source"
                  onClick={() =>
                    music?.play({ ...track, playback: 'spotify' }, tracks)
                  }
                >
                  Слушать через Spotify Premium
                </button>
              )}
            </div>
            {ranked && (
              <span className="music-count">
                <strong>{(track as RankedTrack).plays}</strong>
                <small>прослушиваний</small>
              </span>
            )}
            {tab === 'library' && (
              <>
                {track.provider === 'spotify' && (
                  <MusicAudioUpload
                    track={track}
                    compact
                    disabled={busy || readOnly}
                    onSaved={() => void refresh()}
                    onError={setError}
                  />
                )}
                <button
                  className="icon-button"
                  disabled={busy || readOnly}
                  onClick={() => void remove(track.id)}
                  aria-label={'Убрать ' + track.title + ' из моей музыки'}
                >
                  <X size={16} />
                </button>
              </>
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
      </div>
      <Link
        href="/music/services"
        className="music-services-link"
        onNavigate={(event) => {
          if (onServices) {
            event.preventDefault();
            onServices();
          }
        }}
      >
        <Headphones size={21} />
        <span>
          <strong>Подключить музыкальные сервисы</strong>
          <small>Ваши аккаунты и плейлисты</small>
        </span>
        <ArrowUpRight size={19} />
      </Link>
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(String(v))}
        className="music-tabs"
      >
        <TabsList>
          <TabsTrigger value="search">Поиск</TabsTrigger>
          <TabsTrigger value="playlists">Плейлисты</TabsTrigger>
          <TabsTrigger value="charts">Чарты</TabsTrigger>
          <TabsTrigger value="library">Моя музыка</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab !== 'playlists' && tab !== 'search' && (
        <form
          className="music-link-search"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Link2 size={19} aria-hidden="true" />
          <input
            id="music-link"
            type="url"
            aria-label="Добавить музыку по ссылке"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Вставьте ссылку на музыку"
            disabled={busy || readOnly || !signedIn}
            autoComplete="off"
          />
          <button
            className="music-link-submit"
            aria-label="Добавить музыку"
            title="Добавить музыку"
            disabled={busy || readOnly || !signedIn || !url.trim()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Plus size={20} />
            )}
          </button>
        </form>
      )}
      {error && (
        <p className="music-error" role="alert">
          {error}
        </p>
      )}
      {!signedIn ? (
        <div className="music-empty">
          <Headphones size={30} />
          <h3>Ваша музыка — рядом с друзьями</h3>
          <p>Войдите, чтобы сохранять треки и слушать вместе с друзьями.</p>
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
            {tab === 'playlists' ? (
              <MusicPlaylists readOnly={readOnly} library={data.library} />
            ) : tab === 'search' ? (
              <MusicSearch
                disabled={readOnly}
                savedUrls={data.library.map((t) => t.url)}
                onAdd={async (track) => {
                  await musicRequest('save', { url: track.url });
                  window.dispatchEvent(new Event('noctgram:music-refresh'));
                }}
              />
            ) : tab === 'charts' ? (
              <section
                className="music-chart music-content-enter card"
                key="charts"
              >
                <div className="music-section-heading">
                  <Trophy size={18} />
                  <h3>На повторе у Noctgram</h3>
                  <span>{chart === 'listeners' ? 'Топ 25' : 'Топ 30'}</span>
                </div>
                <Tabs
                  value={period}
                  onValueChange={(v) => setPeriod(String(v))}
                >
                  <TabsList aria-label="Период чарта">
                    <TabsTrigger value="today">Сегодня</TabsTrigger>
                    <TabsTrigger value="7">7 дней</TabsTrigger>
                    <TabsTrigger value="30">30 дней</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Tabs value={chart} onValueChange={(v) => setChart(String(v))}>
                  <TabsList>
                    <TabsTrigger value="tracks">Треки</TabsTrigger>
                    <TabsTrigger value="artists">Исполнители</TabsTrigger>
                    <TabsTrigger value="listeners">Слушатели</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="music-content-enter" key={chart + data.period}>
                  {chart === 'tracks' && trackRows(data.tracks, true)}
                  {chart === 'artists' &&
                    data.artists.map((artist, i) => (
                      <div
                        className="music-ranking-row"
                        key={artist.provider + artist.authorUrl + artist.artist}
                      >
                        <span className="music-rank">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="music-avatar">
                          <Headphones size={20} />
                        </span>
                        <span>
                          <strong>{artist.artist}</strong>
                          <small>
                            {artist.provider === 'spotify'
                              ? 'Spotify · личное аудио'
                              : 'SoundCloud'}{' '}
                            · треков: {artist.tracks}
                          </small>
                        </span>
                        <b>{artist.plays}</b>
                      </div>
                    ))}
                  {chart === 'listeners' && (
                    <MusicLeaderboard
                      listeners={data.listeners}
                      profile={data.profile}
                      mine={data.mine}
                      period={data.period}
                      onProfile={onProfile}
                    />
                  )}
                  {chart !== 'listeners' &&
                    (chart === 'tracks' ? data.tracks : data.artists).length ===
                      0 && (
                      <div className="music-empty">
                        <Trophy size={28} />
                        <h3>Первое место ещё свободно</h3>
                        <p>
                          Чарт появится после первых прослушиваний участников.
                        </p>
                      </div>
                    )}
                </div>
                <p className="music-footnote">
                  Прослушивание от 30 секунд · один трек в сутки (UTC) от
                  слушателя.
                </p>
                <p className="music-footnote">
                  {loading
                    ? 'Обновляем…'
                    : `Обновлено ${new Date(data.updatedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })} · автообновление раз в минуту`}
                </p>
              </section>
            ) : (
              <section
                className="music-collection music-content-enter card"
                key={tab}
              >
                <div className="music-section-heading">
                  <Sparkles size={18} />
                  <h3>Ваши сохранённые треки</h3>
                  <span>{rows.length}</span>
                </div>
                {trackRows(rows)}
                {rows.length === 0 && (
                  <div className="music-empty">
                    <Headphones size={30} />
                    <h3>Соберите своё звучание</h3>
                    <p>
                      Добавьте первую ссылку выше. Плеер останется с вами в
                      ленте и диалогах.
                    </p>
                  </div>
                )}
              </section>
            )}
            {tab === 'playlists' && (
              <div className="music-content-enter card">
                <MusicLeaderboard
                  listeners={data.listeners}
                  profile={data.profile}
                  mine={data.mine}
                  period={data.period}
                  onProfile={onProfile}
                />
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
