'use client';
/* eslint-disable react/react-compiler, next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Library, LoaderCircle, Search } from 'lucide-react';
import type { YandexPlaylist, YandexTrack } from '@/lib/yandex-music';
import type { ServiceStatus } from '@/lib/music-service-types';
import { formatMusicTime } from '@/lib/music-links';
type Data = { status: ServiceStatus; items: YandexPlaylist[] };
async function request<T>(
  body?: Record<string, unknown>,
  query = '',
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api/music/yandex' + query, {
    signal,
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Яндекс Музыка недоступна.');
  return data;
}
export function MusicYandex({
  signedIn,
  readOnly,
}: {
  signedIn: boolean;
  readOnly: boolean;
}) {
  const [data, setData] = useState<Data | null>(null),
    [token, setToken] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<YandexPlaylist | null>(null),
    [tracks, setTracks] = useState<YandexTrack[]>([]);
  const [partial, setPartial] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    request<Data>(undefined, '', abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => controller.current?.abort();
  }, [signedIn]);
  async function action(value: 'connect' | 'disconnect' | 'sync') {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setNotice('');
    setSelected(null);
    setTracks([]);
    const credential = token;
    try {
      await request(
        {
          action: value,
          ...(value === 'connect' ? { token: credential } : {}),
        },
        '',
        abort.signal,
      );
      setToken('');
      if (value === 'connect')
        await request({ action: 'sync' }, '', abort.signal);
      const result = await request<Data>(undefined, '', abort.signal);
      if (abort.signal.aborted) return;
      setData(result);
      setNotice(
        value === 'disconnect'
          ? 'Подключение и данные плейлистов удалены.'
          : 'Список плейлистов обновлён.',
      );
    } catch (error) {
      if (!abort.signal.aborted) {
        setError((error as Error).message);
        // A successful connection may be followed by a failed sync.
        try {
          const result = await request<Data>(undefined, '', abort.signal);
          if (!abort.signal.aborted) setData(result);
        } catch {
          /* Keep the original error. */
        }
      }
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  async function open(playlist: YandexPlaylist) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setSelected(playlist);
    setTracks([]);
    setPartial(false);
    try {
      const result = await request<{ items: YandexTrack[]; partial: boolean }>(
        undefined,
        '?playlist=' + encodeURIComponent(playlist.id),
        abort.signal,
      );
      if (!abort.signal.aborted) {
        setTracks(result.items);
        setPartial(result.partial);
      }
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  async function checkConnection() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request<{ ok: true }>(undefined, '?action=check', abort.signal);
      if (!abort.signal.aborted)
        setNotice(
          'Сервер Noctgram может соединиться с Яндексом. Теперь можно подключить аккаунт. Эта проверка не использует токен.',
        );
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  const connected = data?.status.status === 'connected';
  return (
    <>
      <section className="service-connection-card">
        <div className="service-card-top">
          <span>Яндекс Музыка · экспериментальное подключение</span>
          <span className={'service-state ' + (connected ? 'connected' : '')}>
            {connected ? 'Подключён' : 'Не подключён'}
          </span>
        </div>
        <div className="service-login">
          <h3>
            {connected
              ? data.status.displayName
              : 'Ваши плейлисты из Яндекс Музыки'}
          </h3>
          <p>
            Синхронизация плейлистов через токен своего аккаунта. Используется
            неофициальный интерфейс Яндекс Музыки. Воспроизведение аудио Яндекса
            пока не подключено.
          </p>
          {!signedIn ? (
            <Link href="/login" className="primary">
              Войти в Noctgram
            </Link>
          ) : connected ? (
            <div className="yandex-actions">
              <button
                className="primary"
                disabled={busy || readOnly}
                onClick={() => void action('sync')}
              >
                Синхронизировать плейлисты
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void action('disconnect')}
              >
                Отключить
              </button>
            </div>
          ) : (
            <form
              className="yandex-token-form"
              onSubmit={(event) => {
                event.preventDefault();
                void action('connect');
              }}
            >
              <label htmlFor="yandex-token">
                Токен своего аккаунта Яндекс Музыки
              </label>
              <input
                id="yandex-token"
                type="password"
                autoComplete="off"
                value={token}
                maxLength={4096}
                onChange={(event) => setToken(event.target.value)}
                placeholder="OAuth-токен"
                disabled={busy || readOnly || !data?.status.configured}
              />
              <button
                className="primary"
                disabled={
                  busy ||
                  readOnly ||
                  !data?.status.configured ||
                  token.length < 20
                }
              >
                Подключить Яндекс Музыку
              </button>
              {data && !data.status.configured && (
                <p>Владелец Noctgram ещё не настроил хранение подключений.</p>
              )}
              {data?.status.displayName && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void action('disconnect')}
                >
                  Удалить старое подключение
                </button>
              )}
            </form>
          )}
          <p>
            Токен хранится зашифрованным на сервере. Пароль Яндекса здесь не
            нужен.
          </p>
          {signedIn && (
            <>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void checkConnection()}
              >
                Проверить соединение с Яндексом
              </button>
              <p>
                Запросы отправляет сервер Noctgram. Если доступ к Яндексу
                ограничен, VPN должен работать на компьютере с сервером.
                Расширения в браузере недостаточно.
              </p>
            </>
          )}
        </div>
      </section>
      {error && (
        <p className="music-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="service-notice">{notice}</output>}
      {busy && (
        <output className="service-loading">
          <LoaderCircle className="spin" size={18} /> Загружаем…
        </output>
      )}
      {connected && (
        <section className="service-library">
          <div className="service-library-heading">
            <h3>{selected?.title || 'Ваши плейлисты'}</h3>
            {selected && (
              <button
                className="secondary"
                onClick={() => {
                  controller.current?.abort();
                  setSelected(null);
                  setTracks([]);
                  setBusy(false);
                }}
              >
                <ArrowLeft size={16} /> Назад
              </button>
            )}
          </div>
          {selected ? (
            <>
              <p className="service-library-note">
                Состав загружается из Яндекса при открытии. Поиск в SoundCloud
                предлагает отдельные записи — сверяйте исполнителя и версию
                песни.
              </p>
              {partial && (
                <p className="service-library-note">
                  Некоторые записи недоступны. Для больших плейлистов показаны
                  первые 1000 позиций.
                </p>
              )}
              {tracks.map((track, index) => (
                <div className="music-track" key={track.id + ':' + index}>
                  <div className="music-track-text">
                    <a
                      href={track.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {track.title}
                    </a>
                    <span className="music-track-artist">
                      {track.artist} · Яндекс Музыка
                    </span>
                  </div>
                  {!!track.duration && (
                    <small>{formatMusicTime(track.duration)}</small>
                  )}
                  <Link
                    className="icon-button"
                    aria-label={'Найти в SoundCloud: ' + track.title}
                    href={
                      '/music?search=' +
                      encodeURIComponent(
                        (track.artist + ' ' + track.title).slice(0, 150),
                      )
                    }
                  >
                    <Search size={18} />
                  </Link>
                </div>
              ))}
              {!busy && !tracks.length && (
                <p className="service-library-note">Доступных записей нет.</p>
              )}
            </>
          ) : (
            <>
              {data.items.map((playlist) => (
                <div className="music-track" key={playlist.id}>
                  <button
                    className="music-track-play"
                    aria-label={'Открыть ' + playlist.title}
                    disabled={busy}
                    onClick={() => void open(playlist)}
                  >
                    {playlist.artwork ? (
                      <img src={playlist.artwork} alt="" />
                    ) : (
                      <Library size={22} />
                    )}
                  </button>
                  <div className="music-track-text">
                    <button disabled={busy} onClick={() => void open(playlist)}>
                      {playlist.title}
                    </button>
                    <span className="music-track-artist">
                      {playlist.count} треков · обновлено{' '}
                      {new Date(playlist.syncedAt).toLocaleString('ru-RU')}
                    </span>
                  </div>
                </div>
              ))}
              {!busy && !data.items.length && (
                <p className="service-library-note">
                  Нет синхронизированных плейлистов. Нажмите «Синхронизировать
                  плейлисты».
                </p>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
