'use client';
/* Auth routes require top-level links; private R2 images must keep session cookies.
   Async subscription effects intentionally set loading state; no React compiler is enabled. */
/* eslint-disable next/no-img-element, next/no-html-link-for-pages, react/react-compiler */
import { StoriesBar } from './stories-bar';
import { ChannelTools, localDate } from './channel-tools';
import { NotificationsBell } from './notifications';
import { useAudioCalls } from './audio-calls';
import { Clock3, Phone } from 'lucide-react';
import { PrivacyPanel } from './privacy-panel';
import { Ban, Flag } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Moon,
  Home,
  Search,
  Image as ImageIcon,
  ChartNoAxesColumn,
  ArrowUpRight,
  Send,
  Plus,
  X,
  Bookmark,
  ChevronRight,
  Check,
  CheckCheck,
  ArrowLeft,
  Pencil,
  Camera,
  CalendarDays,
  RefreshCw,
  Video,
  LogOut,
  LoaderCircle,
  UserRound,
  Mail,
  Copy,
  Code2,
  Megaphone,
  ShieldCheck,
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
import { Avatar, Empty, PostCard, PostSkeleton } from './post-card';
import { CommentsPanel } from './comments-panel';
import { ContentDecisionForm } from './content-decision-form';
import { ProfileDesign } from './profile-design';
import {
  DisplayName,
  ProfileAvatar,
  appearanceStyle,
} from './profile-identity';
import { PremiumPanel } from './premium-panel';
import { PremiumIcon } from './premium-icon';
import { StarsIcon, NoctLogo } from './stars-icon';
import { StarsPanel, SupportPanel } from './stars-panel';
import { ChannelsPanel } from './channels-panel';
import { NoctMascot } from './noct-mascot';
import { ConnectionsPanel } from './connections-panel';
import {
  BlockedAccount,
  ReadOnlyNotice,
  SuspendedProfile,
} from './account-states';
import { ModerationPanel } from './moderation-panel';
import { SignOutButton } from './sign-out-button';
import {
  request,
  upload,
  welcome,
  type Person,
  type Profile,
  type Media,
  type Post,
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
    [noticeVersion, setNoticeVersion] = useState(0),
    [loadError, setLoadError] = useState(false),
    [guest, setGuest] = useState(false),
    [modal, setModalContent] = useState(''),
    [modalOpen, setModalOpen] = useState(false),
    [connectionsProfile, setConnectionsProfile] = useState<Profile | null>(
      null,
    ),
    [deleteId, setDeleteId] = useState(''),
    [lightbox, setLightbox] = useState<Media | null>(null),
    [lightboxOpen, setLightboxOpen] = useState(false),
    [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState(''),
    [attachments, setAttachments] = useState<Media[]>([]),
    [poll, setPoll] = useState<string[] | null>(null),
    [uploading, setUploading] = useState(false),
    [code, setCode] = useState<string | null>(null),
    [codeLang, setCodeLang] = useState('text'),
    [adult, setAdult] = useState(false);
  const [commentPost, setCommentPost] = useState<Post | null>(null),
    [supportPost, setSupportPost] = useState<Post | null>(null),
    [reportPost, setReportPost] = useState<Post | null>(null),
    [reportReason, setReportReason] = useState(''),
    [undoHidden, setUndoHidden] = useState<Post | null>(null),
    [topics, setTopics] = useState<{ tag: string; count: number }[]>([]),
    [toastLeaving, setToastLeaving] = useState(false),
    [privacyVersion, setPrivacyVersion] = useState(0);
  const [editTab, setEditTab] = useState<'profile' | 'privacy' | 'design'>(
      'profile',
    ),
    [reportedMessage, setReportedMessage] = useState<Message | null>(null),
    [messageAccess, setMessageAccess] = useState<{
      allowed: boolean;
      blockedByMe: boolean;
    } | null>(null),
    [editName, setEditName] = useState(''),
    [editBio, setEditBio] = useState(''),
    [editAvatar, setEditAvatar] = useState(''),
    [editCover, setEditCover] = useState(''),
    [editId, setEditId] = useState(''),
    [editHandle, setEditHandle] = useState(''),
    [editAliases, setEditAliases] = useState<string[]>([]);
  const [threads, setThreads] = useState<Person[]>([]),
    [peer, setPeer] = useState<Person | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [messageText, setMessageText] = useState(''),
    [peopleQuery, setPeopleQuery] = useState(''),
    [found, setFound] = useState<Person[]>([]);
  const [scheduledAt, setScheduledAt] = useState(''),
    [scheduleVersion, setScheduleVersion] = useState(0);
  const readOnly = me?.restriction?.mode === 'read_only';
  const accountBlocked = me?.restriction?.mode === 'blocked';
  const audioCalls = useAudioCalls(me?.id, readOnly || accountBlocked);
  const fileRef = useRef<HTMLInputElement>(null),
    searchRef = useRef<HTMLInputElement>(null),
    draftRef = useRef<HTMLTextAreaElement>(null),
    messageEnd = useRef<HTMLDivElement>(null),
    requestVersion = useRef(0),
    messageVersion = useRef(0),
    activePeer = useRef(''),
    premiumReturn = useRef('feed'),
    starsReturn = useRef('feed'),
    actionLock = useRef(false);
  const setModal = (next: string) => {
    if (next) setModalContent(next);
    setModalOpen(!!next);
  };
  const notify = (s: string, undo: Post | null = null) => {
    setToastLeaving(false);
    setUndoHidden(undo);
    setNotice(s);
    setNoticeVersion((v) => v + 1);
  };
  const auth = () => {
    if (!me) {
      setModal('signin');
      return false;
    }
    return true;
  };
  const writable = () => {
    if (!auth()) return false;
    if (readOnly || accountBlocked) {
      notify(
        'Для аккаунта действуют ограничения. Подробности — в плашке над контентом.',
      );
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
    const fade = setTimeout(() => setToastLeaving(true), 4200);
    const t = setTimeout(() => {
      setNotice('');
      setUndoHidden(null);
      setToastLeaving(false);
    }, 4480);
    return () => {
      clearTimeout(fade);
      clearTimeout(t);
    };
  }, [notice, noticeVersion]);
  const updateAccount = useCallback((next: Profile) => {
    setMe(next);
    setProfile((current) => (current?.id === next.id ? next : current));
    if (next.restriction?.mode === 'blocked') {
      setPosts([]);
      setThreads([]);
      setMessages([]);
      setModalOpen(false);
    }
  }, []);
  const refreshAccount = useCallback(async () => {
    updateAccount(await request<Profile>('?action=account'));
  }, [updateAccount]);
  const myId = me?.id,
    viewedId = profile?.id,
    pinnedId = profile?.pinnedPostId;
  useEffect(() => {
    if (!myId) return;
    let live = true;
    const check = () => {
      if (document.visibilityState === 'visible')
        void request<Profile>('?action=account')
          .then((p) => {
            if (live) updateAccount(p);
          })
          .catch(() => {});
    };
    const timer = setInterval(check, 15000);
    window.addEventListener('focus', check);
    window.addEventListener('noctgram:restriction', check);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('noctgram:restriction', check);
    };
  }, [myId, updateAccount]);
  useEffect(() => {
    if (!myId || page !== 'profile' || profile?.kind !== 'channel') return;
    const id = profile.id;
    let live = true,
      pending = false;
    const check = () => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      void request<Profile>('?action=profile&id=' + encodeURIComponent(id))
        .then((next) => {
          if (live)
            setProfile((current) => (current?.id === id ? next : current));
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    };
    const timer = setInterval(check, 15000);
    window.addEventListener('focus', check);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [myId, page, profile?.id, profile?.kind, profile?.ownerId]);
  const refresh = useCallback(
    async (append = false, before = Date.now() + 1, afterId = '') => {
      if (
        !myId ||
        accountBlocked ||
        (page === 'profile' && profile?.blocked) ||
        ['premium', 'stars', 'channels', 'messages', 'moderation'].includes(
          page,
        )
      )
        return;
      const version = ++requestVersion.current;
      const filter =
        page === 'saved' ? 'saved' : page === 'feed' ? mode : 'all';
      const user = page === 'profile' ? viewedId || myId : '';
      setLoading(true);
      try {
        const q = new URLSearchParams({
          action: 'feed',
          mode: filter,
          q: query,
          user,
        });
        if (page === 'profile' && profileTab === 'media') q.set('media', '1');
        if (append) {
          q.set('before', String(before));
          q.set('afterId', afterId);
        }
        const r = await request<Post[]>('?' + q);
        const count = r.length;
        if (
          !append &&
          page === 'profile' &&
          profileTab === 'posts' &&
          pinnedId &&
          !query &&
          !r.some((p) => p.id === pinnedId)
        ) {
          try {
            r.unshift(
              await request<Post>(
                '?action=post&id=' + encodeURIComponent(pinnedId),
              ),
            );
          } catch {
            /* A deleted pin does not block the profile feed. */
          }
        }
        if (version === requestVersion.current) {
          setPosts((p) =>
            append
              ? [...p, ...r.filter((n) => !p.some((x) => x.id === n.id))]
              : r,
          );
          setHasMore(count === 30);
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
    [
      myId,
      page,
      viewedId,
      mode,
      query,
      profileTab,
      pinnedId,
      accountBlocked,
      profile?.blocked,
    ],
  );
  const latestRefresh = useRef(refresh);
  useEffect(() => {
    latestRefresh.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (
      !myId ||
      accountBlocked ||
      (page === 'profile' && profile?.blocked) ||
      ['premium', 'stars', 'channels', 'messages', 'moderation'].includes(page)
    )
      return;
    setPosts([]);
    setHasMore(false);
    setLoading(true);
    const t = setTimeout(() => void refresh(), query ? 250 : 0);
    const version = requestVersion;
    return () => {
      clearTimeout(t);
      version.current++;
    };
  }, [myId, page, query, refresh, accountBlocked, profile?.blocked]);
  useEffect(() => {
    if (!myId) return;
    let active = true;
    request<{ tag: string; count: number }[]>('?action=topics')
      .then((v) => {
        if (active) setTopics(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [myId, posts.length, privacyVersion]);
  useEffect(() => {
    if (!myId || !privacyVersion) return;
    let active = true;
    request<{ me: Profile; people: Person[] }>('?action=bootstrap')
      .then((r) => {
        if (active) {
          setPeople(r.people);
          updateAccount(r.me);
        }
      })
      .catch((e) => {
        if (active) notify(e.message);
      });
    return () => {
      active = false;
    };
  }, [myId, privacyVersion, updateAccount]);
  useEffect(() => {
    if (!myId) return;
    const params = new URLSearchParams(window.location.search);
    const chat = params.get('chat');
    if (chat)
      void request<Profile>('?action=profile&id=' + encodeURIComponent(chat))
        .then((person) => {
          if (person.kind === 'channel') return;
          messageVersion.current++;
          activePeer.current = person.id;
          setMessages([]);
          setPeer(person);
          setMessageAccess(null);
          setMessageText('');
          setPage('messages');
        })
        .catch((e) => notify(e.message));
    const id = params.get('post');
    if (!id) return;
    let active = true;
    request<Post>('?action=post&id=' + encodeURIComponent(id))
      .then((p) => {
        if (active) {
          setCommentPost(p);
          setModal('comments');
        }
      })
      .catch((e) => {
        if (active) notify(e.message);
      });
    return () => {
      active = false;
    };
  }, [myId]);
  const refreshPost = async (id: string) => {
    try {
      const updated = await request<Post>(
        '?action=post&id=' + encodeURIComponent(id),
      );
      setPosts((rows) => rows.map((p) => (p.id === id ? updated : p)));
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const navigate = (v: string) => {
    if (
      ['profile', 'saved', 'messages', 'channels', 'stars'].includes(v) &&
      !auth()
    )
      return;
    if (v === 'moderation' && !me?.canModerate) return;
    if (v === 'premium' && page !== 'premium') premiumReturn.current = page;
    if (v === 'stars' && page !== 'stars') starsReturn.current = page;
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
    if (me && me.restriction?.mode !== 'blocked')
      setThreads(await request<Person[]>('?action=threads'));
  }, [me]);
  const loadMessages = useCallback(async () => {
    if (!peer || activePeer.current !== peer.id) return;
    const version = ++messageVersion.current;
    let r: Message[];
    let access: { allowed: boolean; blockedByMe: boolean };
    try {
      [r, access] = await Promise.all([
        request<Message[]>(
          '?action=messages&peer=' + encodeURIComponent(peer.id),
        ),
        request<{ allowed: boolean; blockedByMe: boolean }>(
          '?action=messageAccess&peer=' + encodeURIComponent(peer.id),
        ),
      ]);
    } catch (e) {
      if (version === messageVersion.current) {
        setMessages([]);
        setMessageAccess(null);
      }
      throw e;
    }
    if (version === messageVersion.current && activePeer.current === peer.id) {
      setMessages(r);
      setMessageAccess(access);
    }
  }, [peer]);
  useEffect(() => {
    if (!me) return;
    void loadThreads().catch((e) => notify(e.message));
    const t = setInterval(() => {
      if (document.visibilityState === 'visible')
        void loadThreads().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [page, me, loadThreads]);
  useEffect(() => {
    if (page !== 'messages' || !peer || accountBlocked) return;
    activePeer.current = peer.id;
    const generationRef = messageVersion;
    setMessages([]);
    void loadMessages().catch((e) => notify(e.message));
    const t = setInterval(() => {
      if (document.visibilityState === 'visible')
        void loadMessages().catch(() => {});
    }, 3000);
    return () => {
      clearInterval(t);
      activePeer.current = '';
      generationRef.current++;
    };
  }, [peer, page, loadMessages, accountBlocked]);
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
    messageVersion.current++;
    activePeer.current = person.id;
    setMessages([]);
    setPeer(person);
    setMessageAccess(null);
    setMessageText('');
    setPage('messages');
    setModal('');
  };
  const addFiles = async (files: FileList | null) => {
    if (!files || !writable()) return;
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
    if (!writable()) return;
    const publisher =
      page === 'profile' && profile?.kind === 'channel' ? profile.id : me!.id;
    void run(async () => {
      await request('', {
        action: 'post',
        as: publisher,
        text: draft,
        media: attachments.map((x) => x.id),
        poll: poll || [],
        code: code || '',
        codeLang,
        adult,
        publishAt: scheduledAt ? new Date(scheduledAt).getTime() : 0,
      });
      setDraft('');
      setAttachments([]);
      setPoll(null);
      setCode(null);
      setCodeLang('text');
      setAdult(false);
      await latestRefresh.current();
      const updated = await request<Profile>(
        '?action=profile&id=' + encodeURIComponent(publisher),
      );
      if (updated.id === me?.id) setMe(updated);
      setProfile((current) => (current?.id === updated.id ? updated : current));
      notify(
        scheduledAt
          ? 'Публикация добавлена в очередь'
          : 'Публикация появилась в ленте',
      );
      setScheduledAt('');
      setScheduleVersion((v) => v + 1);
    });
  };
  const recordView = useCallback(
    async (id: string) => {
      if (!myId) return false;
      try {
        const result = await request<{ views: number }>('', {
          action: 'view',
          id,
        });
        setPosts((rows) =>
          rows.map((p) => (p.id === id ? { ...p, views: result.views } : p)),
        );
        return true;
      } catch {
        return false;
      }
    },
    [myId],
  );
  const action = async (
    p: Post,
    kind: string,
    value: unknown,
  ): Promise<boolean> => {
    if (!auth()) return false;
    try {
      await request('', {
        action: kind,
        id: p.id,
        ...(kind === 'vote' ? { option: value } : { value }),
      });
      const updated = await request<Post>(
        '?action=post&id=' + encodeURIComponent(p.id),
      );
      setPosts((rows) => rows.map((x) => (x.id === p.id ? updated : x)));
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    }
  };
  const openComments = (p: Post) => {
    if (!auth()) return;
    setCommentPost(p);
    setModal('comments');
  };
  const postMenu = (p: Post, kind: string) => {
    if (kind === 'copy') {
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('post', p.id);
      void navigator.clipboard
        .writeText(url.href)
        .then(() => notify('Ссылка скопирована'))
        .catch(() => notify('Не удалось скопировать ссылку'));
      return;
    }
    if (!auth()) return;
    if (kind === 'moderateContent' && me?.canModerate) {
      setReportPost(p);
      setModal('moderateContent');
      return;
    }
    if (kind === 'report') {
      setReportPost(p);
      setReportReason('');
      setModal('report');
      return;
    }
    void run(async () => {
      await request('', {
        action: kind,
        id: p.id,
        value: kind === 'pin' ? !p.pinned : true,
      });
      if (kind === 'hide') {
        setPosts((rows) => rows.filter((x) => x.id !== p.id));
        notify('Публикация скрыта', p);
      } else {
        setPosts((rows) =>
          rows.map((x) =>
            x.userId === p.userId
              ? { ...x, pinned: x.id === p.id && !p.pinned ? 1 : 0 }
              : x,
          ),
        );
        const next = await request<Profile>(
          '?action=profile&id=' + encodeURIComponent(p.userId),
        );
        if (next.id === me?.id) setMe(next);
        setProfile((current) => (current?.id === next.id ? next : current));
        notify(
          p.pinned
            ? 'Публикация откреплена'
            : 'Публикация закреплена в профиле',
        );
      }
    });
  };
  const profileOwned =
    !!me && (profile?.id === me.id || profile?.ownerId === me.id);
  const profileEditable = profileOwned || !!profile?.canEditProfile;
  const profilePublisher = profileOwned || !!profile?.canPublish;
  const channelRestricted =
    profile?.kind === 'channel' && !!profile.restriction;
  const edit = (tab: 'profile' | 'design' = 'profile', own = false) => {
    if (!me || accountBlocked) return;
    if (!own && profileEditable && channelRestricted) {
      notify('Редактирование канала ограничено модератором');
      return;
    }
    const target = !own && profileEditable && profile ? profile : me;
    setEditTab(readOnly && target.id === me.id ? 'privacy' : tab);
    setEditId(target.id);
    setEditName(target.name);
    setEditBio(target.bio);
    setEditAvatar(target.avatar);
    setEditCover(target.cover);
    setEditHandle(target.handle);
    setEditAliases(target.handles.filter((h) => h !== target.handle));
    setModal('edit');
  };
  const applyAppearance = (updated: Profile) => {
    setMe(updated);
    setProfile((current) => (current?.id === updated.id ? updated : current));
    const appearance = {
      premium: updated.premium,
      profileTheme: updated.profileTheme,
      nameGradient: updated.nameGradient,
      ringText: updated.ringText,
      chromeFlow: updated.chromeFlow,
      chromeTempo: updated.chromeTempo,
      avatar: updated.avatar,
      avatarMotion: updated.avatarMotion,
      avatarMotionType: updated.avatarMotionType,
    };
    setPosts((rows) =>
      rows.map((row) =>
        row.userId === updated.id ? { ...row, ...appearance } : row,
      ),
    );
    setThreads((rows) =>
      rows.map((row) =>
        row.id === updated.id ? { ...row, ...appearance } : row,
      ),
    );
    void latestRefresh.current();
  };
  const saveProfile = () =>
    void run(async () => {
      const r = await request<Profile>('', {
        action: 'profile',
        id: editId,
        name: editName,
        bio: editBio,
        avatar: editAvatar,
        cover: editCover,
        mainHandle: editHandle,
        extraHandles: editAliases,
      });
      if (r.id === me?.id) setMe(r);
      setProfile((current) => (current?.id === r.id ? r : current));
      setModal('');
      notify('Изменения сохранены');
      await latestRefresh.current();
    });
  const follow = (person: Person) => {
    if (!writable()) return;
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
      const updated = await request<Profile>('?action=profile&id=' + person.id);
      setProfile((current) => (current?.id === person.id ? updated : current));
      setMe(await request<Profile>('?action=profile'));
    });
  };
  const composer = (
    <fieldset className="composer" disabled={busy || readOnly}>
      <div className="composer-top">
        <Avatar
          person={
            page === 'profile' && profile?.kind === 'channel'
              ? profile
              : me || { name: 'Вы', avatar: '' }
          }
          size={40}
        />
        <textarea
          ref={draftRef}
          aria-label="Новая публикация"
          placeholder={poll ? 'Задай вопрос…' : 'Что нового?'}
          maxLength={5000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      {page === 'profile' && profile?.kind === 'channel' && (
        <div className="publish-as">
          <Megaphone size={13} />
          Публикация от имени {profile.name}
        </div>
      )}
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
            <strong>
              <ChartNoAxesColumn size={15} /> Опрос
            </strong>
            <span className="grow" />
            <button onClick={() => setPoll(null)} aria-label="Убрать опрос">
              <X size={16} />
            </button>
          </div>
          <p className="poll-editor-hint">
            Вопрос — в тексте публикации. Добавь от 2 до 6 вариантов.
          </p>
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
      {code !== null && (
        <div className="code-editor">
          <div className="row">
            <Code2 size={15} />
            <strong>Блок кода</strong>
            <input
              aria-label="Язык программирования"
              value={codeLang}
              maxLength={24}
              placeholder="text"
              onChange={(e) => setCodeLang(e.target.value)}
            />
            <button aria-label="Убрать блок кода" onClick={() => setCode(null)}>
              <X size={15} />
            </button>
          </div>
          <textarea
            aria-label="Код публикации"
            spellCheck={false}
            value={code}
            maxLength={20000}
            rows={7}
            placeholder="Вставь код…"
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
      )}
      {scheduledAt && (
        <div className="schedule-editor">
          <Clock3 size={18} />
          <label>
            Когда опубликовать
            <input
              type="datetime-local"
              required
              min={localDate(Date.now() + 60000)}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </label>
          <button
            className="icon-button"
            aria-label="Опубликовать без задержки"
            onClick={() => setScheduledAt('')}
          >
            <X size={17} />
          </button>
          <small className="meta">Время на этом устройстве</small>
        </div>
      )}
      <div className="toolbar">
        <button
          title="Отложить публикацию"
          aria-label="Отложить публикацию"
          aria-pressed={!!scheduledAt}
          className={scheduledAt ? 'selected' : ''}
          onClick={() => {
            if (auth()) setScheduledAt((v) => (v ? '' : localDate()));
          }}
        >
          <Clock3 size={19} />
        </button>
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
        <button
          title="Блок кода"
          aria-label="Прикрепить блок кода"
          className={code !== null ? 'selected' : ''}
          onClick={() => {
            if (auth()) setCode((c) => (c === null ? '' : null));
          }}
        >
          <Code2 size={19} />
        </button>
        {attachments.length > 0 && (
          <button
            title="Размыть только фото и видео"
            aria-label="Материалы 18+"
            aria-pressed={adult}
            className={'adult-toggle ' + (adult ? 'selected' : '')}
            onClick={() => setAdult((v) => !v)}
          >
            18+
          </button>
        )}
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
            (!draft.trim() && !attachments.length && !code?.trim()) ||
            !!poll?.some((x) => !x.trim())
          }
          onClick={publish}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : scheduledAt ? (
            'Отложить'
          ) : (
            'Опубликовать'
          )}
          <ArrowUpRight size={14} />
        </button>
      </div>
    </fieldset>
  );
  const cards = (items: Post[]) =>
    items.map((p) => (
      <PostCard
        canModerate={!!me?.canModerate && !readOnly}
        key={p.id}
        p={p}
        me={me?.id}
        busy={busy || readOnly}
        onProfile={(id) => void openProfile(id)}
        onAction={action}
        onComments={openComments}
        onDelete={setDeleteId}
        onMedia={(media) => {
          setLightbox(media);
          setLightboxOpen(true);
        }}
        onMenu={postMenu}
        onView={recordView}
        onSupport={(p) => {
          if (writable()) {
            setSupportPost(p);
            setModal('support');
          }
        }}
      />
    ));
  const shownPosts =
    page === 'profile' && profileTab === 'media'
      ? posts.filter((p) => p.media.length)
      : page === 'profile'
        ? [...posts].sort((a, b) => (b.pinned || 0) - (a.pinned || 0))
        : page === 'saved'
          ? posts.filter((p) => p.saved)
          : posts;
  const unread = threads.reduce((sum, t) => sum + (t.unread || 0), 0);
  const online = !!profile?.lastSeen && Date.now() - profile.lastSeen < 120000;
  if (accountBlocked && me)
    return (
      <BlockedAccount
        me={me}
        onUpdate={updateAccount}
        onRefresh={refreshAccount}
      />
    );
  return (
    <div className="app-shell">
      {audioCalls.panel}
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('feed')}>
          <span className="brand-icon">
            <NoctLogo size={40} />
          </span>
          noctgram<span className="alpha">α</span>
        </button>
        <nav aria-label="Главное меню">
          {[
            ['feed', 'Лента', Home],
            ['search', 'Поиск', Search],
            ['messages', 'Сообщения', Mail],
            ['channels', 'Каналы', Megaphone],
            ['profile', 'Профиль', UserRound],
          ].map(([id, label, Icon]) => {
            const NavIcon = Icon as typeof Home;
            const active = page === id || (id === 'profile' && page === 'saved');
            return (
              <button
                key={String(id)}
                className={active ? 'active' : ''}
                aria-label={String(label)}
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(String(id))}
              >
                <NavIcon size={21} />
                <span>{String(label)}</span>
                {id === 'messages' && unread > 0 && (
                  <span className="nav-unread">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
                {active && <i />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="premium-nav-shell">
            <span className="premium-nav-beam" aria-hidden="true" />
            <button
              className="premium-nav"
              onClick={() => navigate('premium')}
              aria-label="Открыть Noct Premium"
              aria-current={page === 'premium' ? 'page' : undefined}
            >
              <PremiumIcon size={23} />
              <span>Noct Premium</span>
              <span className="badge">{me?.premium ? 'активен' : 'новое'}</span>
            </button>
          </div>
          <div className="premium-nav-shell stars-nav-shell">
            <span className="premium-nav-beam" aria-hidden="true" />
            <button
              className="premium-nav"
              aria-label="Открыть Noct Stars"
              onClick={() => navigate('stars')}
            >
              <StarsIcon size={23} />
              <span>Noct Stars</span>
              <span className="badge">тест</span>
            </button>
          </div>
          {me ? (
            <>
              <button className="account" onClick={() => navigate('profile')}>
                <Avatar person={me} />
                <span>
                  <strong>
                    <DisplayName person={me} />
                  </strong>
                  <small>@{me.handle}</small>
                </span>
              </button>
              <SignOutButton className="logout">
                <LogOut size={17} />
                <span>Выйти</span>
              </SignOutButton>
            </>
          ) : (
            <a className="logout" href="/login" target="_top">
              <LogOut size={17} />
              <span>Войти</span>
            </a>
          )}
        </div>
      </aside>
      <main
        className={
          'main-column ' +
          (page === 'messages'
            ? 'messages-main'
            : ['premium', 'stars'].includes(page)
              ? 'premium-main'
              : '')
        }
      >
        <header className="page-header">
          <h1>
            {page === 'moderation'
              ? 'Модерация'
              : page === 'profile'
                ? profile?.name || 'Профиль'
                : page === 'channels'
                  ? 'Каналы'
                  : page === 'stars'
                    ? 'Noct Stars'
                    : page === 'messages'
                      ? 'Сообщения'
                      : page === 'search'
                        ? 'Поиск'
                        : page === 'premium'
                          ? 'Noct Premium'
                          : page === 'saved'
                            ? 'Сохранённое'
                            : 'Noctgram'}
          </h1>
          <span className="grow" />
          {me?.canModerate && (
            <button
              className="icon-button"
              title="Модерация"
              aria-label="Открыть модерацию"
              onClick={() => navigate('moderation')}
            >
              <ShieldCheck size={20} />
            </button>
          )}
          <button
            className="icon-button header-stars"
            onClick={() => navigate('stars')}
            aria-label="Открыть Noct Stars"
          >
            <StarsIcon size={25} />
          </button>
          {me && (
            <NotificationsBell
              me={me.id}
              onPost={(id) => {
                void request<Post>('?action=post&id=' + encodeURIComponent(id))
                  .then((p) => {
                    setCommentPost(p);
                    setModal('comments');
                  })
                  .catch((e) => notify(e.message));
              }}
              onChat={(id) => {
                void request<Profile>(
                  '?action=profile&id=' + encodeURIComponent(id),
                )
                  .then(openChat)
                  .catch((e) => notify(e.message));
              }}
            />
          )}
          {loading && page !== 'premium' && page !== 'messages' && (
            <LoaderCircle className="spin" size={15} />
          )}
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
              if (me && page === 'messages') {
                void loadThreads().catch((e) => notify(e.message));
                void loadMessages().catch((e) => notify(e.message));
              } else if (me) void refresh();
              else void bootstrap();
            }}
          >
            <RefreshCw size={18} />
          </button>
        </header>
        {page === 'saved' && (
          <button
            type="button"
            className="text-button saved-back"
            onClick={() => navigate('profile')}
          >
            <ArrowLeft size={17} aria-hidden="true" /> В профиль
          </button>
        )}
        {loadError && (
          <div className="error-banner" role="alert">
            Не удалось загрузить данные.{' '}
            <button onClick={() => void (me ? refresh() : bootstrap())}>
              Повторить
            </button>
          </div>
        )}
        {readOnly && me && <ReadOnlyNotice me={me} onUpdate={updateAccount} />}
        {page === 'profile' &&
          profile?.kind === 'channel' &&
          profile.restriction &&
          (profile.ownerId === me?.id || profile.canPublish) && (
            <section className="account-readonly channel-restriction-notice">
              <div>
                <strong>
                  {profile.restriction.mode === 'blocked'
                    ? 'Канал заблокирован'
                    : 'Канал в режиме только чтения'}
                </strong>
                <p>{profile.restriction.reason}</p>
                <small>
                  {profile.restriction.expiresAt
                    ? 'До ' +
                      new Date(profile.restriction.expiresAt).toLocaleString(
                        'ru-RU',
                      )
                    : 'До снятия ограничения'}
                  . Ограничение действует на этот канал.
                </small>
              </div>
            </section>
          )}
        {page === 'moderation' && me?.canModerate && (
          <ModerationPanel
            onChanged={() => {
              void refreshAccount();
            }}
          />
        )}
        {page === 'profile' && profile?.blocked && (
          <SuspendedProfile profile={profile} onBack={() => navigate('feed')} />
        )}
        {page === 'feed' && (
          <>
            <div
              className="feed-tabs"
              data-selected={mode === 'following' ? 1 : 0}
            >
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
                <a href="/login" target="_top" className="primary">
                  Войти <ArrowUpRight size={14} />
                </a>
              </div>
            )}
            {me && <StoriesBar me={me} readOnly={readOnly} />}
            {composer}
            {me && !readOnly && (
              <ChannelTools profile={me} revision={scheduleVersion} />
            )}
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
        {page === 'profile' && profile && !profile.blocked && (
          <>
            <section
              style={profile.premium ? appearanceStyle(profile) : undefined}
              data-premium={!!profile.premium}
              className={
                'profile-card ' +
                (profile.kind === 'channel' ? 'channel-profile' : '')
              }
            >
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
                {profileEditable && (
                  <button
                    className="cover-edit"
                    disabled={readOnly || channelRestricted}
                    aria-label="Изменить обложку"
                    onClick={() => edit()}
                  >
                    <Camera size={17} />
                  </button>
                )}
                {!profile.cover && <span className="cover-monogram">n.</span>}
              </div>
              <div className="profile-info">
                <div className="profile-avatar-line">
                  <ProfileAvatar person={profile} size={96} />
                  <span className="grow" />
                  {profileEditable ? (
                    <>
                      <button
                        className="secondary"
                        disabled={
                          channelRestricted ||
                          (readOnly && profile?.id !== me?.id)
                        }
                        onClick={() => edit()}
                      >
                        Редактировать
                      </button>
                      <button
                        className="icon-button cosmetic"
                        aria-label="Оформление профиля"
                        onClick={() =>
                          profile.id === me?.id
                            ? edit('design')
                            : navigate('premium')
                        }
                      >
                        <PremiumIcon size={21} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="primary"
                        disabled={readOnly || busy}
                        onClick={() => follow(profile)}
                      >
                        {profile.followed ? 'Вы подписаны' : 'Подписаться'}
                      </button>
                      {profile.id !== 'noctgram' &&
                        profile.kind !== 'channel' && (
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
                  <DisplayName person={profile} />
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
                {profile.kind === 'channel' && (
                  <span className="channel-profile-label">
                    <Megaphone size={13} />
                    Канал
                  </span>
                )}
                {!!profile.lastSeen && (
                  <div
                    className={'profile-presence ' + (online ? 'online' : '')}
                  >
                    <i />
                    {online
                      ? 'В сети'
                      : 'Был(а) ' +
                        new Date(profile.lastSeen).toLocaleString('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                  </div>
                )}
                <div className="profile-aliases">
                  {profile.handles.some((h) => h !== profile.handle) && (
                    <>
                      <span className="aliases-prefix">а также</span>
                      {profile.handles
                        .filter((h) => h !== profile.handle)
                        .map((h, i) => (
                          <span className="profile-alias" key={h}>
                            {i > 0 && <span className="alias-comma">, </span>}
                            <button
                              title={'Скопировать @' + h}
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText('@' + h)
                                  .then(() => notify('Юзернейм скопирован'))
                                  .catch(() => notify('@' + h))
                              }
                            >
                              @{h}
                            </button>
                          </span>
                        ))}
                    </>
                  )}
                </div>
                <p className="bio">
                  {profile.bio ||
                    (profile.id === me?.id
                      ? 'Расскажи о себе — пусть свои тебя узнают.'
                      : 'Пока без описания.')}
                </p>
                <div className="profile-details">
                  <CalendarDays size={14} /> В Noctgram с{' '}
                  {new Date(profile.created).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </div>
                <div className="profile-stats">
                  <button
                    type="button"
                    className="profile-stat-button"
                    aria-haspopup="dialog"
                    aria-label={'Показать подписчиков: ' + profile.followers}
                    onClick={() => {
                      setConnectionsProfile(profile);
                      setModal('followers');
                    }}
                  >
                    <strong>{profile.followers.toLocaleString('ru-RU')}</strong>{' '}
                    подписчиков
                  </button>
                  <button
                    type="button"
                    className="profile-stat-button"
                    aria-haspopup="dialog"
                    aria-label={'Показать подписки: ' + profile.following}
                    onClick={() => {
                      setConnectionsProfile(profile);
                      setModal('following');
                    }}
                  >
                    <strong>{profile.following.toLocaleString('ru-RU')}</strong>{' '}
                    подписок
                  </button>
                  <span>
                    <strong>{profile.postCount.toLocaleString('ru-RU')}</strong>{' '}
                    публикаций
                  </span>
                </div>
                {profile.id === me?.id && (
                  <button
                    type="button"
                    className="profile-saved-link"
                    onClick={() => navigate('saved')}
                  >
                    <Bookmark size={19} aria-hidden="true" />
                    <span>Сохранённое</span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                )}
              </div>
            </section>
            <div
              className="feed-tabs profile-tabs"
              data-selected={profileTab === 'media' ? 1 : 0}
            >
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
            {profilePublisher && !readOnly && !channelRestricted && (
              <ChannelTools
                key={profile.id}
                profile={profile}
                revision={scheduleVersion}
              />
            )}
            {profilePublisher &&
              !readOnly &&
              !channelRestricted &&
              profileTab === 'posts' &&
              composer}
          </>
        )}
        {page === 'stars' && me && (
          <StarsPanel me={me} onBack={() => setPage(starsReturn.current)} />
        )}
        {page === 'channels' && me && (
          <ChannelsPanel
            me={me}
            readOnly={readOnly}
            onOpen={(id) => void openProfile(id)}
          />
        )}
        {page === 'premium' && (
          <PremiumPanel
            me={me}
            onBack={() => setPage(premiumReturn.current)}
            onUpdate={applyAppearance}
            onDesign={() => {
              if (auth()) edit('design', true);
            }}
          />
        )}
        {!['messages', 'premium', 'stars', 'channels', 'moderation'].includes(
          page,
        ) &&
          !(page === 'profile' && profile?.blocked) && (
            <>
              {loading && !posts.length ? (
                <>
                  <PostSkeleton />
                  <PostSkeleton />
                </>
              ) : (
                cards(shownPosts)
              )}
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
                    void refresh(
                      true,
                      posts[posts.length - 1]?.created,
                      posts[posts.length - 1]?.id,
                    )
                  }
                >
                  Загрузить ещё
                </button>
              )}
              <div className="feed-end">
                <Moon size={13} />
                {loading
                  ? 'Загружаем публикации…'
                  : 'Ты на одной волне с ночью'}
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
                    <strong>
                      <DisplayName person={t} />
                    </strong>
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
                        <strong>
                          <DisplayName person={peer} />
                        </strong>
                        <small>@{peer.handle}</small>
                      </span>
                    </button>
                    <button
                      className="icon-button call-button"
                      aria-label="Аудиозвонок"
                      title="Аудиозвонок"
                      disabled={
                        readOnly || audioCalls.active || !messageAccess?.allowed
                      }
                      onClick={() => void audioCalls.start(peer)}
                    >
                      <Phone size={18} />
                    </button>
                    <button
                      className="chat-block icon-button"
                      disabled={busy || !messageAccess}
                      aria-label={
                        messageAccess?.blockedByMe
                          ? 'Разблокировать собеседника'
                          : 'Заблокировать собеседника'
                      }
                      title={
                        messageAccess?.blockedByMe
                          ? 'Разблокировать собеседника'
                          : 'Заблокировать собеседника'
                      }
                      onClick={() =>
                        void run(async () => {
                          await request('', {
                            action: 'blockUser',
                            id: peer.id,
                            value: !messageAccess?.blockedByMe,
                          });
                          await loadMessages();
                          setPrivacyVersion((v) => v + 1);
                          notify(
                            messageAccess?.blockedByMe
                              ? 'Собеседник разблокирован'
                              : 'Собеседник добавлен в чёрный список',
                          );
                        })
                      }
                    >
                      <Ban size={17} />
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
                          {m.sender !== me?.id && (
                            <button
                              className="message-report"
                              aria-label="Пожаловаться на сообщение"
                              title="Пожаловаться на сообщение"
                              onClick={() => {
                                setReportedMessage(m);
                                setModal('reportMessage');
                              }}
                            >
                              <Flag size={13} />
                            </button>
                          )}
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
                  {!messageAccess?.allowed && (
                    <p className="message-privacy-note">
                      {!messageAccess
                        ? 'Проверяем доступ к сообщениям…'
                        : messageAccess.blockedByMe
                          ? 'Собеседник в чёрном списке. История переписки сохранена.'
                          : 'Отправка сообщений недоступна из-за настроек приватности.'}
                    </p>
                  )}
                  <form
                    className="message-composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (
                        !messageText.trim() ||
                        busy ||
                        !messageAccess?.allowed ||
                        !writable()
                      )
                        return;
                      void run(async () => {
                        await request('', {
                          action: 'message',
                          id: peer.id,
                          text: messageText,
                        });
                        if (activePeer.current === peer.id) setMessageText('');
                        await loadMessages();
                        await loadThreads();
                      });
                    }}
                  >
                    <textarea
                      disabled={busy || readOnly || !messageAccess?.allowed}
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
                      disabled={
                        busy ||
                        readOnly ||
                        !messageAccess?.allowed ||
                        !messageText.trim()
                      }
                    >
                      <Send size={18} />
                    </button>
                  </form>
                </>
              ) : (
                <div className="chat-empty">
                  <NoctMascot size={144} />
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
            </div>
            {!topics.length && (
              <p className="topics-empty">
                Темы появятся, когда в публикациях будут хэштеги.
              </p>
            )}
            {topics.map(({ tag, count }) => (
              <button
                className="topic"
                key={tag}
                onClick={() => {
                  setPage('search');
                  setQuery(tag);
                }}
              >
                <strong>{tag}</strong>
                <span>
                  {count}{' '}
                  {count % 10 === 1 && count % 100 !== 11
                    ? 'публикация'
                    : count % 10 >= 2 &&
                        count % 10 <= 4 &&
                        (count % 100 < 12 || count % 100 > 14)
                      ? 'публикации'
                      : 'публикаций'}
                </span>
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
                    <strong>
                      <DisplayName person={person} />
                    </strong>
                    <small>@{person.handle}</small>
                  </span>
                </button>
                <button
                  className="follow-small"
                  disabled={busy || readOnly}
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
          <div className="aside-footer">
            <span>noctgram</span>
            <span>alpha / 2026</span>
            <p>Меньше шума. Больше своего.</p>
          </div>
        </aside>
      )}
      <Dialog
        open={modalOpen}
        onOpenChangeComplete={(open) => {
          if (!open && !modalOpen) setModalContent('');
        }}
        onOpenChange={(open) => {
          if (!open && !uploading) setModal('');
        }}
      >
        <DialogContent
          className={
            'noct-dialog ' +
            (modal === 'comments'
              ? 'comments-dialog'
              : modal === 'followers' || modal === 'following'
                ? 'connections-dialog'
                : '')
          }
        >
          <DialogTitle>
            {(
              {
                signin: 'Войти в Noctgram',
                premium: 'Noct Premium',
                edit: 'Редактировать профиль',
                support: 'Поддержать автора',
                comments: 'Комментарии',
                people: 'Найти своих',
                report: 'Пожаловаться',
                reportMessage: 'Жалоба на сообщение',
                moderateContent: 'Удалить публикацию',
                followers: 'Подписчики',
                following: 'Подписки',
              } as Record<string, string>
            )[modal] || 'Noctgram'}
          </DialogTitle>
          <DialogDescription>
            {
              (
                {
                  signin: 'Публикуй, общайся и сохраняй важное.',
                  premium: 'Больше способов быть собой. В разработке.',
                  edit: 'Профиль и твоё личное пространство.',
                  reportMessage:
                    'Модератор получит только это сообщение и причину жалобы.',
                  support: 'Благодарность за публикацию в Noct Stars.',
                  comments: 'Каждая мысль может стать началом разговора.',
                  people: 'Поиск по имени или @юзернейму.',
                  moderateContent:
                    'Укажи причину удаления. Решение будет записано в историю модерации.',
                  followers: connectionsProfile
                    ? '@' + connectionsProfile.handle
                    : '',
                  following: connectionsProfile
                    ? '@' + connectionsProfile.handle
                    : '',
                  report:
                    'Укажи причину — она будет сохранена вместе с публикацией.',
                } as Record<string, string>
              )[modal]
            }
          </DialogDescription>
          {modal === 'signin' && (
            <a className="primary sign-in-link" href="/login" target="_top">
              Войти по почте <ArrowUpRight size={15} />
            </a>
          )}
          {modal === 'edit' && editId === me?.id && (
            <div className="edit-tabs" aria-label="Раздел редактирования">
              <button
                aria-pressed={editTab === 'profile'}
                disabled={uploading || busy}
                onClick={() => setEditTab('profile')}
              >
                Профиль
              </button>
              <button
                aria-pressed={editTab === 'design'}
                disabled={uploading || busy}
                onClick={() => setEditTab('design')}
              >
                Дизайн
              </button>
              <button
                aria-pressed={editTab === 'privacy'}
                disabled={uploading || busy}
                onClick={() => setEditTab('privacy')}
              >
                Приватность
              </button>
            </div>
          )}
          {modal === 'edit' && me && editId === me.id && (
            <div hidden={editTab !== 'design'}>
              <ProfileDesign
                me={me}
                disabled={readOnly}
                onBusy={setUploading}
                onSaved={(updated) => {
                  applyAppearance(updated);
                  setEditAvatar(updated.avatar);
                  setModal('');
                  notify('Оформление сохранено');
                }}
                onPremium={() => {
                  setModal('');
                  navigate('premium');
                }}
              />
            </div>
          )}
          {modal === 'edit' && editTab === 'privacy' && editId === me?.id && (
            <PrivacyPanel
              onChanged={() => {
                setPrivacyVersion((v) => v + 1);
                void latestRefresh.current();
                void loadThreads().catch(() => {});
                if (peer) void loadMessages().catch(() => {});
              }}
            />
          )}
          {modal === 'reportMessage' && reportedMessage && (
            <ContentDecisionForm
              key={reportedMessage.id}
              id={reportedMessage.id}
              type="message"
              action="report"
              text={reportedMessage.text}
              onCancel={() => setModal('')}
              onDone={() => {
                setModal('');
                notify('Жалоба отправлена модератору');
              }}
            />
          )}
          {modal === 'edit' && editTab === 'profile' && (
            <form
              className="edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                saveProfile();
              }}
            >
              <fieldset
                className="edit-fields"
                disabled={busy || uploading || readOnly}
              >
                {editId === me?.id && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => window.location.assign('/login?link=1')}
                  >
                    <Mail size={15} /> Почта для входа
                  </button>
                )}
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
                      accept="image/jpeg,image/png,image/webp"
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
                <fieldset
                  className="edit-usernames"
                  disabled={editId !== me?.id && !profileOwned}
                >
                  <h3>Юзернеймы</h3>
                  <label>
                    Основной юзернейм
                    <input
                      required
                      value={editHandle}
                      maxLength={25}
                      onChange={(e) => setEditHandle(e.target.value)}
                      placeholder="@username"
                    />
                  </label>
                  <p className="meta">
                    По этому имени тебя находят в Noctgram.
                  </p>
                  <span className="field-label">Под-юзернеймы</span>
                  {editAliases.map((h, i) => (
                    <div className="row" key={i}>
                      <input
                        aria-label={'Под-юзернейм ' + (i + 1)}
                        value={h}
                        maxLength={25}
                        placeholder="@another_name"
                        onChange={(e) =>
                          setEditAliases((rows) =>
                            rows.map((v, n) => (n === i ? e.target.value : v)),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label={'Удалить под-юзернейм ' + (i + 1)}
                        onClick={() =>
                          setEditAliases((rows) =>
                            rows.filter((_, n) => n !== i),
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  {editAliases.length < 4 && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setEditAliases((rows) => [...rows, ''])}
                    >
                      <Plus size={14} />
                      Добавить под-юзернейм
                    </button>
                  )}
                  <span className="meta">
                    До 4 дополнительных имён. 4–24 латинские буквы, цифры или _.
                  </span>
                </fieldset>
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
              </fieldset>
            </form>
          )}
          {modal === 'support' && supportPost && (
            <SupportPanel
              key={supportPost.id}
              post={supportPost}
              onDone={(amount) => {
                setModal('');
                void refreshPost(supportPost.id);
                notify(
                  'Автор получил ' + amount.toLocaleString('ru-RU') + ' звёзд',
                );
              }}
            />
          )}
          {modal === 'comments' && commentPost && me && (
            <CommentsPanel
              key={commentPost.id}
              post={commentPost}
              me={me}
              readOnly={readOnly}
              onChanged={() => void refreshPost(commentPost.id)}
            />
          )}
          {modal === 'report' && reportPost && (
            <form
              className="edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await request('', {
                    action: 'report',
                    id: reportPost.id,
                    reason: reportReason,
                  });
                  setModal('');
                  notify('Жалоба сохранена');
                });
              }}
            >
              <label>
                Что не так с публикацией?
                <textarea
                  required
                  maxLength={500}
                  disabled={busy}
                  rows={4}
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  placeholder="Опиши причину жалобы"
                />
              </label>
              <button
                className="primary"
                disabled={busy || !reportReason.trim()}
              >
                Отправить жалобу
              </button>
            </form>
          )}
          {modal === 'moderateContent' && reportPost && me?.canModerate && (
            <ContentDecisionForm
              key={reportPost.id}
              id={reportPost.id}
              type="post"
              action="remove"
              text={reportPost.text}
              onCancel={() => setModal('')}
              onDone={() => {
                setPosts((old) => old.filter((p) => p.id !== reportPost.id));
                setModal('');
                notify('Публикация удалена. Решение сохранено.');
                if (profile?.id === reportPost.userId)
                  void request<Profile>(
                    '?action=profile&id=' + encodeURIComponent(profile.id),
                  )
                    .then(setProfile)
                    .catch(() => {});
              }}
            />
          )}
          {(modal === 'followers' || modal === 'following') &&
            connectionsProfile && (
              <ConnectionsPanel
                key={connectionsProfile.id + ':' + modal}
                profileId={connectionsProfile.id}
                kind={modal}
                busy={busy}
                onProfile={(id) => {
                  setModal('');
                  void openProfile(id);
                }}
              />
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
                        <strong>
                          <DisplayName person={p} />
                        </strong>
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
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onOpenChangeComplete={(open) => {
          if (!open && !lightboxOpen) setLightbox(null);
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
                  await latestRefresh.current();
                  const p = await request<Profile>('?action=profile');
                  setMe(p);
                  setProfile((current) => (current?.id === p.id ? p : current));
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
        <output
          className={'toast ' + (toastLeaving ? 'leaving' : '')}
          aria-live="polite"
        >
          <span>{notice}</span>
          {undoHidden && (
            <button
              className="toast-undo"
              onClick={() =>
                void run(async () => {
                  await request('', {
                    action: 'hide',
                    id: undoHidden.id,
                    value: false,
                  });
                  setUndoHidden(null);
                  setNotice('');
                  await latestRefresh.current();
                })
              }
            >
              Отменить
            </button>
          )}
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
