'use client';
import { DisplayName } from './profile-identity';
/* eslint-disable next/no-img-element, react/react-compiler, jsx-a11y/media-has-caption */
/* Uploaded videos have no caption track supplied by their author. */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  ImagePlus,
  X,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Eye,
  Flag,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  request,
  upload,
  type Person,
  type Media,
  type Profile,
} from '@/lib/client';
import { Avatar } from './post-card';
type Story = Person & {
  userId: string;
  text: string;
  background: string;
  mediaId: string | null;
  type: string;
  viewed: number;
  views: number | null;
  created: number;
  expiresAt: number;
  canManage: boolean;
};
const backgrounds = {
  night: 'Ночь',
  violet: 'Сирень',
  blue: 'Сумерки',
  ember: 'Закат',
};
export function StoriesBar({
  me,
  readOnly,
  channel,
}: {
  me: Person;
  readOnly: boolean;
  channel?: Profile;
}) {
  const [rows, setRows] = useState<Story[]>([]),
    [revision, setRevision] = useState(0),
    [creating, setCreating] = useState(false),
    [open, setOpen] = useState(false),
    [playlist, setPlaylist] = useState<Story[]>([]),
    [index, setIndex] = useState(0),
    [text, setText] = useState(''),
    [media, setMedia] = useState<Media | null>(null),
    [background, setBackground] = useState('night'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [paused, setPaused] = useState(false),
    [progress, setProgress] = useState(0),
    [reporting, setReporting] = useState(false),
    [reason, setReason] = useState(''),
    [viewers, setViewers] = useState<Person[] | null>(null),
    [mediaReady, setMediaReady] = useState(false);
  const activeStory = useRef<string | null>(null),
    picture = useRef<HTMLImageElement>(null);
  const video = useRef<HTMLVideoElement>(null),
    file = useRef<HTMLInputElement>(null),
    duration = useRef(5000),
    elapsed = useRef(0),
    lock = useRef(false);
  const current = playlist[index];
  const channelId = channel?.id;
  activeStory.current = open ? current?.id || null : null;
  useEffect(() => {
    if (open && current && !rows.some((s) => s.id === current.id)) {
      setOpen(false);
      setError('История больше недоступна');
    }
  }, [rows, current, open]);
  const next = useCallback(() => {
    setViewers(null);
    setReporting(false);
    setPaused(false);
    if (index + 1 < playlist.length) setIndex(index + 1);
    else setOpen(false);
  }, [index, playlist.length]);
  useEffect(() => {
    let live = true;
    const load = () =>
      request<Story[]>(
        '?action=stories' +
          (channelId ? '&id=' + encodeURIComponent(channelId) : ''),
      )
        .then((v) => {
          if (live) setRows(v);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [revision, me.id, channelId]);
  useEffect(() => {
    if (!open || !current) return;
    setViewers(null);
    setReporting(false);
    setMediaReady(
      !current.mediaId ||
        !!picture.current?.complete ||
        (video.current?.readyState || 0) >= 2,
    );
    elapsed.current = 0;
    duration.current = current.type?.startsWith('video/') ? 30000 : 5000;
    setProgress(0);
    setError('');
    void request('', { action: 'viewStory', id: current.id })
      .then(() => {
        setRows((v) =>
          v.map((s) => (s.id === current.id ? { ...s, viewed: 1 } : s)),
        );
      })
      .catch((e) => {
        if (activeStory.current === current.id) {
          setError(e.message);
          setOpen(false);
        }
      });
  }, [open, current]);
  useEffect(() => {
    if (!open || !current) return;
    const stopped =
      paused || reporting || viewers !== null || busy || !mediaReady;
    const v = video.current;
    if (stopped) v?.pause();
    else if (v) void v.play().catch(() => setPaused(true));
    const visibility = () => {
      if (document.visibilityState === 'hidden') v?.pause();
      else if (!stopped) void v?.play().catch(() => setPaused(true));
    };
    document.addEventListener('visibilitychange', visibility);
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      if (current.expiresAt <= Date.now()) {
        setOpen(false);
        return;
      }
      if (!stopped && document.visibilityState === 'visible') {
        elapsed.current += now - last;
        setProgress(Math.min(1, elapsed.current / duration.current));
        if (elapsed.current >= duration.current) {
          clearInterval(t);
          next();
        }
      }
      last = now;
    }, 50);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [
    open,
    index,
    paused,
    reporting,
    viewers,
    busy,
    playlist.length,
    current,
    next,
    mediaReady,
  ]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (busy) return;
      if ((e.target as HTMLElement).matches('input,textarea,button')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPaused((v) => !v);
      }
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') setIndex((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, index, playlist.length, next, busy]);
  const groups = [...new Map(rows.map((s) => [s.userId, s])).values()];
  async function action(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className="stories-strip"
        aria-label="Истории"
        hidden={!!channel && !(channel.boostLevel || groups.length)}
      >
        {(!channel || !!channel.canPublish) && (
          <button
            className="story-add"
            disabled={readOnly || (!!channel && !channel.boostLevel)}
            onClick={() => {
              setError('');
              setCreating(true);
            }}
          >
            <span>
              <Plus size={23} />
            </span>
            <small>{channel ? 'История канала' : 'Моя история'}</small>
          </button>
        )}
        {groups.map((g) => (
          <button
            key={g.userId}
            className={
              'story-person ' +
              (rows.some((s) => s.userId === g.userId && !s.viewed)
                ? 'unseen'
                : '')
            }
            onClick={() => {
              setPlaylist(
                rows
                  .filter((s) => s.userId === g.userId)
                  .sort((a, b) => a.created - b.created),
              );
              setIndex(0);
              setPaused(false);
              setViewers(null);
              setReporting(false);
              setOpen(true);
            }}
          >
            <span>
              <Avatar person={g} size={48} />
            </span>
            <small>{g.userId === me.id ? 'Вы' : g.name}</small>
          </button>
        ))}
        {!groups.length && (
          <p className="meta">Моменты, которые останутся на 24 часа.</p>
        )}
      </div>
      {error && !open && !creating && (
        <p className="realtime-error" role="alert">
          {error}
        </p>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="noct-dialog">
          <DialogTitle>
            {channel ? 'История канала «' + channel.name + '»' : 'Твоя история'}
          </DialogTitle>
          <DialogDescription>
            Фото, видео или несколько слов. Исчезнет через 24 часа.
            {channel && ` Лимит канала: ${channel.boostLevel || 0} за 24 часа.`}
          </DialogDescription>
          <form
            className="realtime-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await request('', {
                  action: 'story',
                  channelId: channel?.id,
                  text,
                  mediaId: media?.id,
                  background,
                });
                setCreating(false);
                setText('');
                setMedia(null);
                setRevision((v) => v + 1);
              });
            }}
          >
            <div className={'story-preview story-bg-' + background}>
              {media ? (
                <>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Убрать файл"
                    onClick={() => setMedia(null)}
                  >
                    <X size={18} />
                  </button>
                  {media.type.startsWith('video/') ? (
                    <video
                      src={'/api/media/' + media.id}
                      controls
                      playsInline
                    />
                  ) : (
                    <img
                      src={'/api/media/' + media.id}
                      alt="Предпросмотр истории"
                    />
                  )}
                </>
              ) : (
                <span>Твой момент</span>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={500}
                placeholder="Добавь текст…"
                aria-label="Текст истории"
              />
            </div>
            <div className="row">
              <input
                hidden
                type="file"
                ref={file}
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void action(async () => setMedia(await upload(f)));
                }}
              />
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => file.current?.click()}
              >
                <ImagePlus size={16} /> Фото / видео
              </button>
              <span className="grow" />
              <div className="story-swatches" aria-label="Фон истории">
                {Object.entries(backgrounds).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={'story-bg-' + v}
                    aria-label={label}
                    aria-pressed={background === v}
                    onClick={() => setBackground(v)}
                  />
                ))}
              </div>
            </div>
            {error && (
              <p className="realtime-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary"
              disabled={busy || (!text.trim() && !media)}
            >
              {busy ? 'Подождите…' : 'Опубликовать историю'}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="noct-dialog story-dialog"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">История {current?.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Фото или видео на 24 часа. Стрелки переключают истории, пробел
            ставит на паузу.
          </DialogDescription>
          {current && (
            <div className={'story-view story-bg-' + current.background}>
              <div className="story-progress">
                {playlist.map((s, i) => (
                  <span key={s.id}>
                    <i
                      style={{
                        transform: `scaleX(${i < index ? 1 : i === index ? progress : 0})`,
                      }}
                    />
                  </span>
                ))}
              </div>
              <div className="story-heading">
                <Avatar person={current} size={34} />
                <div>
                  <strong>
                    <DisplayName person={current} />
                  </strong>
                  <small>
                    {new Date(current.created).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </div>
                <span className="grow" />
                <button
                  className="icon-button"
                  aria-label={paused ? 'Продолжить' : 'Пауза'}
                  onClick={() => setPaused((v) => !v)}
                >
                  {paused ? <Play size={18} /> : <Pause size={18} />}
                </button>
                <button
                  className="icon-button"
                  aria-label="Закрыть историю"
                  onClick={() => setOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>
              <div className="story-media">
                {current.mediaId &&
                  (current.type?.startsWith('video/') ? (
                    <video
                      key={current.id}
                      ref={video}
                      src={'/api/media/' + current.mediaId}
                      playsInline
                      muted
                      autoPlay
                      onLoadedMetadata={(e) => {
                        duration.current = Math.min(
                          30000,
                          (e.currentTarget.duration || 30) * 1000,
                        );
                      }}
                      onLoadedData={() => setMediaReady(true)}
                      onEnded={() => {
                        if (document.visibilityState === 'visible') next();
                      }}
                      onError={() => {
                        setPaused(true);
                        setError('Видео не удалось загрузить');
                      }}
                    />
                  ) : (
                    <img
                      ref={picture}
                      onLoad={() => setMediaReady(true)}
                      src={'/api/media/' + current.mediaId}
                      alt={current.text || 'История'}
                      onError={() => {
                        setPaused(true);
                        setError('Фото не удалось загрузить');
                      }}
                    />
                  ))}
                {current.text && <p>{current.text}</p>}
              </div>
              <button
                className="story-prev icon-button"
                disabled={busy || index === 0}
                aria-label="Предыдущая история"
                onClick={() => setIndex((v) => v - 1)}
              >
                <ChevronLeft />
              </button>
              <button
                className="story-next icon-button"
                disabled={busy}
                aria-label="Следующая история"
                onClick={next}
              >
                <ChevronRight />
              </button>
              <div className="story-footer">
                {current.canManage ? (
                  <>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const id = current.id;
                          const people = await request<Person[]>(
                            '?action=storyViewers&id=' + id,
                          );
                          if (activeStory.current === id) setViewers(people);
                        })
                      }
                    >
                      <Eye size={16} /> Просмотры
                    </button>
                    <span className="grow" />
                    <button
                      className="icon-button"
                      disabled={busy || readOnly}
                      aria-label="Удалить историю"
                      onClick={() =>
                        void action(async () => {
                          await request('', {
                            action: 'deleteStory',
                            id: current.id,
                          });
                          setOpen(false);
                          setRevision((v) => v + 1);
                        })
                      }
                    >
                      <Trash2 size={18} />
                    </button>
                  </>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => setReporting(true)}
                  >
                    <Flag size={15} /> Пожаловаться
                  </button>
                )}
                {current.type?.startsWith('video/') && (
                  <button
                    className="secondary"
                    onClick={() => {
                      if (video.current)
                        video.current.muted = !video.current.muted;
                    }}
                  >
                    Звук вкл./выкл.
                  </button>
                )}
              </div>
              {error && (
                <p className="realtime-error" role="alert">
                  {error}
                </p>
              )}
              {viewers !== null && (
                <section className="story-sheet">
                  <div className="row">
                    <strong>Посмотрели</strong>
                    <span className="grow" />
                    <button
                      className="icon-button"
                      aria-label="Закрыть просмотры"
                      onClick={() => setViewers(null)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {viewers.length ? (
                    viewers.map((p) => (
                      <div className="realtime-person" key={p.id}>
                        <Avatar person={p} size={32} />
                        <span>
                          <DisplayName person={p} />
                          <small>@{p.handle}</small>
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="meta">Пока нет просмотров</p>
                  )}
                </section>
              )}
              {reporting && (
                <form
                  className="story-sheet realtime-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await request('', {
                        action: 'reportStory',
                        id: current.id,
                        reason,
                      });
                      setReason('');
                      setReporting(false);
                      setOpen(false);
                    });
                  }}
                >
                  <div className="row">
                    <strong>Причина жалобы</strong>
                    <span className="grow" />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Отмена"
                      onClick={() => setReporting(false)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <textarea
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    aria-label="Причина жалобы"
                  />
                  <button className="primary" disabled={busy}>
                    Отправить модератору
                  </button>
                </form>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
