'use client';
/* Async playlist subscriptions preserve the current view while refreshing. */
/* eslint-disable react/react-compiler, next/no-img-element */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Headphones,
  Link2,
  ListMusic,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  Plus,
  Settings,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { MusicPlaylistCreate } from './music-playlist-create';
import { MusicReorderList } from './music-reorder-list';
import { MusicSearch } from './music-search';
import { ProfileLink } from './profile-link';
import { useMusic } from '@/lib/music-context';
import {
  formatMusicTime,
  musicProviderName,
  type MusicTrack,
} from '@/lib/music-links';
import {
  playlistRequest,
  type PlaylistSummary,
  type PlaylistDetail,
} from '@/lib/music-playlist-types';

export function MusicPlaylists({
  readOnly,
  library,
}: {
  readOnly: boolean;
  library: MusicTrack[];
}) {
  const music = useMusic(),
    room = music?.room;
  const [lists, setLists] = useState<{
    playlists: PlaylistSummary[];
    invitations: PlaylistSummary[];
  } | null>(null);
  const [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [url, setUrl] = useState(''),
    [handle, setHandle] = useState('');
  const [creating, setCreating] = useState(false),
    [settings, setSettings] = useState(false),
    [picker, setPicker] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [createVersion, setCreateVersion] = useState(0);
  const [rename, setRename] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const locked = useRef(false),
    version = useRef(0);
  const active = room?.detail?.id === selected;
  const shown = active ? room.detail : detail;
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const [nextLists, nextDetail] = await Promise.all([
        playlistRequest<{
          playlists: PlaylistSummary[];
          invitations: PlaylistSummary[];
        }>(),
        selected
          ? playlistRequest<PlaylistDetail>(
              '?id=' + encodeURIComponent(selected),
            )
          : Promise.resolve(null),
      ]);
      if (request !== version.current) return;
      setLists(nextLists);
      setDetail(nextDetail);
      setError('');
    } catch (e) {
      if (request === version.current) setError((e as Error).message);
    }
  }, [selected]);
  useEffect(() => {
    const requestVersion = version;
    void refresh();
    const update = () => {
      if (!document.hidden) void refresh();
    };
    const timer = setInterval(update, 10000);
    window.addEventListener('noctgram:music-refresh', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      requestVersion.current++;
      clearInterval(timer);
      window.removeEventListener('noctgram:music-refresh', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [refresh]);
  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    if (locked.current || readOnly) return false;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await playlistRequest<PlaylistDetail>('', {
        action,
        id: selected,
        ...extra,
      });
      if (action === 'accept') {
        setSelected(data.id);
        setDetail(data);
        setCreating(false);
      } else if (action === 'delete' || action === 'leave') {
        if (active) room?.leave();
        setSelected('');
        setDetail(null);
        setSettings(false);
      } else {
        if (data.id) setDetail(data);
        await refresh();
      }
      setUrl('');
      setHandle('');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const controlsDisabled = busy || readOnly;
  const reorder = async (trackId: string, targetId: string) => {
    if (!shown || readOnly || locked.current) throw new Error('Плейлист занят');
    locked.current = true;
    setBusy(true);
    setError('');
    const id = shown.id;
    try {
      if (active) {
        await room.reorder(trackId, targetId);
        return;
      }
      const data = await playlistRequest<PlaylistDetail>('', {
        action: 'reorder',
        id,
        trackId,
        targetId,
      });
      setDetail((previous) => (previous?.id === id ? data : previous));
      window.dispatchEvent(new Event('noctgram:music-refresh'));
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const play = (trackId?: string) => {
    if (!shown || readOnly) return;
    if (active && trackId) void room.command('play', { trackId });
    else if (active)
      void room.command(shown.playback.playing ? 'pause' : 'resume');
    else void room?.join(shown, trackId);
  };
  return (
    <div className="music-playlists">
      {(error || room?.error) && (
        <p className="music-error" role="alert">
          {error || room?.error}
        </p>
      )}
      {!selected || !shown ? (
        <section className="playlist-overview" key="overview">
          <div className="playlist-section-heading">
            <div>
              <ListMusic size={20} />
              <h3>Ваши плейлисты</h3>
            </div>
            <button
              className="secondary"
              disabled={readOnly}
              onClick={() => {
                setCreateVersion((value) => value + 1);
                setCreating(true);
              }}
            >
              <Plus size={17} />
              Создать
            </button>
          </div>
          {!!lists?.invitations.length && (
            <section className="playlist-invitations card">
              <h4>
                <UserPlus size={17} />
                Приглашения
              </h4>
              {lists.invitations.map((p) => (
                <div className="playlist-invite" key={p.id}>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      Приглашает{' '}
                      <ProfileLink target={{ id: p.ownerId }}>
                        {p.ownerName}
                      </ProfileLink>
                    </small>
                  </span>
                  <button
                    className="secondary"
                    disabled={controlsDisabled}
                    onClick={() => void mutate('accept', { id: p.id })}
                  >
                    Принять
                  </button>
                  <button
                    className="icon-button"
                    aria-label={'Отклонить приглашение в ' + p.name}
                    disabled={controlsDisabled}
                    onClick={() => void mutate('decline', { id: p.id })}
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}
            </section>
          )}
          {!lists ? (
            <output className="music-empty">
              <LoaderCircle size={24} className="spin" />
              Загружаем плейлисты…
            </output>
          ) : lists.playlists.length ? (
            <div className="playlist-grid">
              {lists.playlists.map((p) => (
                <button
                  className="playlist-tile card"
                  key={p.id}
                  aria-busy={selected === p.id && !error}
                  data-opening={selected === p.id && !error}
                  onClick={() => {
                    setError('');
                    setDetail(null);
                    if (selected === p.id) void refresh();
                    else setSelected(p.id);
                  }}
                >
                  <span className="playlist-cover">
                    {p.artwork ? (
                      <img
                        src={p.artwork}
                        alt=""
                        width={72}
                        height={72}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <ListMusic size={35} />
                    )}
                    {selected === p.id && !error && (
                      <output className="playlist-opening">
                        <LoaderCircle
                          size={22}
                          className="spin"
                          aria-hidden="true"
                        />
                        <span className="sr-only">Открываем плейлист…</span>
                      </output>
                    )}
                  </span>
                  <span className="playlist-copy">
                    <strong title={p.name}>{p.name}</strong>
                    <span className="playlist-meta">
                      <span>{p.trackCount} треков</span>
                      <span
                        className="playlist-member-count"
                        title={'Участников: ' + p.memberCount}
                      >
                        <Users size={13} aria-hidden="true" />
                        {p.memberCount}
                      </span>
                    </span>
                    <small title={p.ownerName}>{p.ownerName}</small>
                    {room?.detail?.id === p.id && (
                      <span className="playlist-live">
                        <i />
                        Слушаем вместе
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="music-empty card">
              <ListMusic size={32} />
              <h3>Музыка для вас двоих. Или всей компании.</h3>
              <p>Создайте плейлист, добавьте песни и пригласите друга.</p>
            </div>
          )}
        </section>
      ) : (
        <section className="playlist-detail card" key={shown.id}>
          <div className="playlist-detail-top">
            <button
              className="icon-button"
              aria-label="Все плейлисты"
              onClick={() => setSelected('')}
            >
              <ArrowLeft size={20} />
            </button>
            <span>Плейлисты</span>
            <button
              className="icon-button"
              aria-label="Настройки плейлиста"
              onClick={() => {
                setRename(shown.name);
                setConfirmDelete(false);
                setSettings(true);
              }}
            >
              <Settings size={19} />
            </button>
          </div>
          <div className="playlist-hero">
            <div className="playlist-art-grid">
              {shown.tracks
                .filter((t) => t.artwork)
                .slice(0, 4)
                .map((t) => (
                  <img src={t.artwork} key={t.id} alt="" />
                ))}
              {!shown.tracks.some((t) => t.artwork) && <ListMusic size={42} />}
            </div>
            <div>
              <span className="playlist-eyebrow">
                <Users size={14} />
                Общий плейлист
              </span>
              <h3>{shown.name}</h3>
              <p>
                {shown.tracks.length} треков ·{' '}
                {shown.members.filter((m) => m.status === 'accepted').length}{' '}
                участников
              </p>
            </div>
          </div>
          <div className="playlist-actions">
            <button
              className="primary"
              disabled={controlsDisabled || room?.busy || !shown.tracks.length}
              onClick={() => play()}
            >
              {active && shown.playback.playing ? (
                <Pause size={18} />
              ) : (
                <Headphones size={18} />
              )}{' '}
              {active
                ? shown.playback.playing
                  ? 'Пауза для всех'
                  : 'Продолжить вместе'
                : 'Слушать вместе'}
            </button>
            {active && (
              <button className="secondary" onClick={() => room.leave()}>
                <LogOut size={17} />
                Выйти
              </button>
            )}
            <button
              className="secondary"
              disabled={controlsDisabled}
              onClick={() => setPicker(true)}
            >
              <Plus size={17} />
              Песни
            </button>
          </div>
          <div className="playlist-listeners">
            {shown.members
              .filter((m) => m.status === 'accepted')
              .map((m) => (
                <ProfileLink
                  target={{ id: m.userId }}
                  key={m.userId}
                  data-listening={!!m.listening}
                >
                  {m.avatar ? (
                    <img src={m.avatar} alt="" />
                  ) : (
                    <Users size={13} />
                  )}
                  <span>{m.name}</span>
                  {!!m.listening && <i />}
                </ProfileLink>
              ))}
          </div>
          <form
            className="music-link-search"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate('add', { url });
            }}
          >
            <Link2 size={18} />
            <input
              aria-label="Ссылка на песню для общего плейлиста"
              placeholder="Ссылка на песню SoundCloud"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={controlsDisabled}
            />
            <button
              className="music-link-submit"
              aria-label="Добавить песню в плейлист"
              disabled={controlsDisabled || !url.trim()}
            >
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Plus size={20} />
              )}
            </button>
          </form>
          <MusicReorderList
            className="playlist-tracks"
            disabled={controlsDisabled}
            onMove={reorder}
            rows={shown.tracks.map((track, index) => ({
              id: track.id,
              label: track.title,
              content: (
                <div
                  className="playlist-track"
                  data-active={active && shown.playback.trackId === track.id}
                  key={track.id}
                >
                  <button
                    className="playlist-track-start"
                    disabled={readOnly || room?.busy}
                    onClick={() => play(track.id)}
                    aria-label={'Слушать вместе ' + track.title}
                  >
                    <span className="playlist-track-number">{index + 1}</span>
                    <span className="playlist-track-art">
                      {track.artwork ? (
                        <img src={track.artwork} alt="" />
                      ) : (
                        <Headphones size={20} />
                      )}
                      <Play size={16} />
                    </span>
                    <span className="playlist-track-copy">
                      <strong>{track.title}</strong>
                      <small>
                        {track.artist} · {musicProviderName(track.provider)}
                      </small>
                    </span>
                    <small>
                      {track.durationMs
                        ? formatMusicTime(track.durationMs)
                        : ''}
                    </small>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={'Удалить из плейлиста ' + track.title}
                    disabled={controlsDisabled}
                    onClick={() => void mutate('remove', { trackId: track.id })}
                  >
                    <X size={15} />
                  </button>
                </div>
              ),
            }))}
          />
          {!shown.tracks.length && (
            <div className="music-empty">
              <ListMusic size={30} />
              <h3>Добавьте первую песню</h3>
              <p>По ссылке или из своей музыки.</p>
            </div>
          )}
        </section>
      )}
      <MusicPlaylistCreate
        key={createVersion}
        open={creating}
        onOpenChange={setCreating}
        library={library}
        readOnly={readOnly}
        onCreated={(playlist) => {
          setSelected(playlist.id);
          setDetail(playlist);
          setError('');
        }}
      />
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="noct-dialog playlist-settings">
          <DialogTitle>Настройки плейлиста</DialogTitle>
          <DialogDescription>{shown?.name}</DialogDescription>
          {error && (
            <p className="music-error" role="alert">
              {error}
            </p>
          )}
          {shown?.ownerId === shown?.me ? (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate('rename', { name: rename });
                }}
              >
                <label htmlFor="playlist-rename">Название</label>
                <div className="playlist-input-row">
                  <input
                    id="playlist-rename"
                    value={rename}
                    maxLength={80}
                    required
                    onChange={(e) => setRename(e.target.value)}
                  />
                  <button
                    className="secondary"
                    disabled={controlsDisabled || !rename.trim()}
                  >
                    Сохранить
                  </button>
                </div>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate('invite', { handle });
                }}
              >
                <label htmlFor="playlist-friend">Пригласить друга</label>
                <div className="playlist-input-row">
                  <input
                    id="playlist-friend"
                    placeholder="@ник друга"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    required
                  />
                  <button
                    className="secondary"
                    disabled={controlsDisabled || !handle.trim()}
                  >
                    <UserPlus size={17} />
                    Пригласить
                  </button>
                </div>
                <small>
                  Приглашение появится у друга во вкладке «Плейлисты».
                </small>
              </form>
              <div className="playlist-members">
                {shown?.members.map((m) => (
                  <div key={m.userId}>
                    <span>
                      <strong>
                        <ProfileLink target={{ id: m.userId }}>
                          {m.name}
                        </ProfileLink>
                      </strong>
                      <small>
                        {m.userId === shown.ownerId
                          ? 'Владелец'
                          : m.status === 'invited'
                            ? 'Приглашение отправлено'
                            : 'Участник'}
                      </small>
                    </span>
                    {m.userId !== shown.ownerId && (
                      <button
                        className="icon-button"
                        aria-label={'Убрать участника ' + m.name}
                        disabled={controlsDisabled}
                        onClick={() =>
                          void mutate('kick', { userId: m.userId })
                        }
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                className="secondary playlist-danger"
                disabled={controlsDisabled}
                onClick={() => {
                  if (confirmDelete) void mutate('delete');
                  else setConfirmDelete(true);
                }}
              >
                <Trash2 size={16} />
                {confirmDelete
                  ? 'Удалить плейлист для всех? Нажмите ещё раз'
                  : 'Удалить плейлист'}
              </button>
            </>
          ) : (
            <button
              className="secondary"
              disabled={controlsDisabled}
              onClick={() => void mutate('leave')}
            >
              <LogOut size={17} />
              Покинуть плейлист
            </button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="noct-dialog playlist-picker">
          <DialogTitle>Добавить песни</DialogTitle>
          <DialogDescription>
            Найдите песню или выберите её из своей музыки.
          </DialogDescription>
          <MusicSearch
            playlist
            disabled={controlsDisabled}
            savedUrls={shown?.tracks.map((t) => t.url)}
            onAdd={async (track) => {
              if (!(await mutate('add', { url: track.url })))
                throw new Error('Песня не добавлена. Попробуйте ещё раз.');
              setPicker(false);
            }}
          />
          {error && (
            <p className="music-error" role="alert">
              {error}
            </p>
          )}
          <div className="playlist-picker-list">
            {library
              .filter((t) => t.kind === 'track' && t.provider === 'soundcloud')
              .map((t) => {
                const added = shown?.tracks.some((x) => x.id === t.id);
                return (
                  <button
                    key={t.id}
                    disabled={controlsDisabled || added}
                    onClick={() => void mutate('add', { url: t.url })}
                  >
                    <span>
                      <strong>{t.title}</strong>
                      <small>{t.artist}</small>
                    </span>
                    {added ? <Check size={18} /> : <Plus size={18} />}
                  </button>
                );
              })}
            {!library.some(
              (t) => t.kind === 'track' && t.provider === 'soundcloud',
            ) && (
              <p>
                Пока нет сохранённых песен. Найдите музыку выше или добавьте
                песню по ссылке.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
