'use client';
/* eslint-disable react/react-compiler, next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { Check, Heart, ListMusic, LoaderCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  playlistRequest,
  type PlaylistDetail,
  type TrackPlaylists,
} from '@/lib/music-playlist-types';
import { playerArtwork } from '@/lib/music-player';
import { parseMusicLink } from '@/lib/music-links';

type Track = { url: string; title: string };
type Choice = TrackPlaylists['playlists'][number];
// The compact and expanded controls share one write lock, even during a switch.
const favoriteWrite = { current: false };
export function MusicFavorite({ track }: { track: Track }) {
  const valid = parseMusicLink(track.url)?.kind === 'track';
  const [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  const [note, setNote] = useState(''),
    [error, setError] = useState('');
  const [selection, setSelection] = useState<{
    track: Track;
    lists: Choice[];
  } | null>(null);
  const [open, setOpen] = useState(false);
  const locked = favoriteWrite,
    version = useRef(0),
    mounted = useRef(true);
  const currentUrl = useRef(track.url);
  currentUrl.current = track.url;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(''), 3500);
    return () => window.clearTimeout(timer);
  }, [note]);
  const read = (url: string) =>
    playlistRequest<TrackPlaylists>('?track=' + encodeURIComponent(url));
  useEffect(() => {
    if (!valid) {
      setSaved(false);
      return;
    }
    let active = true;
    const requests = version;
    const update = () => {
      const request = ++version.current;
      void read(track.url)
        .then((data) => {
          if (active && request === version.current)
            setSaved(data.playlists.some((p) => !!p.savedTrackId));
        })
        .catch(() => {});
    };
    setSaved(false);
    setNote('');
    update();
    window.addEventListener('noctgram:music-refresh', update);
    return () => {
      active = false;
      requests.current++;
      window.removeEventListener('noctgram:music-refresh', update);
    };
  }, [track.url, valid]);
  async function change(target: Track, choice?: Choice) {
    let id = choice?.id;
    if (!id) {
      const created = await playlistRequest<PlaylistDetail>('', {
        action: 'create',
        name: 'Любимые песни',
      });
      id = created.id;
    }
    await playlistRequest(
      '',
      choice?.savedTrackId
        ? { action: 'remove', id, trackId: choice.savedTrackId }
        : { action: 'add', id, url: target.url },
    );
    window.dispatchEvent(new Event('noctgram:music-refresh'));
    if (!mounted.current) return;
    if (currentUrl.current === target.url) {
      setNote(
        choice?.savedTrackId
          ? 'Убрано из плейлиста'
          : `Добавлено в «${choice?.name || 'Любимые песни'}»`,
      );
      if (!choice?.savedTrackId) setSaved(true);
    }
    setOpen(false);
  }
  async function choose(choice?: Choice) {
    if (locked.current || !selection) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await change(selection.track, choice);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function click() {
    if (locked.current || !valid) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNote('');
    const target = { ...track };
    try {
      const data = await read(target.url);
      if (!mounted.current) return;
      if (data.playlists.length > 1) {
        setSelection({ track: target, lists: data.playlists });
        setOpen(true);
      } else await change(target, data.playlists[0]);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <span className="music-favorite-wrap">
        <button
          type="button"
          className="music-favorite-button music-stage-icon"
          data-saved={saved}
          aria-pressed={saved}
          aria-label={
            saved
              ? 'Песня в плейлисте — изменить'
              : 'Нравится — добавить в плейлист'
          }
          title={note || (saved ? 'Песня в плейлисте' : 'Добавить в плейлист')}
          disabled={busy || !valid}
          onClick={() => void click()}
        >
          {busy ? (
            <LoaderCircle size={21} className="spin" />
          ) : (
            <Heart size={21} fill={saved ? 'currentColor' : 'none'} />
          )}
        </button>
        {(note || (error && !open)) && (
          <output className="music-favorite-note">
            {error && !open ? error : note}
          </output>
        )}
      </span>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!locked.current) setOpen(value);
        }}
      >
        <DialogContent
          className="noct-dialog music-favorite-dialog"
          overlayClassName="music-favorite-overlay"
          onContextMenu={(e) => e.stopPropagation()}
        >
          <DialogTitle>
            {selection?.lists.some((p) => p.savedTrackId)
              ? 'Плейлисты песни'
              : 'Добавить в плейлист'}
          </DialogTitle>
          <DialogDescription>{selection?.track.title}</DialogDescription>
          <div className="music-favorite-choices">
            {selection?.lists.map((p) => (
              <button
                className="music-favorite-choice"
                key={p.id}
                disabled={busy}
                aria-label={`${p.savedTrackId ? 'Убрать из' : 'Добавить в'} «${p.name}»`}
                onClick={() => void choose(p)}
              >
                <span className="music-favorite-art">
                  {p.artwork && playerArtwork(p.artwork) ? (
                    <img src={playerArtwork(p.artwork)} alt="" />
                  ) : (
                    <ListMusic size={22} />
                  )}
                </span>
                <span className="music-favorite-copy">
                  <strong>{p.name}</strong>
                  <small>
                    {p.savedTrackId
                      ? 'Добавлена · нажмите, чтобы убрать'
                      : `${p.trackCount} песен`}
                  </small>
                </span>
                {p.savedTrackId ? <Check size={19} /> : <Heart size={19} />}
              </button>
            ))}
          </div>
          {busy && <output className="meta">Сохраняем…</output>}
          {error && (
            <p className="music-error" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
