'use client';
/* Draft selections remain local until the complete form is submitted. */
/* eslint-disable react/react-compiler, next/no-img-element */
import { useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Headphones,
  ListMusic,
  LoaderCircle,
  Plus,
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
import { Checkbox } from '@/components/ui/checkbox';
import type { MusicTrack } from '@/lib/music-links';
import {
  playlistRequest,
  type PlaylistDetail,
} from '@/lib/music-playlist-types';

export function MusicPlaylistCreate({
  open,
  onOpenChange,
  library,
  readOnly,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  library: MusicTrack[];
  readOnly: boolean;
  onCreated: (playlist: PlaylistDetail) => void;
}) {
  const [name, setName] = useState(''),
    [friend, setFriend] = useState(''),
    [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false),
    nameInput = useRef<HTMLInputElement>(null);
  const tracks = library.filter((track) => track.kind === 'track');
  const selectedTracks = selected.flatMap(
    (id) => tracks.find((t) => t.id === id) || [],
  );
  const artwork = selectedTracks.filter((t) => t.artwork).slice(0, 4);
  async function create() {
    if (locked.current || readOnly || !name.trim()) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await playlistRequest<PlaylistDetail>('', {
        action: 'create',
        name: name.trim(),
        friendHandle: friend.trim(),
        trackIds: selected,
      });
      onCreated(result);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!locked.current) onOpenChange(next);
      }}
    >
      <DialogContent
        className="noct-dialog playlist-create-dialog"
        overlayClassName="playlist-create-overlay"
        showCloseButton={false}
        initialFocus={nameInput}
      >
        <form
          className="playlist-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          aria-busy={busy}
        >
          <header className="playlist-create-header">
            <span className="playlist-create-heading-icon">
              <ListMusic size={21} />
            </span>
            <div>
              <DialogTitle>Новый плейлист</DialogTitle>
              <DialogDescription>
                Соберите музыку для себя и друзей.
              </DialogDescription>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Закрыть создание плейлиста"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              <X size={19} />
            </button>
          </header>
          <div className="playlist-create-body">
            <div className="playlist-create-preview" aria-hidden="true">
              <div className="playlist-create-art" data-count={artwork.length}>
                {artwork.length ? (
                  artwork.map((t) => <img key={t.id} src={t.artwork} alt="" />)
                ) : (
                  <>
                    <span className="playlist-create-orbit" />
                    <Headphones size={34} />
                  </>
                )}
              </div>
              <div>
                <span className="playlist-create-eyebrow">ВАША МУЗЫКА</span>
                <strong>{name.trim() || 'Как звучит ваш плейлист?'}</strong>
                <small>
                  {selected.length} треков<span>·</span>
                  {friend.trim() ? 'С другом' : 'Только вы'}
                </small>
              </div>
            </div>
            <div className="playlist-create-field">
              <label htmlFor="create-playlist-name">Название</label>
              <div className="playlist-create-input">
                <input
                  id="create-playlist-name"
                  ref={nameInput}
                  placeholder="Например, после полуночи"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                  disabled={busy || readOnly}
                  autoComplete="off"
                />
                <span>{name.length}/80</span>
              </div>
            </div>
            <div className="playlist-create-field">
              <label htmlFor="create-playlist-friend">
                <UserPlus size={16} />
                Пригласить друга<span>Необязательно</span>
              </label>
              <div className="playlist-create-input">
                <span className="playlist-create-at">@</span>
                <input
                  id="create-playlist-friend"
                  placeholder="Ник друга в Noctgram"
                  value={friend}
                  onChange={(e) => setFriend(e.target.value.replace(/^@/, ''))}
                  maxLength={100}
                  disabled={busy || readOnly}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
              <p>Друг получит приглашение после создания плейлиста.</p>
            </div>
            <section className="playlist-create-songs">
              <div className="playlist-create-section-title">
                <h3>
                  <ListMusic size={17} />
                  Первые песни
                </h3>
                <span>
                  {selected.length
                    ? `Выбрано ${selected.length}`
                    : 'Из моей музыки'}
                </span>
              </div>
              {tracks.length ? (
                <div className="playlist-create-song-list">
                  {tracks.map((track) => {
                    const checked = selected.includes(track.id);
                    return (
                      <label
                        className="playlist-create-song"
                        data-selected={checked}
                        key={track.id}
                      >
                        <span className="playlist-create-song-art">
                          {track.artwork ? (
                            <img src={track.artwork} alt="" />
                          ) : (
                            <Headphones size={18} />
                          )}
                        </span>
                        <span className="playlist-create-song-copy">
                          <strong>{track.title}</strong>
                          <small>{track.artist}</small>
                        </span>
                        <Checkbox
                          checked={checked}
                          disabled={
                            busy ||
                            readOnly ||
                            (!checked && selected.length >= 50)
                          }
                          onCheckedChange={(next) =>
                            setSelected((ids) =>
                              next
                                ? [...ids, track.id]
                                : ids.filter((id) => id !== track.id),
                            )
                          }
                          aria-label={'Добавить ' + track.title}
                        />
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="playlist-create-no-songs">
                  <Plus size={20} />
                  <span>Песни можно добавить по ссылке после создания.</span>
                </div>
              )}
            </section>
            {error && (
              <p className="music-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="playlist-create-footer">
            <span>
              <Users size={15} />
              {friend.trim()
                ? 'Слушайте и добавляйте песни вместе'
                : 'Друзей можно пригласить позже'}
            </span>
            <div>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="primary"
                disabled={busy || readOnly || !name.trim()}
              >
                {busy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <Check size={17} />
                )}{' '}
                {busy ? 'Создаём…' : 'Создать плейлист'}
                {!busy && <ArrowUpRight size={17} />}
              </button>
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
