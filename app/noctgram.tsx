'use client';
/* Auth routes require top-level links; private R2 images must keep session cookies.
   Async subscription effects intentionally set loading state; no React compiler is enabled. */
/* eslint-disable next/no-img-element, next/no-html-link-for-pages, react/react-compiler */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Moon,
  Home,
  Search,
  Image as ImageIcon,
  ChartNoAxesColumn,
  ArrowUpRight,
  Star,
  Send,
  Plus,
  X,
  Bookmark,
  Check,
  CheckCheck,
  ArrowLeft,
  Pencil,
  Camera,
  CalendarDays,
  AtSign,
  RefreshCw,
  Video,
  Sparkles,
  LogOut,
  LoaderCircle,
  UserRound,
  Mail,
  Copy,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Avatar, Empty, PostCard, Stamp } from './post-card';
import {
  request,
  upload,
  welcome,
  type Person,
  type Profile,
  type Media,
  type Post,
  type Comment,
  type Message,
} from '@/lib/client';
export default function Noctgram() {
  const [page, setPage] = useState('feed'),
    [me, setMe] = useState<Profile | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [people, setPeople] = useState<Person[]>([]),
    [posts, setPosts] = useState<Post[]>(welcome),
    [mode, setMode] = useState('all'),
    [profileTab, setProfileTab] = useState('posts'),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(''),
    [loadError, setLoadError] = useState(false),
    [guest, setGuest] = useState(false),
    [modal, setModal] = useState(''),
    [deleteId, setDeleteId] = useState(''),
    [lightbox, setLightbox] = useState<Media | null>(null),
    [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState(''),
    [attachments, setAttachments] = useState<Media[]>([]),
    [poll, setPoll] = useState<string[] | null>(null),
    [uploading, setUploading] = useState(false);
  const [commentPost, setCommentPost] = useState<Post | null>(null),
    [comments, setComments] = useState<Comment[]>([]),
    [commentText, setCommentText] = useState('');
  const [editName, setEditName] = useState(''),
    [editBio, setEditBio] = useState(''),
    [editAvatar, setEditAvatar] = useState(''),
    [editCover, setEditCover] = useState(''),
    [newHandle, setNewHandle] = useState('');
  const [threads, setThreads] = useState<Person[]>([]),
    [peer, setPeer] = useState<Person | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [messageText, setMessageText] = useState(''),
    [peopleQuery, setPeopleQuery] = useState(''),
    [found, setFound] = useState<Person[]>([]);
  const fileRef = useRef<HTMLInputElement>(null),
    searchRef = useRef<HTMLInputElement>(null),
    draftRef = useRef<HTMLTextAreaElement>(null),
    messageEnd = useRef<HTMLDivElement>(null),
    requestVersion = useRef(0),
    messageVersion = useRef(0),
    actionLock = useRef(false);
  const notify = (s: string) => setNotice(s);
  const auth = () => {
    if (!me) {
      setModal('signin');
      return false;
    }
    return true;
  };
  const run = async (fn: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const bootstrap = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const r = await request<{ me: Profile; people: Person[]; posts: Post[] }>(
        '?action=bootstrap',
      );
      setMe(r.me);
      setProfile(r.me);
      setPeople(r.people);
      setPosts(r.posts);
      setGuest(false);
    } catch (e) {
      if ((e as Error).message.startsWith('Войдите')) setGuest(true);
      else {
        setNotice((e as Error).message);
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  const myId = me?.id,
    viewedId = profile?.id;
  const refresh = useCallback(
    async (append = false, before = Date.now() + 1) => {
      if (!myId) return;
      const version = ++requestVersion.current;
      const filter =
        page === 'saved' ? 'saved' : page === 'profile' ? 'all' : mode;
      const user = page === 'profile' ? viewedId || myId : '';
      setLoading(true);
      try {
        const q = new URLSearchParams({
          action: 'feed',
          mode: filter,
          q: query,
          user,
        });
        if (append) q.set('before', String(before));
        const r = await request<Post[]>('?' + q);
        if (version === requestVersion.current) {
          setPosts((p) =>
            append
              ? [...p, ...r.filter((n) => !p.some((x) => x.id === n.id))]
              : r,
          );
          setHasMore(r.length === 30);
          setLoadError(false);
        }
      } catch (e) {
        if (version === requestVersion.current) {
          setNotice((e as Error).message);
          setLoadError(true);
        }
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [myId, page, viewedId, mode, query],
  );
  useEffect(() => {
    if (!myId || page === 'messages') return;
    const t = setTimeout(() => void refresh(), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [myId, page, query, refresh]);
  const navigate = (v: string) => {
    if (['profile', 'saved', 'messages'].includes(v) && !auth()) return;
    setQuery('');
    setPage(v);
    if (v === 'profile') {
      setProfile(me);
      setProfileTab('posts');
    }
    if (v === 'search') setTimeout(() => searchRef.current?.focus(), 0);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setPage('search');
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const loadThreads = useCallback(async () => {
    if (me) setThreads(await request<Person[]>('?action=threads'));
  }, [me]);
  const loadMessages = useCallback(async () => {
    if (!peer) return;
    const version = ++messageVersion.current;
    const r = await request<Message[]>(
      '?action=messages&peer=' + encodeURIComponent(peer.id),
    );
    if (version === messageVersion.current) setMessages(r);
  }, [peer]);
  useEffect(() => {
    if (page !== 'messages' || !me) return;
    void loadThreads().catch((e) => notify(e.message));
    const t = setInterval(() => {
      if (document.visibilityState === 'visible')
        void loadThreads().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [page, me, loadThreads]);
  useEffect(() => {
    if (page !== 'messages' || !peer) return;
    setMessages([]);
    void loadMessages().catch((e) => notify(e.message));
    const t = setInterval(() => {
      if (document.visibilityState === 'visible')
        void loadMessages().catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [peer, page, loadMessages]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);
  useEffect(() => {
    if (modal !== 'people' || !me) return;
    let active = true;
    const t = setTimeout(
      () =>
        request<Person[]>('?action=people&q=' + encodeURIComponent(peopleQuery))
          .then((r) => {
            if (active) setFound(r);
          })
          .catch((e) => notify(e.message)),
      200,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [peopleQuery, modal, me]);
  const openProfile = async (id: string) => {
    if (!auth()) return;
    await run(async () => {
      setProfile(
        await request<Profile>('?action=profile&id=' + encodeURIComponent(id)),
      );
      setProfileTab('posts');
      setQuery('');
      setPage('profile');
    });
  };
  const openChat = (person: Person) => {
    if (!auth()) return;
    if (person.id === 'noctgram') {
      notify('Это официальный канал. Общайтесь с командой в комментариях.');
      return;
    }
    setPeer(person);
    setMessageText('');
    setPage('messages');
    setModal('');
  };
  const addFiles = async (files: FileList | null) => {
    if (!files || !auth()) return;
    setUploading(true);
    try {
      if (attachments.length + files.length > 4)
        throw new Error('Можно прикрепить до четырёх файлов');
      for (const file of Array.from(files)) {
        const item = await upload(file);
        setAttachments((a) => [...a, item]);
      }
      setPoll(null);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const publish = () => {
    if (!auth()) return;
    void run(async () => {
      await request('', {
        action: 'post',
        text: draft,
        media: attachments.map((x) => x.id),
        poll: poll || [],
      });
      setDraft('');
      setAttachments([]);
      setPoll(null);
      await refresh();
      const updated = await request<Profile>('?action=profile');
      setMe(updated);
      if (profile?.id === updated.id) setProfile(updated);
      notify('Публикация появилась в ленте');
    });
  };
  const action = async (p: Post, kind: string, value: unknown) => {
    if (!auth()) return;
    await run(async () => {
      await request('', {
        action: kind,
        id: p.id,
        ...(kind === 'vote' ? { option: value } : { value }),
      });
      await refresh();
    });
  };
  const openComments = (p: Post) => {
    if (!auth()) return;
    setCommentPost(p);
    setComments([]);
    setCommentText('');
    setModal('comments');
    void run(async () =>
      setComments(await request<Comment[]>('?action=comments&post=' + p.id)),
    );
  };
  const edit = () => {
    if (!me) return;
    setEditName(me.name);
    setEditBio(me.bio);
    setEditAvatar(me.avatar);
    setEditCover(me.cover);
    setModal('edit');
  };
  const saveProfile = () =>
    void run(async () => {
      const r = await request<Profile>('', {
        action: 'profile',
        name: editName,
        bio: editBio,
        avatar: editAvatar,
        cover: editCover,
      });
      setMe(r);
      setProfile(r);
      setModal('');
      notify('Профиль обновлён');
      await refresh();
    });
  const updateHandle = (handle: string, remove = false) =>
    void run(async () => {
      const r = await request<Profile>('', {
        action: remove ? 'removeHandle' : 'handle',
        handle,
      });
      setMe(r);
      setProfile(r);
      setNewHandle('');
      notify(remove ? 'Юзернейм удалён' : 'Основной юзернейм обновлён');
    });
  const follow = (person: Person) => {
    if (!auth()) return;
    void run(async () => {
      await request('', {
        action: 'follow',
        id: person.id,
        value: !person.followed,
      });
      setPeople((p) =>
        p.map((x) =>
          x.id === person.id ? { ...x, followed: x.followed ? 0 : 1 } : x,
        ),
      );
      if (profile?.id === person.id)
        setProfile(await request<Profile>('?action=profile&id=' + person.id));
      setMe(await request<Profile>('?action=profile'));
    });
  };
  const composer = (
    <div className="composer">
      <div className="composer-top">
        <Avatar person={me || { name: 'Вы', avatar: '' }} size={40} />
        <textarea
          ref={draftRef}
          aria-label="Новая публикация"
          placeholder="Что нового?"
          maxLength={5000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      {attachments.length > 0 && (
        <div className="attachment-list">
          {attachments.map((m) => (
            <div key={m.id}>
              {m.type.startsWith('image/') ? (
                <img src={'/api/media/' + m.id} alt={m.name} />
              ) : (
                <Video size={28} />
              )}
              <span>{m.name}</span>
              <button
                aria-label={'Убрать ' + m.name}
                onClick={() =>
                  setAttachments((a) => a.filter((x) => x.id !== m.id))
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {poll && (
        <div className="poll-editor">
          <div className="row">
            <strong>Варианты ответа</strong>
            <span className="grow" />
            <button onClick={() => setPoll(null)} aria-label="Убрать опрос">
              <X size={16} />
            </button>
          </div>
          {poll.map((v, i) => (
            <div className="row" key={i}>
              <input
                aria-label={'Вариант ' + (i + 1)}
                placeholder={'Вариант ' + (i + 1)}
                maxLength={100}
                value={v}
                onChange={(e) =>
                  setPoll((a) =>
                    a!.map((x, n) => (n === i ? e.target.value : x)),
                  )
                }
              />
              {poll.length > 2 && (
                <button
                  aria-label={'Удалить вариант ' + (i + 1)}
                  onClick={() => setPoll((a) => a!.filter((_, n) => n !== i))}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          {poll.length < 6 && (
            <button
              className="text-button"
              onClick={() => setPoll((a) => [...a!, ''])}
            >
              <Plus size={14} />
              Добавить вариант
            </button>
          )}
        </div>
      )}
      <div className="toolbar">
        <input
          ref={fileRef}
          className="hidden"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
          multiple
          onChange={(e) => void addFiles(e.target.files)}
        />
        <button
          title="Фото или видео · до 25 МБ"
          aria-label="Добавить фото или видео"
          disabled={uploading || !!poll}
          onClick={() => {
            if (auth()) fileRef.current?.click();
          }}
        >
          <ImageIcon size={19} />
        </button>
        <button
          title="Опрос"
          aria-label="Добавить опрос"
          disabled={attachments.length > 0 || uploading}
          className={poll ? 'selected' : ''}
          onClick={() => {
            if (auth()) setPoll((p) => (p ? null : ['', '']));
          }}
        >
          <ChartNoAxesColumn size={19} />
        </button>
        <span className="meta composer-hint">
          {uploading
            ? 'Загружаем…'
            : draft.length
              ? `${draft.length} / 5000`
              : ''}
        </span>
        <span className="grow" />
        <button
          className="primary"
          disabled={
            busy ||
            uploading ||
            (!draft.trim() && !attachments.length) ||
            !!poll?.some((x) => !x.trim())
          }
          onClick={publish}
        >
          {busy ? <LoaderCircle size={14} className="spin" /> : 'Опубликовать'}
          <ArrowUpRight size={14} />
        </button>
      </div>
    </div>
  );
  const cards = (items: Post[]) =>
    items.map((p) => (
      <PostCard
        key={p.id}
        p={p}
        me={me?.id}
        busy={busy}
        onProfile={(id) => void openProfile(id)}
        onAction={(p, k, v) => void action(p, k, v)}
        onComments={openComments}
        onDelete={setDeleteId}
        onMedia={setLightbox}
      />
    ));
  const shownPosts =
    page === 'profile' && profileTab === 'media'
      ? posts.filter((p) => p.media.length)
      : posts;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('feed')}>
          <span className="brand-icon">
            <Moon size={22} strokeWidth={2.5} />
          </span>
          noctgram<span className="alpha">α</span>
        </button>
        <nav aria-label="Главное меню">
          {[
            ['feed', 'Лента', Home],
            ['search', 'Поиск', Search],
            ['messages', 'Сообщения', Mail],
            ['saved', 'Сохранённое', Bookmark],
            ['profile', 'Профиль', UserRound],
          ].map(([id, label, Icon]) => {
            const NavIcon = Icon as typeof Home;
            return (
              <button
                key={String(id)}
                className={page === id ? 'active' : ''}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => navigate(String(id))}
              >
                <NavIcon size={21} />
                <span>{String(label)}</span>
                {page === id && <i />}
              </button>
            );
          })}
        </nav>
        <button
          className="primary new-post"
          onClick={() => {
            navigate('feed');
            setTimeout(() => draftRef.current?.focus(), 0);
          }}
        >
          <Plus size={17} />
          <span>Новая публикация</span>
        </button>
        <div className="sidebar-bottom">
          <button className="premium-nav" onClick={() => setModal('premium')}>
            <Sparkles size={19} />
            <span>Noct Premium</span>
            <span className="badge">скоро</span>
          </button>
          {me ? (
            <>
              <button className="account" onClick={() => navigate('profile')}>
                <Avatar person={me} />
                <span>
                  <strong>{me.name}</strong>
                  <small>@{me.handle}</small>
                </span>
              </button>
              <a
                className="logout"
                href="/signout-with-chatgpt?return_to=%2F"
                target="_top"
              >
                <LogOut size={17} />
                <span>Выйти</span>
              </a>
            </>
          ) : (
            <a
              className="logout"
              href="/signin-with-chatgpt?return_to=%2F"
              target="_top"
            >
              <LogOut size={17} />
              <span>Войти</span>
            </a>
          )}
          <p className="sidebar-footnote">
            Твоё пространство.
            <br />В твоём ритме.
          </p>
        </div>
      </aside>
      <main
        className={
          'main-column ' + (page === 'messages' ? 'messages-main' : '')
        }
      >
        <header className="page-header">
          <h1>
            {page === 'profile'
              ? profile?.name || 'Профиль'
              : page === 'messages'
                ? 'Сообщения'
                : page === 'search'
                  ? 'Поиск'
                  : page === 'saved'
                    ? 'Сохранённое'
                    : 'Noctgram'}
          </h1>
          <span className="grow" />
          {loading && <LoaderCircle className="spin" size={15} />}
          <button
            className="icon-button"
            aria-label="Найти в Noctgram"
            onClick={() => navigate('search')}
          >
            <Search size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="Обновить"
            onClick={() => {
              if (me) void refresh();
              else void bootstrap();
            }}
          >
            <RefreshCw size={18} />
          </button>
        </header>
        {loadError && (
          <div className="error-banner" role="alert">
            Не удалось загрузить данные.{' '}
            <button onClick={() => void bootstrap()}>Повторить</button>
          </div>
        )}
        {page === 'feed' && (
          <>
            <div className="feed-tabs">
              <Tabs
                value={mode}
                onValueChange={(v) => {
                  if (v !== 'all' && !auth()) return;
                  setMode(String(v));
                }}
              >
                <TabsList>
                  <TabsTrigger value="all">Для вас</TabsTrigger>
                  <TabsTrigger value="following">Подписки</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {guest && (
              <div className="welcome-banner">
                <div>
                  <strong>Свои люди. Твои мысли.</strong>
                  <span>Войди, чтобы стать частью Noctgram.</span>
                </div>
                <a
                  href="/signin-with-chatgpt?return_to=%2F"
                  target="_top"
                  className="primary"
                >
                  Войти <ArrowUpRight size={14} />
                </a>
              </div>
            )}
            <div className="feed-intro">
              <span className="tiny-line" />
              <span>
                {mode === 'following'
                  ? 'Публикации тех, кто тебе интересен'
                  : 'Место для того, чем хочется поделиться'}
              </span>
            </div>
            {composer}
          </>
        )}
        {page === 'search' && (
          <div className="search-panel">
            <div className="searchbox">
              <Search size={18} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Поиск в ленте"
                placeholder="Публикации, темы, люди"
              />
              {query && (
                <button
                  aria-label="Очистить поиск"
                  onClick={() => setQuery('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              className="text-button"
              onClick={() => {
                if (auth()) {
                  setPeopleQuery(query);
                  setModal('people');
                }
              }}
            >
              <UserRound size={16} /> Найти человека по юзернейму{' '}
              <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {page === 'profile' && profile && (
          <>
            <section className="profile-card">
              <div
                className="profile-cover"
                style={
                  profile.cover
                    ? { backgroundImage: `url(${profile.cover})` }
                    : undefined
                }
              >
                <button
                  className="back-button"
                  aria-label="Вернуться в ленту"
                  onClick={() => navigate('feed')}
                >
                  <ArrowLeft size={18} />
                </button>
                {profile.id === me?.id && (
                  <button
                    className="cover-edit"
                    aria-label="Изменить обложку"
                    onClick={edit}
                  >
                    <Camera size={17} />
                  </button>
                )}
                <span className="cover-monogram">n.</span>
              </div>
              <div className="profile-info">
                <div className="profile-avatar-line">
                  <Avatar person={profile} size={98} />
                  <span className="grow" />
                  {profile.id === me?.id ? (
                    <>
                      <button className="secondary" onClick={edit}>
                        Редактировать
                      </button>
                      <button
                        className="icon-button cosmetic"
                        aria-label="Оформление профиля"
                        onClick={() => setModal('premium')}
                      >
                        <Sparkles size={18} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="primary"
                        onClick={() => follow(profile)}
                      >
                        {profile.followed ? 'Вы подписаны' : 'Подписаться'}
                      </button>
                      {profile.id !== 'noctgram' && (
                        <button
                          className="icon-button"
                          aria-label="Написать сообщение"
                          onClick={() => openChat(profile)}
                        >
                          <Send size={18} />
                        </button>
                      )}
                    </>
                  )}
                </div>
                <h2>
                  {profile.name}
                  {profile.id === 'noctgram' && (
                    <span className="verified">
                      <Check size={12} />
                    </span>
                  )}
                </h2>
                <button
                  className="handle-main meta"
                  title="Скопировать юзернейм"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText('@' + profile.handle)
                      .then(() => notify('Юзернейм скопирован'))
                      .catch(() => notify('@' + profile.handle))
                  }
                >
                  @{profile.handle}
                  <Copy size={12} />
                </button>
                <p className="bio">
                  {profile.bio ||
                    (profile.id === me?.id
                      ? 'Расскажи о себе — пусть свои тебя узнают.'
                      : 'Пока без описания.')}
                </p>
                <div className="handle-list">
                  {profile.handles
                    .filter((h) => h !== profile.handle)
                    .map((h) => (
                      <span key={h}>@{h}</span>
                    ))}
                  {profile.id === me?.id && (
                    <button onClick={() => setModal('handles')}>
                      <Plus size={13} /> Юзернеймы
                    </button>
                  )}
                </div>
                <div className="profile-details">
                  <CalendarDays size={14} /> В Noctgram с{' '}
                  {new Date(profile.created).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </div>
                <div className="profile-stats">
                  <span>
                    <strong>{profile.followers}</strong> подписчиков
                  </span>
                  <span>
                    <strong>{profile.following}</strong> подписок
                  </span>
                  <span>
                    <strong>{profile.postCount}</strong> публикаций
                  </span>
                </div>
                {profile.id === me?.id && (
                  <button
                    className="premium-strip"
                    onClick={() => setModal('premium')}
                  >
                    <Star size={16} />
                    <span>Noct Premium</span>
                    <span className="grow" />
                    <span className="badge">скоро</span>
                    <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
            </section>
            <div className="feed-tabs profile-tabs">
              <Tabs
                value={profileTab}
                onValueChange={(v) => setProfileTab(String(v))}
              >
                <TabsList>
                  <TabsTrigger value="posts">Публикации</TabsTrigger>
                  <TabsTrigger value="media">Медиа</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {profile.id === me?.id && profileTab === 'posts' && composer}
          </>
        )}
        {page !== 'messages' && (
          <>
            {cards(shownPosts)}
            {shownPosts.length === 0 && !loading && (
              <Empty>
                {query
                  ? 'Ничего не найдено. Попробуйте другой запрос.'
                  : page === 'saved'
                    ? 'Сохраняй публикации, чтобы вернуться к ним позже.'
                    : page === 'profile'
                      ? 'Здесь пока тихо. Каждая история с чего-то начинается.'
                      : mode === 'following'
                        ? 'Подпишись на интересных людей — их публикации появятся здесь.'
                        : 'Поделись первой мыслью.'}
              </Empty>
            )}
            {hasMore && (
              <button
                className="secondary load-more"
                disabled={loading}
                onClick={() =>
                  void refresh(true, posts[posts.length - 1]?.created)
                }
              >
                Загрузить ещё
              </button>
            )}
            <div className="feed-end">
              <Moon size={13} />
              {loading ? 'Загружаем публикации…' : 'Ты на одной волне с ночью'}
            </div>
          </>
        )}
        {page === 'messages' && (
          <div className={'messenger ' + (peer ? 'peer-open' : '')}>
            <section className="threads-panel">
              <div className="threads-heading">
                <span>Все диалоги</span>
                <span className="grow" />
                <button
                  className="icon-button"
                  aria-label="Новый диалог"
                  onClick={() => {
                    setPeopleQuery('');
                    setModal('people');
                  }}
                >
                  <Pencil size={16} />
                </button>
              </div>
              {threads.map((t) => (
                <button
                  key={t.id}
                  className={
                    'thread-row ' + (peer?.id === t.id ? 'active' : '')
                  }
                  onClick={() => {
                    setPeer(t);
                    setMessageText('');
                  }}
                >
                  <Avatar person={t} size={38} />
                  <span className="thread-copy">
                    <strong>{t.name}</strong>
                    <small>{t.lastText}</small>
                  </span>
                  {!!t.unread && <span className="unread">{t.unread}</span>}
                </button>
              ))}
              {!threads.length && (
                <Empty>
                  <p>Найди человека по юзернейму и начни разговор.</p>
                  <button
                    className="secondary"
                    onClick={() => setModal('people')}
                  >
                    Новый диалог <Plus size={14} />
                  </button>
                </Empty>
              )}
            </section>
            <section className="chat-panel">
              {peer ? (
                <>
                  <div className="chat-header">
                    <button
                      className="chat-back icon-button"
                      aria-label="Назад к диалогам"
                      onClick={() => setPeer(null)}
                    >
                      <ArrowLeft size={18} />
                    </button>
                    <button onClick={() => void openProfile(peer.id)}>
                      <Avatar person={peer} size={34} />
                      <span>
                        <strong>{peer.name}</strong>
                        <small>@{peer.handle}</small>
                      </span>
                    </button>
                  </div>
                  <div className="message-list">
                    {messages.length === 0 && (
                      <Empty>Здесь начинается ваш разговор.</Empty>
                    )}
                    {messages.map((m) => (
                      <div
                        className={
                          'bubble ' + (m.sender === me?.id ? 'self' : 'other')
                        }
                        key={m.id}
                      >
                        <p>{m.text}</p>
                        <span className="message-time">
                          {new Date(m.created).toLocaleTimeString('ru-RU', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {m.sender === me?.id &&
                            (m.read ? (
                              <CheckCheck size={13} />
                            ) : (
                              <Check size={13} />
                            ))}
                        </span>
                      </div>
                    ))}
                    <div ref={messageEnd} />
                  </div>
                  <form
                    className="message-composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!messageText.trim() || busy) return;
                      void run(async () => {
                        await request('', {
                          action: 'message',
                          id: peer.id,
                          text: messageText,
                        });
                        setMessageText('');
                        await loadMessages();
                        await loadThreads();
                      });
                    }}
                  >
                    <textarea
                      aria-label="Сообщение"
                      placeholder="Написать сообщение…"
                      maxLength={4000}
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <button
                      className="send-button"
                      aria-label="Отправить сообщение"
                      disabled={busy || !messageText.trim()}
                    >
                      <Send size={18} />
                    </button>
                  </form>
                </>
              ) : (
                <div className="chat-empty">
                  <Moon size={42} strokeWidth={1} />
                  <h2>Ближе, чем кажется.</h2>
                  <p>
                    Выбери диалог или начни новый.
                    <br />
                    Для разговоров между вами.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
      {page !== 'messages' && (
        <aside className="right-column">
          <section className="side-card">
            <div className="side-card-heading">
              <h2>Что происходит</h2>
              <span className="small-dot" />
            </div>
            <p className="side-lead">Новые мысли начинаются здесь.</p>
            {[
              ['#noctgram', 'Жизнь сообщества'],
              ['#ночныемысли', 'Разговоры после полуночи'],
              ['#вдохновение', 'То, что хочется сохранить'],
            ].map(([tag, desc]) => (
              <button
                className="topic"
                key={tag}
                onClick={() => {
                  setPage('search');
                  setQuery(tag);
                }}
              >
                <small>ТЕМА ДЛЯ РАЗГОВОРА</small>
                <strong>{tag}</strong>
                <span>{desc}</span>
                <ArrowUpRight size={14} />
              </button>
            ))}
            <button
              className="side-card-footer"
              onClick={() => navigate('search')}
            >
              Открыть поиск <ArrowUpRight size={15} />
            </button>
          </section>
          <section className="side-card people-card">
            <h2>Кого читать</h2>
            {(people.length
              ? people
              : [
                  {
                    id: 'noctgram',
                    name: 'Noctgram',
                    avatar: '',
                    handle: 'noctgram',
                  },
                ]
            ).map((person) => (
              <div className="suggest" key={person.id}>
                <button onClick={() => void openProfile(person.id)}>
                  <Avatar person={person} size={36} />
                  <span>
                    <strong>{person.name}</strong>
                    <small>@{person.handle}</small>
                  </span>
                </button>
                <button
                  className="follow-small"
                  disabled={busy}
                  aria-label={
                    person.followed
                      ? 'Отписаться от ' + person.name
                      : 'Подписаться на ' + person.name
                  }
                  onClick={() => follow(person)}
                >
                  {person.followed ? <Check size={14} /> : 'Читать'}
                </button>
              </div>
            ))}
            <button
              className="side-card-footer"
              onClick={() => {
                if (auth()) {
                  setPeopleQuery('');
                  setModal('people');
                }
              }}
            >
              Найти своих <ArrowUpRight size={15} />
            </button>
          </section>
          <button className="premium-card" onClick={() => setModal('premium')}>
            <span className="premium-top">
              <Sparkles size={24} />
              <span className="badge">скоро</span>
            </span>
            <h2>Ещё больше тебя.</h2>
            <p>
              Твой профиль. Твой характер.
              <br />
              Новые возможности Noct Premium.
            </p>
            <span className="premium-link">
              Узнать больше <ArrowUpRight size={14} />
            </span>
          </button>
          <div className="aside-footer">
            <span>noctgram</span>
            <span>alpha / 2026</span>
            <p>Меньше шума. Больше своего.</p>
          </div>
        </aside>
      )}
      <Dialog
        open={!!modal}
        onOpenChange={(open) => {
          if (!open && !uploading) setModal('');
        }}
      >
        <DialogContent
          className={
            'noct-dialog ' + (modal === 'comments' ? 'comments-dialog' : '')
          }
        >
          <DialogTitle>
            {(
              {
                signin: 'Войти в Noctgram',
                premium: 'Noct Premium',
                edit: 'Редактировать профиль',
                handles: 'Твои юзернеймы',
                comments: 'Комментарии',
                people: 'Найти своих',
              } as Record<string, string>
            )[modal] || 'Noctgram'}
          </DialogTitle>
          <DialogDescription>
            {
              (
                {
                  signin: 'Публикуй, общайся и сохраняй важное.',
                  premium: 'Больше способов быть собой. В разработке.',
                  edit: 'Пусть профиль рассказывает о тебе.',
                  handles: 'До пяти имён. Одно — основное.',
                  comments: 'Каждая мысль может стать началом разговора.',
                  people: 'Поиск по имени или @юзернейму.',
                } as Record<string, string>
              )[modal]
            }
          </DialogDescription>
          {modal === 'signin' && (
            <a
              className="primary sign-in-link"
              href="/signin-with-chatgpt?return_to=%2F"
              target="_top"
            >
              Войти через ChatGPT <ArrowUpRight size={15} />
            </a>
          )}
          {modal === 'premium' && (
            <div className="premium-modal">
              <div className="premium-star">
                <Star size={40} />
              </div>
              <span className="badge">TODO · скоро</span>
              <h2>
                Твоя ночь.
                <br />
                Твой стиль.
              </h2>
              <p>Косметические возможности Noct Premium:</p>
              <ul>
                <li>
                  <Sparkles size={19} />
                  <span>Анимированные аватары и рамки</span>
                </li>
                <li>
                  <Moon size={19} />
                  <span>Темы и оформление профиля</span>
                </li>
                <li>
                  <Star size={19} />
                  <span>Эксклюзивные значки и эмодзи-статусы</span>
                </li>
                <li>
                  <AtSign size={19} />
                  <span>Коллекционные юзернеймы</span>
                </li>
              </ul>
              <p className="meta">
                Покупки пока недоступны. О запуске расскажем в @noctgram.
              </p>
            </div>
          )}
          {modal === 'edit' && (
            <form
              className="edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                saveProfile();
              }}
            >
              <div className="edit-photo">
                <Avatar
                  person={{ name: editName, avatar: editAvatar }}
                  size={66}
                />
                <label className="secondary">
                  <Camera size={14} /> Аватар
                  <input
                    className="hidden"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setUploading(true);
                      void upload(f)
                        .then((m) => setEditAvatar(m.url!))
                        .catch((e) => notify(e.message))
                        .finally(() => setUploading(false));
                    }}
                  />
                </label>
                <label className="secondary">
                  Обложка
                  <input
                    className="hidden"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setUploading(true);
                      void upload(f)
                        .then((m) => setEditCover(m.url!))
                        .catch((e) => notify(e.message))
                        .finally(() => setUploading(false));
                    }}
                  />
                </label>
              </div>
              {editCover && (
                <div className="edit-cover">
                  <img src={editCover} alt="Новая обложка" />
                  <button
                    type="button"
                    aria-label="Убрать обложку"
                    onClick={() => setEditCover('')}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <label>
                Имя
                <input
                  required
                  maxLength={40}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label>
                О себе
                <textarea
                  rows={3}
                  maxLength={300}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  placeholder="Немного о тебе"
                />
                <span className="meta">{editBio.length} / 300</span>
              </label>
              <button
                className="primary"
                disabled={busy || uploading || !editName.trim()}
              >
                {uploading ? 'Загрузка…' : 'Сохранить изменения'}
              </button>
            </form>
          )}
          {modal === 'handles' && me && (
            <div className="handles-manager">
              {me.handles.map((h) => (
                <div className="handle-row" key={h}>
                  <AtSign size={15} />
                  <strong>{h}</strong>
                  <span className="grow" />
                  {me.handle === h ? (
                    <span className="badge">основной</span>
                  ) : (
                    <>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => updateHandle(h)}
                      >
                        Основной
                      </button>
                      <button
                        disabled={busy}
                        aria-label={'Удалить @' + h}
                        onClick={() => updateHandle(h, true)}
                      >
                        <X size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))}
              <form
                className="handle-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateHandle(newHandle);
                }}
              >
                <label>
                  Добавить юзернейм
                  <input
                    aria-label="Новый юзернейм"
                    value={newHandle}
                    maxLength={25}
                    onChange={(e) => setNewHandle(e.target.value)}
                    placeholder="@yourname"
                  />
                </label>
                <p className="meta">
                  4–24 символа: латинские буквы, цифры и _. Новое имя станет
                  основным.
                </p>
                <button
                  className="primary"
                  disabled={busy || !newHandle.trim()}
                >
                  Добавить
                </button>
              </form>
              <div className="handle-todo">
                <Star size={15} />
                <span>Покупка и коллекционные юзернеймы — в планах.</span>
              </div>
            </div>
          )}
          {modal === 'comments' && commentPost && (
            <>
              <div className="comment-context">
                <strong>{commentPost.name}</strong>
                <p>{commentPost.text}</p>
              </div>
              <div className="comment-list">
                {comments.map((c) => (
                  <article key={c.id} className="comment">
                    <Avatar person={c} />
                    <div>
                      <strong>{c.name}</strong>
                      <Stamp time={c.created} />
                      <p>{c.text}</p>
                    </div>
                  </article>
                ))}
                {!comments.length && (
                  <Empty>
                    {busy ? 'Загружаем…' : 'Начни разговор первым.'}
                  </Empty>
                )}
              </div>
              <form
                className="comment-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await request('', {
                      action: 'comment',
                      id: commentPost.id,
                      text: commentText,
                    });
                    setCommentText('');
                    setComments(
                      await request<Comment[]>(
                        '?action=comments&post=' + commentPost.id,
                      ),
                    );
                    await refresh();
                  });
                }}
              >
                <textarea
                  aria-label="Комментарий"
                  placeholder="Добавить мысль…"
                  maxLength={2000}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={busy || !commentText.trim()}
                  aria-label="Отправить комментарий"
                >
                  <Send size={17} />
                </button>
              </form>
            </>
          )}
          {modal === 'people' && (
            <>
              <div className="searchbox">
                <Search size={16} />
                <input
                  placeholder="Имя или @username"
                  aria-label="Поиск людей"
                  value={peopleQuery}
                  onChange={(e) => setPeopleQuery(e.target.value)}
                />
              </div>
              <div className="people-results">
                {found.map((p) => (
                  <div className="person-result" key={p.id}>
                    <button
                      onClick={() => {
                        setModal('');
                        void openProfile(p.id);
                      }}
                    >
                      <Avatar person={p} size={38} />
                      <span>
                        <strong>{p.name}</strong>
                        <small>@{p.handle}</small>
                      </span>
                    </button>
                    <span className="grow" />
                    {p.id !== 'noctgram' && (
                      <button
                        className="secondary"
                        onClick={() => openChat(p)}
                        aria-label={'Написать ' + p.name}
                      >
                        <Send size={15} />
                      </button>
                    )}
                  </div>
                ))}
                {!found.length && (
                  <Empty>
                    Никого не найдено. Проверь юзернейм или попробуй другое имя.
                  </Empty>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!lightbox}
        onOpenChange={(o) => {
          if (!o) setLightbox(null);
        }}
      >
        <DialogContent className="lightbox">
          <DialogTitle className="sr-only">
            {lightbox?.name || 'Фотография'}
          </DialogTitle>
          {lightbox && (
            <img src={'/api/media/' + lightbox.id} alt={lightbox.name} />
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(o) => {
          if (!o) setDeleteId('');
        }}
      >
        <AlertDialogContent className="noct-dialog">
          <AlertDialogTitle>Удалить публикацию?</AlertDialogTitle>
          <AlertDialogDescription>
            Публикация, комментарии и голоса будут удалены. Это действие нельзя
            отменить.
          </AlertDialogDescription>
          <div className="row">
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <span className="grow" />
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await request('', { action: 'delete', id: deleteId });
                  setDeleteId('');
                  await refresh();
                  const p = await request<Profile>('?action=profile');
                  setMe(p);
                  if (profile?.id === p.id) setProfile(p);
                  notify('Публикация удалена');
                })
              }
            >
              Удалить
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      {notice && (
        <output className="toast" aria-live="polite">
          <span>{notice}</span>
          <button
            aria-label="Закрыть уведомление"
            onClick={() => setNotice('')}
          >
            <X size={15} />
          </button>
        </output>
      )}
    </div>
  );
}
