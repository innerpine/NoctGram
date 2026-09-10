'use client';
import { ProfileLink } from './profile-link';
/* Presence polling updates external state and cancels stale responses. */
/* eslint-disable react/react-compiler, next/no-img-element */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useImagePalette } from '@/lib/use-image-palette';
import {
  Headphones,
  LoaderCircle,
  Music2,
  Pause,
  Settings,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { MusicActivity } from '@/lib/music-activity';
import { formatMusicTime, musicProviderName } from '@/lib/music-links';
import { playerArtwork } from '@/lib/music-player';
import { parseMusicLink } from '@/lib/music-links';
import { useMusic, useMusicPlayback } from '@/lib/music-context';

async function api<T>(query = '', body?: unknown): Promise<T> {
  const response = await fetch(
    '/api/music/activity' + query,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        }
      : { cache: 'no-store', signal: AbortSignal.timeout(10000) },
  );
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || 'Не удалось обновить активность');
  return data;
}
export function MusicActivitySettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    api<{ enabled: boolean }>('?settings=1')
      .then((data) => {
        if (active) {
          setEnabled(data.enabled);
          setError('');
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  return (
    <section className="music-activity-settings">
      <div className="music-activity-settings-icon">
        <Headphones size={22} />
      </div>
      <div className="music-activity-setting-copy">
        <label htmlFor="show-music-activity">Музыкальная активность</label>
        <p>Показывать в профиле, какую песню и с кем я сейчас слушаю.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}{' '}
            <button onClick={() => setReload((value) => value + 1)}>
              Повторить
            </button>
          </p>
        )}
      </div>
      {enabled === null && !error ? (
        <LoaderCircle size={18} className="spin" />
      ) : (
        <Switch
          id="show-music-activity"
          checked={enabled === true}
          disabled={busy || enabled === null}
          aria-label="Показывать музыкальную активность"
          onCheckedChange={async (next) => {
            if (locked.current) return;
            locked.current = true;
            setBusy(true);
            setError('');
            try {
              const data = await api<{ enabled: boolean }>('', {
                action: 'settings',
                enabled: next,
              });
              setEnabled(data.enabled);
              window.dispatchEvent(
                new CustomEvent('noctgram:music-activity-settings', {
                  detail: { enabled: data.enabled },
                }),
              );
              window.dispatchEvent(
                new Event('noctgram:music-activity-changed'),
              );
            } catch (error) {
              setError((error as Error).message);
            } finally {
              locked.current = false;
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}

export function MusicActivityStatus({
  userId,
  own = false,
  onSettings,
}: {
  userId: string;
  own?: boolean;
  onSettings?: () => void;
}) {
  const music = useMusic();
  const playback = useMusicPlayback();
  const [result, setResult] = useState<{
    userId: string;
    activity: MusicActivity | null;
    serverTime: number;
    received: number;
  } | null>(null);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    let disposed = false,
      busy = false,
      again = false;
    const load = async () => {
      if (disposed || document.hidden) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const data = await api<{
          activity: MusicActivity | null;
          serverTime: number;
        }>('?id=' + encodeURIComponent(userId));
        if (!disposed) {
          setResult({ userId, ...data, received: performance.now() });
          setClock(performance.now());
        }
      } catch {
        if (!disposed) setResult(null);
      } finally {
        busy = false;
        if (again && !disposed) {
          again = false;
          void load();
        }
      }
    };
    const refresh = () => {
      void load();
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    const animation = setInterval(() => {
      if (!document.hidden) setClock(performance.now());
    }, 1000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('noctgram:music-activity-changed', refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearInterval(animation);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('noctgram:music-activity-changed', refresh);
    };
  }, [userId]);
  const activity = result?.userId === userId ? result.activity : null;
  const artwork = playerArtwork(activity?.artwork || '');
  const palette = useImagePalette(artwork);
  const now = result
    ? result.serverTime + Math.max(0, clock - result.received)
    : 0;
  if (!activity || activity.expiresAt <= now) return null;
  const live =
    own && music?.currentUrl === activity.trackUrl && playback?.ready
      ? playback
      : null;
  const paused = live ? !music?.playing : activity.state === 'paused';
  const companions = (activity.listeningWith || []).filter(
    (person) => person.expiresAt > now,
  );
  const together = companions.length > 0;
  const position = live
    ? live.position
    : Math.max(
        0,
        Math.min(
          activity.durationMs,
          activity.positionMs +
            (paused ? 0 : Math.max(0, now - activity.updatedAt)),
        ),
      );
  return (
    <section
      className="profile-music-activity"
      style={
        {
          '--activity-color': palette?.[0] || '#9897ac',
          '--activity-second': palette?.[1] || '#777889',
          '--activity-artwork': artwork
            ? `url(${JSON.stringify(artwork)})`
            : 'none',
        } as CSSProperties
      }
      data-state={paused ? 'paused' : 'playing'}
      aria-label="Музыкальная активность"
    >
      <div className="profile-music-label">
        {paused ? (
          <Pause size={13} aria-hidden="true" />
        ) : (
          <span className="music-live-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <output>
          {paused
            ? together
              ? 'На паузе вместе с'
              : 'На паузе'
            : together
              ? 'Слушает вместе с'
              : 'Слушает музыку'}
        </output>
        {onSettings && (
          <button
            className="icon-button"
            title="Настройки активности"
            aria-label="Настройки музыкальной активности"
            onClick={onSettings}
          >
            <Settings size={15} />
          </button>
        )}
      </div>
      {together && (
        <div
          className="profile-music-companions"
          key={companions.map((person) => person.userId).join(':')}
          aria-label="Участники совместного прослушивания"
        >
          {companions.slice(0, 2).map((person) => (
            <ProfileLink
              target={{ id: person.userId }}
              className="profile-music-companion"
              key={person.userId}
              title={
                person.name + (person.handle ? ' · @' + person.handle : '')
              }
            >
              <span
                className="profile-music-companion-avatar"
                aria-hidden="true"
              >
                {person.avatar ? (
                  <img src={person.avatar} alt="" />
                ) : (
                  person.name.slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="profile-music-companion-name">
                {person.name}
              </span>
            </ProfileLink>
          ))}
          {companions.length > 2 && (
            <span
              className="profile-music-companions-more"
              title={companions
                .slice(2)
                .map((person) => person.name)
                .join(', ')}
              aria-label={
                'Также слушают: ' +
                companions
                  .slice(2)
                  .map((person) => person.name)
                  .join(', ')
              }
            >
              +{companions.length - 2}
            </span>
          )}
        </div>
      )}
      <button
        className="profile-music-track profile-music-track-button"
        key={activity.trackUrl}
        aria-label={'Слушать ' + activity.title}
        title="Слушать эту песню"
        onClick={() => {
          const link = parseMusicLink(activity.trackUrl);
          if (link) {
            const track = {
              ...link,
              title: activity.title,
              artist: activity.artist,
              artwork: activity.artwork,
            };
            music?.play(track);
          }
        }}
      >
        <span className="profile-music-artwork">
          {artwork ? <img src={artwork} alt="" /> : <Music2 size={24} />}
        </span>
        <span className="profile-music-track-copy">
          <strong title={activity.title}>{activity.title}</strong>
          <span title={activity.artist}>{activity.artist}</span>
          <small>{musicProviderName(activity.provider)}</small>
        </span>
      </button>
      <progress
        className="profile-music-progress"
        aria-label="Позиция песни"
        max={activity.durationMs}
        value={position}
        aria-valuetext={formatMusicTime(position)}
      />
      <div className="profile-music-time">
        <span>{formatMusicTime(position)}</span>
        <span>{formatMusicTime(activity.durationMs)}</span>
      </div>
    </section>
  );
}
