'use client';
/* Async account loading uses effects; artwork is supplied by the connected service. */
/* eslint-disable react/react-compiler, next/no-img-element */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Cloud,
  Library,
  Link2,
  LoaderCircle,
  LogOut,
  Music2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  SERVICE_NAMES,
  MUSIC_SERVICES,
  type MusicServiceId,
  type ServicePage,
  type ServicePlaylist,
  type ServiceStatus,
} from '@/lib/music-service-types';
import { parseMusicLink, type MusicTrack } from '@/lib/music-links';
import { useMusic } from '@/lib/music-context';
import { MusicYandex } from './music-yandex';

async function serviceRequest<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    '/api/music/services' + path,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { cache: 'no-store' },
  );
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || 'Не удалось обновить подключение.');
  return data;
}
function ServiceMark({
  provider,
  size = 18,
}: {
  provider: MusicServiceId;
  size?: number;
}) {
  // Icons extend the existing Lucide set; labels identify the service without invented logos.
  return (
    <span className={'service-mark ' + provider}>
      {provider === 'soundcloud' ? (
        <Cloud size={size} fill="currentColor" />
      ) : (
        <Music2 size={size} />
      )}
    </span>
  );
}
export function MusicServices({
  signedIn,
  readOnly,
}: {
  signedIn: boolean;
  readOnly: boolean;
}) {
  const [provider, setProvider] = useState<MusicServiceId>('soundcloud');
  const [statuses, setStatuses] = useState<ServiceStatus[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [view, setView] = useState('playlists');
  const [playlists, setPlaylists] = useState<ServicePlaylist[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [imports, setImports] = useState<ServicePlaylist[]>([]),
    [tracks, setTracks] = useState<MusicTrack[]>([]),
    [query, setQuery] = useState('');
  const music = useMusic(),
    selection = useRef(0);
  const refresh = useCallback(async () => {
    if (!signedIn) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setStatuses(
        (await serviceRequest<{ services: ServiceStatus[] }>('')).services,
      );
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
  useEffect(() => {
    const params = new URLSearchParams(window.location.search),
      choice = params.get('provider');
    if (MUSIC_SERVICES.includes(choice as MusicServiceId))
      setProvider(choice as MusicServiceId);
    const result = params.get('result');
    if (result) {
      if (result === 'connected')
        setNotice('Аккаунт подключён. Можно выбрать свои плейлисты.');
      else if (result === 'cancelled')
        setNotice('Вход отменён. Подключение не изменено.');
      else
        setError(
          'Не удалось завершить вход. Попробуйте подключить аккаунт заново.',
        );
      window.history.replaceState(
        null,
        '',
        '/music/services' +
          (choice ? '?provider=' + encodeURIComponent(choice) : ''),
      );
    }
  }, []);
  const current = statuses.find((s) => s.provider === provider),
    connected = current?.status === 'connected';
  useEffect(() => {
    const version = ++selection.current;
    setPlaylists([]);
    setImports([]);
    setTracks([]);
    setNext(null);
    setQuery('');
    setView('playlists');
    if (!connected || provider === 'yandex') return;
    setBusy(true);
    Promise.all([
      serviceRequest<ServicePage>(`/${provider}/playlists`),
      serviceRequest<{ items: ServicePlaylist[] }>(`/${provider}/imports`),
    ])
      .then(([page, saved]) => {
        if (version === selection.current) {
          setPlaylists(page.items);
          setNext(page.next);
          setImports(saved.items);
        }
      })
      .catch((e) => {
        if (version === selection.current) setError(e.message);
      })
      .finally(() => {
        if (version === selection.current) setBusy(false);
      });
    const selectionRef = selection;
    return () => {
      selectionRef.current++;
    };
  }, [provider, connected]);
  async function connect() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await serviceRequest<{ authorizationUrl: string }>(
        `/${provider}/connect`,
        {},
      );
      window.location.assign(data.authorizationUrl);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      await serviceRequest(`/${provider}/disconnect`, {});
      window.dispatchEvent(
        new CustomEvent('noctgram:music-disconnect', { detail: provider }),
      );
      setNotice('Подключение и импортированные плейлисты удалены из Noctgram.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadMore() {
    if (!next) return;
    const version = selection.current;
    setBusy(true);
    setError('');
    try {
      const page = await serviceRequest<ServicePage>(
        `/${provider}/playlists?cursor=${encodeURIComponent(next)}`,
      );
      if (version === selection.current) {
        setPlaylists((old) => [
          ...old,
          ...page.items.filter((p) => !old.some((o) => o.id === p.id)),
        ]);
        setNext(page.next);
      }
    } catch (e) {
      if (version === selection.current) setError((e as Error).message);
    } finally {
      if (version === selection.current) setBusy(false);
    }
  }
  async function importPlaylist(p: ServicePlaylist) {
    setBusy(true);
    setError('');
    const version = selection.current;
    try {
      const saved = await serviceRequest<ServicePlaylist>(
        `/${provider}/import`,
        { id: p.id },
      );
      if (version === selection.current) {
        setImports((old) => [saved, ...old.filter((v) => v.id !== saved.id)]);
        setPlaylists((old) =>
          old.map((v) => (v.id === p.id ? { ...v, imported: true } : v)),
        );
        setNotice('Плейлист добавлен. Он виден только вам.');
      }
    } catch (e) {
      if (version === selection.current) setError((e as Error).message);
    } finally {
      if (version === selection.current) setBusy(false);
    }
  }
  async function search() {
    setBusy(true);
    setError('');
    const version = selection.current;
    try {
      const result = await serviceRequest<{ items: MusicTrack[] }>(
        `/${provider}/search?q=${encodeURIComponent(query)}`,
      );
      if (version === selection.current) setTracks(result.items);
    } catch (e) {
      if (version === selection.current) setError((e as Error).message);
    } finally {
      if (version === selection.current) setBusy(false);
    }
  }
  const supported = provider === 'soundcloud' || provider === 'spotify';
  const name = SERVICE_NAMES[provider];
  const rows = view === 'imports' ? imports : playlists;
  return (
    <div className="music-services">
      <div className="services-heading">
        <div>
          <h2>Ваши музыкальные сервисы</h2>
          <p>Подключите аккаунт — любимая музыка будет рядом.</p>
        </div>
        <Link
          href="/music"
          className="icon-button"
          aria-label="Вернуться к музыке"
        >
          <ArrowLeft size={18} />
        </Link>
      </div>
      <Tabs
        value={provider}
        onValueChange={(v) => {
          setProvider(v as MusicServiceId);
          setError('');
          setNotice('');
          setBusy(false);
        }}
        className="service-picker"
      >
        <TabsList>
          {MUSIC_SERVICES.map((id) => (
            <TabsTrigger value={id} key={id} disabled={busy}>
              <ServiceMark provider={id} />
              {SERVICE_NAMES[id]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {error && (
        <div className="music-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <output className="service-notice">
          <Check size={16} />
          {notice}
        </output>
      )}
      {provider === 'yandex' ? (
        <MusicYandex signedIn={signedIn} readOnly={readOnly} />
      ) : (
        <>
          <section className="service-connection-card">
            <div className="service-card-top">
              <span>{name}</span>
              <span
                className={'service-state ' + (connected ? 'connected' : '')}
              >
                {loading
                  ? 'Проверяем…'
                  : connected
                    ? 'Подключён'
                    : current?.status === 'expired'
                      ? 'Нужен повторный вход'
                      : 'Не подключён'}
              </span>
            </div>
            {connected ? (
              <div className="service-connected">
                <ServiceMark provider={provider} size={38} />
                <div>
                  <h3>{current.displayName}</h3>
                  {current.profileUrl && (
                    <a
                      href={current.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Профиль в {name} <ArrowUpRight size={14} />
                    </a>
                  )}
                </div>
                <button
                  className="secondary"
                  onClick={() => void disconnect()}
                  disabled={busy}
                >
                  <LogOut size={16} />
                  Отключить
                </button>
                {provider === 'spotify' && (
                  <button
                    className="secondary"
                    disabled={busy || readOnly}
                    onClick={() => void connect()}
                  >
                    Обновить разрешения плеера
                  </button>
                )}
              </div>
            ) : (
              <div className="service-login">
                <ServiceMark provider={provider} size={46} />
                <h3>Войти через {name}</h3>
                <p>
                  {provider === 'spotify'
                    ? 'Ваши плейлисты и воспроизведение в Noctgram. Для музыки нужен Spotify Premium на вашем аккаунте.'
                    : 'Подключите аккаунт для доступа к своим плейлистам.'}
                </p>
                {!signedIn ? (
                  <Link href="/login" className="primary">
                    Сначала войти в Noctgram <ChevronRight size={16} />
                  </Link>
                ) : (
                  <button
                    className="primary service-login-button"
                    onClick={() => void connect()}
                    disabled={
                      busy || loading || readOnly || !current?.configured
                    }
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Link2 size={17} />
                    )}
                    {current?.status === 'expired'
                      ? 'Подключить заново'
                      : 'Подключить ' + name}
                    <ArrowUpRight size={16} />
                  </button>
                )}
                {signedIn && !loading && !current?.configured && (
                  <p className="service-setup-note">
                    {supported
                      ? 'Вход через этот сервис ещё не настроен владельцем Noctgram.'
                      : 'Подключение этого сервиса пока недоступно.'}
                  </p>
                )}
                {current?.displayName && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void disconnect()}
                  >
                    <LogOut size={16} />
                    Удалить сохранённое подключение
                  </button>
                )}
              </div>
            )}
            <p className="service-privacy">
              <ShieldCheck size={15} />
              Плейлисты из аккаунта видны только вам. Подключение можно
              отключить в любое время.
            </p>
          </section>
          <section className="service-capabilities">
            <h3>Возможности подключения</h3>
            <div>
              {[
                [
                  'Вход в аккаунт',
                  supported ? 'После подключения' : 'Недоступно',
                  ShieldCheck,
                ],
                [
                  'Ваши плейлисты',
                  supported ? 'После подключения' : 'Недоступно',
                  Library,
                ],
                [
                  'Поиск треков',
                  provider === 'soundcloud'
                    ? 'После подключения'
                    : 'Недоступно',
                  Search,
                ],
                [
                  'Воспроизведение',
                  provider === 'soundcloud'
                    ? 'В Noctgram'
                    : provider === 'spotify'
                      ? 'В Noctgram · Premium'
                      : 'В самом сервисе',
                  Play,
                ],
              ].map(([label, state, Icon]) => {
                const Mark = Icon as typeof Play;
                return (
                  <div className="service-capability" key={String(label)}>
                    <Mark size={17} />
                    <span>{String(label)}</span>
                    <small>
                      {connected && state === 'После подключения'
                        ? 'Доступно'
                        : String(state)}
                    </small>
                  </div>
                );
              })}
            </div>
          </section>
          {connected && (
            <section className="service-library">
              <div className="service-library-heading">
                <h3>Музыка из {name}</h3>
                <button
                  className="icon-button"
                  aria-label="Проверить подключение"
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
              <Tabs value={view} onValueChange={(v) => setView(String(v))}>
                <TabsList>
                  <TabsTrigger value="playlists">Мои плейлисты</TabsTrigger>
                  <TabsTrigger value="imports">
                    Импортировано · {imports.length}
                  </TabsTrigger>
                  {provider === 'soundcloud' && (
                    <TabsTrigger value="search">Поиск</TabsTrigger>
                  )}
                </TabsList>
              </Tabs>
              {view === 'search' ? (
                <>
                  <form
                    className="service-search"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void search();
                    }}
                  >
                    <input
                      aria-label="Найти трек в SoundCloud"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Трек или исполнитель"
                      maxLength={150}
                    />
                    <button
                      className="primary"
                      disabled={busy || !query.trim()}
                    >
                      <Search size={17} />
                      Найти
                    </button>
                  </form>
                  {tracks.map((track) => (
                    <div className="service-playlist-row" key={track.id}>
                      <button
                        className="service-artwork"
                        aria-label={'Слушать ' + track.title}
                        onClick={() => music?.play(track, tracks)}
                      >
                        {track.artwork ? (
                          <img src={track.artwork} alt="" />
                        ) : (
                          <Play size={19} />
                        )}
                      </button>
                      <div>
                        <strong>{track.title}</strong>
                        <small>
                          {track.artist} ·{' '}
                          <a
                            className="music-source"
                            href={track.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            SoundCloud
                          </a>
                        </small>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {rows.map((p) => (
                    <div className="service-playlist-row" key={p.id}>
                      <span className="service-artwork">
                        {p.artwork ? (
                          <img src={p.artwork} alt="" loading="lazy" />
                        ) : (
                          <Library size={22} />
                        )}
                      </span>
                      <div>
                        <strong>{p.title}</strong>
                        <small>
                          {p.trackCount} треков ·{' '}
                          {provider === 'soundcloud' ? (
                            <a
                              className="music-source"
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              SoundCloud
                            </a>
                          ) : (
                            name
                          )}
                        </small>
                      </div>
                      {p.playable && (
                        <button
                          className="icon-button"
                          aria-label={'Слушать ' + p.title}
                          onClick={() => {
                            const link = parseMusicLink(p.url);
                            if (link) music?.play(link);
                          }}
                        >
                          <Play size={17} />
                        </button>
                      )}
                      {provider !== 'soundcloud' && (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={'Открыть плейлист в ' + name}
                        >
                          <ArrowUpRight size={18} />
                        </a>
                      )}
                      {view === 'playlists' && (
                        <button
                          className="secondary service-import-button"
                          disabled={busy || readOnly || p.imported}
                          onClick={() => void importPlaylist(p)}
                        >
                          {p.imported ? (
                            <Check size={16} />
                          ) : (
                            <Library size={16} />
                          )}
                          {p.imported ? 'Добавлен' : 'Импорт'}
                        </button>
                      )}
                    </div>
                  ))}
                  {next && view === 'playlists' && (
                    <button
                      className="secondary load-more"
                      onClick={() => void loadMore()}
                      disabled={busy}
                    >
                      Загрузить ещё
                    </button>
                  )}
                  {!rows.length && !busy && (
                    <div className="music-empty">
                      <Library size={27} />
                      <p>
                        {view === 'imports'
                          ? 'Выберите плейлист и нажмите «Импорт».'
                          : 'В этом аккаунте пока нет доступных плейлистов.'}
                      </p>
                    </div>
                  )}
                </>
              )}
              {busy && (
                <output className="service-loading">
                  <LoaderCircle className="spin" size={18} />
                  Загружаем…
                </output>
              )}
              <p className="service-library-note">
                Импорт сохраняет плейлист в личной коллекции Noctgram. Состав и
                аудио остаются в {name}.
                {provider === 'spotify' &&
                  ' Отдельные треки можно добавить по ссылке и слушать в плеере Noctgram с Premium.'}
              </p>
            </section>
          )}
          <div className="service-footer">
            <Unplug size={15} />
            Пароль музыкального аккаунта вводится только на странице самого
            сервиса.
          </div>
        </>
      )}
    </div>
  );
}
