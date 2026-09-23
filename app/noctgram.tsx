'use client';
import { EmojiPicker, EmojiPreview } from './premium-emoji';
import { emojiFallback } from '@/lib/premium-emoji';
import { ArchiveRow, ArchiveFolderButton } from './chat-archive';
import {
  ChatCreateMenu,
  CreateGroupDialog,
  SelectSecretPeerDialog,
} from './chat-create-menu';

import { useRoomList, RoomThreadRow, PublicRoomSearch } from './room-list';
import { roomAction, type RoomTarget } from '@/lib/rooms-client';
import type { RoomDetail } from '@/lib/rooms-types';
import { ensureKey } from '@/lib/secret-crypto';

import { AccountSwitcher } from './account-switcher';
import type { SettingsSection } from './settings-panel';
import { ProfileRecognitions } from './profile-recognitions';

/* Auth routes require top-level links; private R2 images must keep session cookies.
   Async subscription effects intentionally set loading state; no React compiler is enabled. */
/* eslint-disable next/no-img-element, next/no-html-link-for-pages, react/react-compiler */
import { StoriesBar } from './stories-bar';
import { PhotoViewer } from './photo-viewer';
import { reconcileSnapshot } from '@/lib/reconcile-snapshot';
import { createFeedSnapshots, feedKey, sameSearch } from '@/lib/feed-snapshots';
import { createChatSnapshots, type ChatSnapshot } from '@/lib/chat-snapshots';
import { createPageTransition } from '@/lib/page-transition';
import { createChatSwipeBack } from '@/lib/chat-swipe-back';
import { createProfileCoverCache } from '@/lib/profile-cover-cache';
import { createLatestRequests } from '@/lib/optimistic';
import { flushSync } from 'react-dom';

import { NotificationsBell } from './notifications';
import { useAudioCalls } from './audio-calls';
import { Phone } from 'lucide-react';

import { MusicAccountGuard } from './music-provider';
import { MusicActivityStatus } from './music-activity';
import { Settings } from 'lucide-react';
import { Ban, Store } from 'lucide-react';
import { formatMarketNumber } from '@/lib/market-policy';
import { LIQUID_COVER, coverImage } from '@/lib/profile-cover';
import { LiquidCover } from './liquid-cover';
import {
  type CSSProperties,
  type ComponentProps,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createAppHistory,
  appRouteFromURL,
  appRouteHref,
  type AppRoute,
  type PreparedRoute,
} from '@/lib/app-history';
import { AppLink } from './app-link';
import { MainNavigation } from './main-navigation';
import { SITE_DESCRIPTION } from '@/lib/site-metadata';
import { profileHandleLimit } from '@/lib/channel-limits';
import {
  Moon,
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
  ArrowLeft,
  Pencil,
  Camera,
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

import { ContentDecisionForm } from './content-decision-form';

import { ProfileSurface } from './profile-surface';
import { EditorPane } from './editor-pane';
import { DisplayName, ProfileAvatar } from './profile-identity';

import { PremiumIcon } from './premium-icon';
import { NavBorderBeam } from './nav-border-beam';
import { StarsIcon, NoctLogo } from './stars-icon';

import { SendGiftButton, ProfileGifts } from './gifts';
import { ChatThemeMenu } from './chat-theme-menu';

import {
  chatTheme,
  DEFAULT_CHAT_THEME,
  type ChatThemeState,
} from '@/lib/chat-themes';
import { ChatEmojiText } from './chat-emoji-text';
import { MentionText } from './profile-link';
import {
  ProfileMeta,
  ProfileChannels,
  ProfileDetailsFields,
  detailsDraft,
  type ProfileDetailsDraft,
} from './profile-details';
import { PROFILE_NAVIGATE, type ProfileNavigation } from '@/lib/profile-links';
import { resolveMention } from '@/lib/mention-navigation';
import { NoctMascot } from './noct-mascot';

import {
  BlockedAccount,
  ReadOnlyNotice,
  SuspendedProfile,
} from './account-states';

import { SignOutButton } from './sign-out-button';
import {
  request,
  upload,
  type Person,
  type Profile,
  type Media,
  type Post,
  type Message,
} from '@/lib/client';

import { deferredPanel } from './deferred-panel';
const AccountPanel = deferredPanel<object>(() =>
  import('./account-panel').then((m) => ({ default: m.AccountPanel })),
);
const SettingsPanel = deferredPanel<
  ComponentProps<typeof import('./settings-panel').SettingsPanel>
>(() => import('./settings-panel').then((m) => ({ default: m.SettingsPanel })));
const ChannelBoosts = deferredPanel<
  ComponentProps<typeof import('./channel-boosts').ChannelBoosts>
>(() => import('./channel-boosts').then((m) => ({ default: m.ChannelBoosts })));
const ChannelTools = deferredPanel<
  ComponentProps<typeof import('./channel-tools').ChannelTools>
>(() => import('./channel-tools').then((m) => ({ default: m.ChannelTools })));
const PrivacyPanel = deferredPanel<
  ComponentProps<typeof import('./privacy-panel').PrivacyPanel>
>(() => import('./privacy-panel').then((m) => ({ default: m.PrivacyPanel })));
const MusicPanel = deferredPanel<
  ComponentProps<typeof import('./music-panel').MusicPanel>
>(() => import('./music-panel').then((m) => ({ default: m.MusicPanel })));
const MusicServices = deferredPanel<
  ComponentProps<typeof import('./music-services').MusicServices>
>(() => import('./music-services').then((m) => ({ default: m.MusicServices })));
const CommentsPanel = deferredPanel<
  ComponentProps<typeof import('./comments-panel').CommentsPanel>
>(() => import('./comments-panel').then((m) => ({ default: m.CommentsPanel })));
const ProfileDesign = deferredPanel<
  ComponentProps<typeof import('./profile-design').ProfileDesign>
>(() => import('./profile-design').then((m) => ({ default: m.ProfileDesign })));
const PremiumPanel = deferredPanel<
  ComponentProps<typeof import('./premium-panel').PremiumPanel>
>(() => import('./premium-panel').then((m) => ({ default: m.PremiumPanel })));
const StarsPanel = deferredPanel<
  ComponentProps<typeof import('./stars-panel').StarsPanel>
>(() => import('./stars-panel').then((m) => ({ default: m.StarsPanel })));
const SupportPanel = deferredPanel<
  ComponentProps<typeof import('./stars-panel').SupportPanel>
>(() => import('./stars-panel').then((m) => ({ default: m.SupportPanel })));
const ChatConversation = deferredPanel<
  ComponentProps<typeof import('./chat-conversation').ChatConversation>
>(() =>
  import('./chat-conversation').then((m) => ({ default: m.ChatConversation })),
);
const ChatPeerProfile = deferredPanel<
  ComponentProps<typeof import('./chat-peer-profile').ChatPeerProfile>
>(() =>
  import('./chat-peer-profile').then((m) => ({ default: m.ChatPeerProfile })),
);
const ChannelsPanel = deferredPanel<
  ComponentProps<typeof import('./channels-panel').ChannelsPanel>
>(() => import('./channels-panel').then((m) => ({ default: m.ChannelsPanel })));
const ConnectionsPanel = deferredPanel<
  ComponentProps<typeof import('./connections-panel').ConnectionsPanel>
>(() =>
  import('./connections-panel').then((m) => ({ default: m.ConnectionsPanel })),
);
const ModerationPanel = deferredPanel<
  ComponentProps<typeof import('./moderation-panel').ModerationPanel>
>(() =>
  import('./moderation-panel').then((m) => ({ default: m.ModerationPanel })),
);
const RoomConversation = deferredPanel<
  ComponentProps<typeof import('./room-conversation').RoomConversation>
>(() =>
  import('./room-conversation').then((m) => ({ default: m.RoomConversation })),
);

async function requestChatSnapshot(
  peer: string,
  focus = '',
): Promise<ChatSnapshot> {
  const [conversation, access] = await Promise.all([
    request<Pick<ChatSnapshot, 'messages' | 'theme'>>(
      '?' +
        new URLSearchParams({
          action: 'messages',
          includeTheme: '1',
          peer,
          focus,
        }),
    ),
    request<ChatSnapshot['access']>(
      '?action=messageAccess&peer=' + encodeURIComponent(peer),
    ),
  ]);
  return { ...conversation, access };
}

// Navigation waits this briefly for data, then shows the page's loading state.
function waitBriefly<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 150)),
  ]);
}

export default function Noctgram({
  initialPage = 'feed',
}: {
  initialPage?: 'feed' | 'music' | 'music-services';
}) {
  const [page, setPageState] = useState<string>(initialPage),
    [me, setMe] = useState<Profile | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [people, setPeople] = useState<Person[]>([]),
    [posts, setPosts] = useState<Post[]>([]),
    [mode, setMode] = useState('all'),
    [profileTab, setProfileTab] = useState('posts'),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(''),
    [noticeVersion, setNoticeVersion] = useState(0),
    [loadError, setLoadError] = useState(''),
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
  const [routeReady, setRouteReady] = useState(false),
    [routeError, setRouteError] = useState('');
  const startupComplete = useRef(false);
  useEffect(() => {
    setPageState(initialPage);
  }, [initialPage]);
  const [publishError, setPublishError] = useState('');
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
  const [boostOpen, setBoostOpen] = useState<{
    id: string;
    revision: number;
    open: boolean;
  } | null>(null);
  const pendingBoostOpen = useRef<string | null>(null);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>('profile');
  const [editTab, setEditTab] = useState<
      'profile' | 'privacy' | 'design' | 'account'
    >('profile'),
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
  const [editDetails, setEditDetails] = useState<ProfileDetailsDraft | null>(
    null,
  );
  const [chatFolder, setChatFolder] = useState<'active' | 'archive'>('active');
  const [threads, setThreads] = useState<Person[]>([]),
    [threadUnread, setThreadUnread] = useState(0),
    [peer, setPeer] = useState<Person | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [messageText, setMessageText] = useState(''),
    [peopleQuery, setPeopleQuery] = useState(''),
    [found, setFound] = useState<Person[]>([]);
  const [roomTarget, setRoomTarget] = useState<RoomTarget | null>(null);
  const [roomCreation, setRoomCreation] = useState('');
  const [creationOwner, setCreationOwner] = useState('');
  const roomAttempt = useRef<{
    owner: string;
    key: string;
    body: Record<string, unknown>;
  } | null>(null);
  const beginRoomCreation = (kind: string) => {
    if (!me) return;
    roomAttempt.current = null;
    setCreationOwner(me.id);
    setFound([]);
    setPeopleError('');
    setPeopleQuery('');
    setRoomCreation(kind);
  };
  const createRoomWithRetry = async (body: Record<string, unknown>) => {
    if (!me) throw new Error('Войдите в аккаунт');
    if (!roomAttempt.current || roomAttempt.current.owner !== me.id)
      roomAttempt.current = { owner: me.id, key: crypto.randomUUID(), body };
    const attempt = roomAttempt.current;
    try {
      return await roomAction<RoomDetail>({
        ...attempt.body,
        actor: attempt.owner,
        key: attempt.key,
      });
    } catch (error) {
      const status = Number((error as { status?: number }).status);
      if (status >= 400 && status < 500 && roomAttempt.current === attempt)
        roomAttempt.current = null;
      throw error;
    }
  };
  const [peopleLoading, setPeopleLoading] = useState(false),
    [peopleError, setPeopleError] = useState(''),
    [peopleRetry, setPeopleRetry] = useState(0);
  const roomOwner = useRef(me?.id);
  roomOwner.current = me?.id;
  const roomList = useRoomList(
    me?.restriction?.mode === 'blocked' ? '' : me?.id || '',
    page === 'messages',
  );
  const openRoom = useCallback((id: string) => {
    void appHistory.current?.navigate({ page: 'messages', roomId: id });
  }, []);
  const resolveRoomLink = useCallback((id: string) => {
    void appHistory.current?.navigate(
      { page: 'messages', roomId: id },
      { replace: true },
    );
  }, []);
  const openPublicGroup = useCallback((group: string) => {
    void appHistory.current?.navigate({ page: 'messages', group });
  }, []);
  const backFromRoom = useCallback(() => {
    void appHistory.current?.navigate({ page: 'messages' });
  }, []);
  // On phones back (arrow or edge swipe) slides the chat off before clearing it.
  const chatSwipe = useRef<ReturnType<typeof createChatSwipeBack> | null>(null);
  const closeChat = useRef(() => {});
  closeChat.current = roomTarget
    ? backFromRoom
    : () => {
        appHistory.current?.cancelPending();
        setPeer(null);
      };
  const exitChat = useCallback(() => {
    if (chatSwipe.current) chatSwipe.current.exit();
    else closeChat.current();
  }, []);
  const messengerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const swipe = createChatSwipeBack(node, () => closeChat.current());
    chatSwipe.current = swipe;
    return () => {
      swipe.dispose();
      if (chatSwipe.current === swipe) chatSwipe.current = null;
    };
  }, []);
  const [chatAppearance, setChatAppearance] = useState<{
    viewer: string;
    peer: string;
    value: ChatThemeState;
  } | null>(null);
  const [musicTab, setMusicTab] = useState('playlists');
  const [postsKey, setPostsKey] = useState('');
  const snapshots = useRef(createFeedSnapshots());
  snapshots.current.reset(me?.id || '', privacyVersion);
  const publicationKey = feedKey(
    me?.id || '',
    page,
    mode,
    query,
    profile?.id,
    profileTab,
    privacyVersion,
  );
  const currentPosts = useRef({ key: postsKey, posts, hasMore });
  currentPosts.current = { key: postsKey, posts, hasMore };
  const cachedPublication = snapshots.current.get(publicationKey);
  const searchUpdating = sameSearch(postsKey, publicationKey);
  const displayPosts =
    !me || postsKey === publicationKey
      ? posts
      : (cachedPublication?.posts ?? (searchUpdating ? posts : []));
  const displayMore =
    postsKey === publicationKey
      ? hasMore
      : (cachedPublication?.hasMore ?? false);
  const publicationLoading =
    loading ||
    (!!me &&
      postsKey !== publicationKey &&
      !cachedPublication &&
      !searchUpdating &&
      !loadError);
  useEffect(() => {
    if (!loading && !loadError)
      snapshots.current.save({ key: postsKey, posts, hasMore });
  }, [postsKey, posts, hasMore, loading, loadError]);
  const readOnly = me?.restriction?.mode === 'read_only';
  const accountBlocked = me?.restriction?.mode === 'blocked';
  const coverImages = useRef(createProfileCoverCache());
  const [, setCoverRevision] = useState(0);
  const [openingProfile, setOpeningProfile] = useState('');
  // The own profile opened from its tab is a root view without a back arrow.
  const [profileRoot, setProfileRoot] = useState(false);
  coverImages.current.reset(
    accountBlocked || !me ? '' : me.id + ':' + privacyVersion,
  );
  useEffect(() => {
    const cover = coverImage(me?.cover);
    if (!cover || accountBlocked) return;
    let active = true;
    // A failed decode also re-renders so the cover falls back to its URL.
    void coverImages.current.prepare(cover).then(() => {
      if (active) setCoverRevision((value) => value + 1);
    });
    return () => {
      active = false;
    };
  }, [me?.id, me?.cover, accountBlocked, privacyVersion]);
  useEffect(() => {
    const cache = coverImages.current;
    return () => cache.clear();
  }, []);
  const chatSnapshots = useRef(createChatSnapshots());
  chatSnapshots.current.reset(accountBlocked ? '' : me?.id || '');
  const [openingChat, setOpeningChat] = useState('');
  const chatPreparation = useRef(0),
    preparedMessageLoad = useRef('');
  const audioCalls = useAudioCalls(me?.id, readOnly || accountBlocked);
  const fileRef = useRef<HTMLInputElement>(null),
    searchRef = useRef<HTMLInputElement>(null),
    draftRef = useRef<HTMLTextAreaElement>(null),
    messageFocus = useRef(''),
    requestVersion = useRef(0),
    messageVersion = useRef(0),
    activePeer = useRef(''),
    premiumReturn = useRef('feed'),
    starsReturn = useRef('feed'),
    actionLock = useRef(false),
    rootNavigation = useRef(false),
    rootTab = useRef('feed'),
    itemLocks = useRef(new Set<string>()),
    postRequests = useRef<ReturnType<typeof createLatestRequests> | null>(null);
  const appHistory = useRef<ReturnType<typeof createAppHistory> | null>(null);
  const pageTransition = useRef<ReturnType<typeof createPageTransition> | null>(
    null,
  );
  const currentPage = useRef(page);
  currentPage.current = page;
  const navigationCache = useRef({
    owner: '',
    profiles: new Map<string, Profile>(),
    peers: new Map<string, Person>(),
    drafts: new Map<string, string>(),
  });
  const setPage = useCallback((value: string) => {
    appHistory.current?.cancelPending();
    if (pageTransition.current)
      void pageTransition.current.run(currentPage.current, value, () =>
        setPageState(value),
      );
    else setPageState(value);
  }, []);
  const setModal = (next: string) => {
    if (next) setModalContent(next);
    setModalOpen(!!next);
  };
  const notify = useCallback((s: string, undo: Post | null = null) => {
    setToastLeaving(false);
    setUndoHidden(undo);
    setNotice(s);
    setNoticeVersion((v) => v + 1);
  }, []);
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
  // Without an item key the whole app waits (publishing, deletion, forms);
  // with one only repeated taps on that item are dropped.
  const run = async (fn: () => Promise<void>, item = '') => {
    if (item ? itemLocks.current.has(item) : actionLock.current) return;
    if (item) itemLocks.current.add(item);
    else {
      actionLock.current = true;
      setBusy(true);
    }
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      if (item) itemLocks.current.delete(item);
      else {
        actionLock.current = false;
        setBusy(false);
      }
    }
  };
  const bootstrapFeed = useRef('');
  const bootstrap = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const initial = appRouteFromURL(window.location.href, '');
    setPageState(initial.page);
    setMode(initial.mode || 'all');
    setProfileTab(initial.profileTab || 'posts');
    setMusicTab(initial.musicTab || 'playlists');
    setQuery(initial.query || '');
    // Fetch the selected section's code alongside the account, not after it.
    const panel =
      initial.page === 'music'
        ? MusicPanel
        : initial.page === 'music-services'
          ? MusicServices
          : initial.page === 'channels'
            ? ChannelsPanel
            : initial.page === 'premium'
              ? PremiumPanel
              : initial.page === 'stars'
                ? StarsPanel
                : initial.page === 'moderation'
                  ? ModerationPanel
                  : initial.page === 'messages'
                    ? initial.peerId
                      ? ChatConversation
                      : RoomConversation
                    : null;
    void panel?.preload().catch(() => {});
    const includeFeed = initial.page === 'feed';
    try {
      const r = await request<{ me: Profile; people: Person[]; posts: Post[] }>(
        '?' +
          new URLSearchParams({
            action: 'bootstrap',
            feed: includeFeed ? '1' : '0',
            mode: initial.mode || 'all',
          }),
      );
      bootstrapFeed.current = includeFeed
        ? feedKey(r.me.id, 'feed', initial.mode || 'all', '')
        : '';
      setMe(r.me);
      setProfile(r.me);
      setPeople(r.people);
      setPosts(includeFeed ? r.posts : []);
      setPostsKey(bootstrapFeed.current);
      setGuest(false);
    } catch (e) {
      if ((e as Error).message.startsWith('Войдите')) setGuest(true);
      else {
        notify((e as Error).message);
        setLoadError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  useEffect(() => {
    if (!notice) return;
    const fade = setTimeout(() => setToastLeaving(true), 4200);
    return () => clearTimeout(fade);
  }, [notice, noticeVersion]);
  // A new notice during the exit cancels the removal; the toast turns back
  // from wherever its transition is.
  useEffect(() => {
    if (!toastLeaving) return;
    const t = setTimeout(() => {
      setNotice('');
      setUndoHidden(null);
      setToastLeaving(false);
    }, 280);
    return () => clearTimeout(t);
  }, [toastLeaving]);
  const updateAccount = useCallback((next: Profile) => {
    setMe((current) => reconcileSnapshot(current, next));
    setProfile((current) =>
      current?.id === next.id ? reconcileSnapshot(current, next) : current,
    );
    if (next.restriction?.mode === 'blocked') {
      setRoomTarget(null);
      setRoomCreation('');
      setPosts([]);
      setThreads([]);
      setThreadUnread(0);
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
        (page === 'profile' && (profileTab === 'gifts' || !viewedId)) ||
        accountBlocked ||
        (page === 'profile' && profile?.blocked) ||
        [
          'premium',
          'stars',
          'channels',
          'messages',
          'moderation',
          'music',
          'music-services',
        ].includes(page)
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
          setPostsKey(publicationKey);
          setPosts((p) =>
            append
              ? [...p, ...r.filter((n) => !p.some((x) => x.id === n.id))]
              : reconcileSnapshot(p, r),
          );
          setHasMore(count === 30);
          setLoadError('');
        }
      } catch (e) {
        if (version === requestVersion.current) {
          notify((e as Error).message);
          setLoadError((e as Error).message);
          return false;
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
      notify,
      publicationKey,
    ],
  );
  const latestRefresh = useRef(refresh);
  useEffect(() => {
    latestRefresh.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!routeReady) return;
    const preparedFeed = bootstrapFeed.current;
    if (myId) bootstrapFeed.current = '';
    if (
      !myId ||
      accountBlocked ||
      (page === 'profile' && (profile?.blocked || !viewedId)) ||
      [
        'premium',
        'stars',
        'channels',
        'messages',
        'moderation',
        'music',
        'music-services',
      ].includes(page)
    )
      return;
    const cached = snapshots.current.get(publicationKey);
    const current = currentPosts.current;
    if (
      current.key !== publicationKey &&
      (cached || !sameSearch(current.key, publicationKey))
    ) {
      setPosts(cached?.posts || []);
      setHasMore(cached?.hasMore || false);
      setPostsKey(publicationKey);
    }
    setLoadError('');
    if (page === 'profile' && profileTab === 'gifts') {
      setLoading(false);
      return;
    }
    if (preparedFeed === publicationKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => void refresh(), query ? 250 : 0);
    const version = requestVersion;
    return () => {
      clearTimeout(t);
      version.current++;
    };
  }, [
    routeReady,
    myId,
    page,
    query,
    refresh,
    accountBlocked,
    profile?.blocked,
    viewedId,
    profileTab,
    publicationKey,
  ]);
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
    request<{ me: Profile; people: Person[] }>('?action=bootstrap&feed=0')
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
  }, [myId, privacyVersion, updateAccount, notify]);
  useEffect(() => {
    if (!myId) return;
    const params = new URLSearchParams(window.location.search);
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
  }, [myId, notify]);
  const refreshPost = async (id: string) => {
    try {
      const updated = await request<Post>(
        '?action=post&id=' + encodeURIComponent(id),
      );
      snapshots.current.update(updated);
      setPosts((rows) => rows.map((p) => (p.id === id ? updated : p)));
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const navigationHref = (page: string) =>
    appRouteHref({
      page,
      ...(page === 'profile' ? { profileId: me?.id, handle: me?.handle } : {}),
      ...(page === 'music' ? { musicTab } : {}),
      ...(page === 'feed' ? { mode } : {}),
    });
  // Resolves false when the section did not open (sign-in, no access, failure).
  const openSection = (v: string): boolean | Promise<boolean> => {
    if (
      ['profile', 'saved', 'messages', 'channels', 'stars'].includes(v) &&
      !auth()
    )
      return false;
    if (v === 'moderation' && !me?.canModerate) return false;
    if (v === 'premium' && page !== 'premium') premiumReturn.current = page;
    if (v === 'stars' && page !== 'stars') starsReturn.current = page;
    if (v === 'profile' && appHistory.current) {
      // Prepare reads this synchronously: the own profile opens as a root.
      rootNavigation.current = true;
      const opened = appHistory.current.navigate({
        page: 'profile',
        profileId: me!.id,
      });
      rootNavigation.current = false;
      return opened;
    }
    setQuery('');
    setPage(v);
    if (v === 'profile') {
      setProfile(me);
      setProfileTab('posts');
    }
    if (v === 'search') searchRef.current?.focus({ preventScroll: true });
    return true;
  };
  const navigate = (v: string) => {
    void openSection(v);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setPage('search');
        searchRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [setPage]);
  const threadsOwner = useRef(myId),
    threadsRevision = useRef(0);
  threadsOwner.current = accountBlocked ? undefined : myId;
  const loadThreads = useCallback(async () => {
    if (myId && !accountBlocked) {
      const revision = ++threadsRevision.current;
      const pages = await Promise.all(
        ['0', '1'].map((folder) =>
          request<Person[]>(
            '?action=threads&archived=' +
              folder +
              '&actor=' +
              encodeURIComponent(myId),
          ),
        ),
      );
      if (threadsOwner.current !== myId || revision !== threadsRevision.current)
        return;
      const next = [...new Map(pages.flat().map((t) => [t.id, t])).values()];
      setThreads((previous) => reconcileSnapshot(previous, next));
      setThreadUnread(
        next.reduce((sum, thread) => sum + (thread.unread || 0), 0),
      );
    }
  }, [myId, accountBlocked]);
  const applyChatSnapshot = useCallback(
    (id: string, snapshot: ChatSnapshot) => {
      setMessages((previous) => reconcileSnapshot(previous, snapshot.messages));
      setChatAppearance((previous) => {
        if (
          previous &&
          previous.viewer === myId &&
          previous.peer === id &&
          previous.value.revision > snapshot.theme.revision
        )
          return previous;
        return reconcileSnapshot(previous, {
          viewer: myId || '',
          peer: id,
          value: snapshot.theme,
        });
      });
      setMessageAccess((previous) =>
        reconcileSnapshot(previous, snapshot.access),
      );
    },
    [myId],
  );
  const loadMessages = useCallback(async () => {
    if (!peer || activePeer.current !== peer.id) return;
    const version = ++messageVersion.current;
    const ticket = chatSnapshots.current.begin(peer.id);
    // A failed background refresh must not erase an already loaded conversation.
    const next = await requestChatSnapshot(peer.id, messageFocus.current);
    if (version !== messageVersion.current || activePeer.current !== peer.id)
      return;
    const saved = chatSnapshots.current.save(next, ticket);
    if (saved) applyChatSnapshot(peer.id, saved);
  }, [peer, applyChatSnapshot]);
  useEffect(() => {
    if (!myId || accountBlocked) return;
    let live = true,
      pending = false,
      timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!live || pending) return;
      pending = true;
      clearTimeout(timer);
      try {
        if (document.hidden) return;
        if (page === 'messages') await loadThreads();
        else {
          const data = await request<{ unread: number }>(
            '?action=threadsUnread',
          );
          if (live) setThreadUnread(data.unread);
        }
      } catch {
        // Keep the last successful badge/list while the server is unavailable.
      } finally {
        pending = false;
        if (live) timer = setTimeout(tick, page === 'messages' ? 5000 : 15000);
      }
    };
    void tick();
    const giftsChanged = () => void tick();
    const visible = () => {
      if (!document.hidden) void tick();
    };
    window.addEventListener('noctgram:gifts-changed', giftsChanged);
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener('noctgram:gifts-changed', giftsChanged);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [myId, accountBlocked, page, loadThreads]);
  useEffect(() => {
    if (page !== 'messages' || !peer || accountBlocked) return;
    activePeer.current = peer.id;
    messageFocus.current = '';
    const generationRef = messageVersion;
    if (preparedMessageLoad.current !== peer.id)
      void loadMessages().catch((e) => notify(e.message));
    preparedMessageLoad.current = '';
    let pending = false;
    const t = setInterval(() => {
      if (!pending && document.visibilityState === 'visible') {
        pending = true;
        void loadMessages()
          .catch(() => {})
          .finally(() => {
            pending = false;
          });
      }
    }, 3000);
    const giftsChanged = () => {
      void loadMessages().catch(() => {});
    };
    window.addEventListener('noctgram:gifts-changed', giftsChanged);
    return () => {
      clearInterval(t);
      window.removeEventListener('noctgram:gifts-changed', giftsChanged);
      activePeer.current = '';
      generationRef.current++;
    };
  }, [peer, page, loadMessages, accountBlocked, notify]);
  useEffect(() => {
    if (
      (modal !== 'people' && !(roomCreation && creationOwner === me?.id)) ||
      !me
    )
      return;
    setPeopleLoading(true);
    setPeopleError('');
    setFound([]);
    let active = true;
    const t = setTimeout(
      () =>
        request<Person[]>('?action=people&q=' + encodeURIComponent(peopleQuery))
          .then((r) => {
            if (active) {
              setFound(r);
              setPeopleLoading(false);
            }
          })
          .catch((e) => {
            if (active) {
              setPeopleLoading(false);
              setPeopleError(e.message);
              if (!roomCreation) notify(e.message);
            }
          }),
      200,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [
    peopleQuery,
    modal,
    me,
    notify,
    roomCreation,
    peopleRetry,
    creationOwner,
  ]);
  const route: AppRoute = {
    page,
    musicTab,
    profileId: profile?.id,
    handle: profile?.handle,
    profileTab,
    peerId: roomTarget && page === 'messages' ? undefined : peer?.id,
    ...(page === 'messages' && roomTarget ? roomTarget : {}),
    mode,
    query,
    ...(page === 'profile' && boostOpen?.open && boostOpen.id === profile?.id
      ? { boost: true }
      : {}),
  };
  const cache = navigationCache.current;
  if (cache.owner !== (myId || '')) {
    cache.owner = myId || '';
    cache.profiles.clear();
    cache.peers.clear();
    cache.drafts.clear();
  }
  if (profile) cache.profiles.set(profile.id, profile);
  if (peer) {
    cache.peers.set(peer.id, peer);
    cache.drafts.set(peer.id, messageText);
  }
  if (cache.profiles.size > 24)
    cache.profiles.delete(cache.profiles.keys().next().value!);
  if (cache.peers.size > 50)
    cache.peers.delete(cache.peers.keys().next().value!);
  if (cache.drafts.size > 50)
    cache.drafts.delete(cache.drafts.keys().next().value!);
  const navigationLatest = useRef<{
    route: AppRoute;
    prepare: (route: AppRoute) => Promise<PreparedRoute>;
    notify: (message: string) => void;
  } | null>(null);
  navigationLatest.current = {
    route,
    notify,
    prepare: async (next) => {
      const preparation = ++chatPreparation.current;
      const root = rootNavigation.current;
      setOpeningChat('');
      setOpeningProfile('');
      if (
        !me &&
        ['profile', 'messages', 'saved', 'channels', 'stars'].includes(
          next.page,
        )
      )
        throw new Error('Войдите, чтобы открыть раздел');
      if (next.page === 'moderation' && !me?.canModerate)
        throw new Error('Раздел недоступен');
      let person: Profile | null = null,
        conversation: Person | null = null;
      let conversationSnapshot: ChatSnapshot | undefined;
      let fetchedConversation = false;
      let lateProfile: Promise<Profile> | undefined,
        lateConversation: Promise<ChatSnapshot | undefined> | undefined;
      if (
        next.page === 'profile' &&
        (next.handle || next.profileRef) &&
        !next.profileId
      ) {
        const ref = next.handle || next.profileRef!;
        if (
          me &&
          (ref === me.id ||
            [me.handle, ...me.handles].includes(
              ref.replace(/^@/, '').toLowerCase(),
            ))
        ) {
          person = me;
        } else {
          const resolved = await resolveMention(ref, !next.handle);
          if (resolved.kind === 'group')
            next = { page: 'messages', group: resolved.group };
          else person = resolved.profile;
        }
      }
      if (next.page === 'profile') {
        const id =
          next.profileId ||
          (!next.handle && !next.profileRef ? myId || '' : '');
        person ??=
          id === myId ? me : id ? cache.profiles.get(id) || null : null;
        if (!person) {
          const loading = request<Profile>(
            '?' +
              new URLSearchParams({
                action: 'profile',
                ...(id
                  ? { id }
                  : next.profileRef
                    ? { ref: next.profileRef }
                    : { handle: next.handle || '' }),
              }),
          );
          const opened = () =>
            setOpeningProfile((value) => (value === id ? '' : value));
          setOpeningProfile(id);
          person = await (id ? waitBriefly(loading) : loading).catch(
            (error) => {
              opened();
              throw error;
            },
          );
          // A slow profile opens as its loading state and fills in on arrival.
          if (!person) lateProfile = loading;
          else opened();
        }
        // The cover appears once decoded; navigation never waits for it.
        const cover = coverImage(person?.cover);
        if (cover && !person?.blocked && !coverImages.current.get(cover))
          void coverImages.current
            .prepare(cover)
            .then(() => setCoverRevision((value) => value + 1));
        next = {
          page: 'profile',
          profileId: person?.id || id,
          handle: person?.handle || '',
          ...(next.boost && person?.kind === 'channel' && !person.blocked
            ? { boost: true }
            : {}),
          profileTab: next.profileTab || 'posts',
        };
      }
      if (next.page === 'messages' && next.peerId) {
        conversation =
          cache.peers.get(next.peerId) ||
          threads.find((item) => item.id === next.peerId) ||
          (await request<Profile>(
            '?action=profile&id=' + encodeURIComponent(next.peerId),
          ));
        if (conversation.kind === 'channel' || conversation.id === 'noctgram')
          throw new Error('Выберите личный диалог');
        conversationSnapshot = chatSnapshots.current.get(conversation.id);
        if (!conversationSnapshot) {
          const id = conversation.id;
          const ticket = chatSnapshots.current.begin(id);
          setOpeningChat(id);
          const loading = requestChatSnapshot(id).then(
            (snapshot) =>
              chatSnapshots.current.save(snapshot, ticket) ||
              chatSnapshots.current.get(id, ticket.generation),
          );
          try {
            const ready = await waitBriefly(loading);
            // A slow chat opens with its loading state and fills in on arrival.
            if (ready === null) lateConversation = loading;
            else if (!ready)
              throw new Error('Аккаунт изменился. Откройте диалог снова.');
            else conversationSnapshot = ready;
            fetchedConversation = true;
          } finally {
            if (chatPreparation.current === preparation) setOpeningChat('');
          }
        }
      }
      const destination = next;
      return {
        route: destination,
        commit: () => {
          setRoomTarget(
            destination.page === 'messages' &&
              (destination.roomId || destination.group || destination.invite)
              ? {
                  ...(destination.roomId ? { roomId: destination.roomId } : {}),
                  ...(destination.group ? { group: destination.group } : {}),
                  ...(destination.invite ? { invite: destination.invite } : {}),
                }
              : null,
          );
          if (destination.page === 'profile' && destination.boost && person)
            setBoostOpen({ id: person.id, revision: Date.now(), open: true });
          else
            setBoostOpen((current) =>
              current ? { ...current, open: false } : null,
            );
          if (destination.page === 'profile') {
            setProfile(person);
            setProfileTab(destination.profileTab || 'posts');
            setProfileRoot(root);
          }
          if (lateProfile) {
            const id = destination.profileId;
            // Fill the opened profile in, unless the viewer has moved on.
            const here = () =>
              chatPreparation.current === preparation &&
              navigationLatest.current!.route.page === 'profile' &&
              !navigationLatest.current!.route.profileId;
            void lateProfile
              .then(
                (loaded) => {
                  if (!here()) return;
                  cache.profiles.set(loaded.id, loaded);
                  void appHistory.current?.navigate(
                    {
                      page: 'profile',
                      profileId: loaded.id,
                      handle: loaded.handle,
                      profileTab: destination.profileTab,
                    },
                    { replace: true },
                  );
                },
                (error: Error) => {
                  if (!here()) return;
                  notify(error.message);
                  if (!appHistory.current?.back())
                    void appHistory.current?.navigate(
                      { page: 'feed' },
                      { replace: true },
                    );
                },
              )
              .finally(() =>
                setOpeningProfile((value) => (value === id ? '' : value)),
              );
          }
          if (
            destination.page === 'messages' &&
            (navigationLatest.current!.route.page !== 'messages' ||
              navigationLatest.current!.route.peerId !== conversation?.id)
          ) {
            messageVersion.current++;
            activePeer.current = conversation?.id || '';
            setPeer(conversation);
            preparedMessageLoad.current = fetchedConversation
              ? conversation?.id || ''
              : '';
            if (conversation && conversationSnapshot)
              applyChatSnapshot(
                conversation.id,
                chatSnapshots.current.get(conversation.id) ||
                  conversationSnapshot,
              );
            else {
              setMessages([]);
              setMessageAccess(null);
              setChatAppearance(null);
            }
            if (conversation && lateConversation) {
              const id = conversation.id;
              // A superseded load (no snapshot) leaves the newer one to apply.
              void lateConversation.then(
                (saved) => {
                  if (saved && activePeer.current === id)
                    applyChatSnapshot(
                      id,
                      chatSnapshots.current.get(id) || saved,
                    );
                },
                (error: Error) => {
                  if (activePeer.current === id) notify(error.message);
                },
              );
            }
            setMessageText(
              conversation ? cache.drafts.get(conversation.id) || '' : '',
            );
          }
          setQuery(destination.query || '');
          if (destination.page === 'feed') setMode(destination.mode || 'all');
          if (destination.page === 'music')
            setMusicTab(destination.musicTab || 'playlists');
          setPageState(destination.page);
          setModalOpen(false);
          setLightboxOpen(false);
        },
      };
    },
  };
  useEffect(() => {
    if (!myId && !guest) return;
    const motion = createPageTransition(window, flushSync);
    pageTransition.current = motion;
    const history = createAppHistory(window, {
      owner: myId || 'guest',
      initial: navigationLatest.current!.route,
      prepare: (next) => navigationLatest.current!.prepare(next),
      render: (from, to, update, initial) =>
        motion.run(
          from.page,
          to.page,
          () => {
            update();
            startupComplete.current = true;
            setRouteError('');
            setRouteReady(true);
          },
          !initial,
        ),
      error: (message) => {
        if (!startupComplete.current) setRouteError(message);
        else navigationLatest.current!.notify(message);
      },
    });
    appHistory.current = history;
    return () => {
      history.dispose();
      motion.cancel();
      pageTransition.current = null;
      appHistory.current = null;
    };
  }, [myId, guest]);
  useEffect(() => {
    if (!routeReady) return;
    appHistory.current?.observe({
      page,
      musicTab,
      profileId: viewedId,
      handle: profile?.id === viewedId ? profile?.handle || '' : '',
      profileTab,
      peerId: roomTarget && page === 'messages' ? undefined : peer?.id,
      ...(page === 'messages' && roomTarget ? roomTarget : {}),
      mode,
      query,
    });
  }, [
    routeReady,
    page,
    viewedId,
    profile?.id,
    profile?.handle,
    profileTab,
    peer?.id,
    mode,
    query,
    musicTab,
    roomTarget,
  ]);
  const profileView = page === 'profile' ? viewedId : '';
  useLayoutEffect(() => {
    if (!routeReady) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (page === 'search') searchRef.current?.focus({ preventScroll: true });
  }, [page, profileView, routeReady]);
  const openProfile = async (id: string, tab = 'posts') => {
    if (!auth()) return false;
    return (
      appHistory.current?.navigate({
        page: 'profile',
        profileId: id,
        profileTab: tab,
      }) ?? false
    );
  };
  useEffect(() => {
    const navigateProfile = (event: Event) => {
      event.preventDefault();
      if (!myId) {
        setModal('signin');
        return;
      }
      const target = (event as CustomEvent<ProfileNavigation>).detail;
      void appHistory.current
        ?.navigate(
          target.group || target.invite || target.roomId
            ? {
                page: 'messages',
                group: target.group,
                invite: target.invite,
                roomId: target.roomId,
              }
            : {
                page: 'profile',
                profileId: target.id,
                profileRef: target.ref,
                handle: target.handle,
                profileTab: 'posts',
              },
        )
        .then((opened) => {
          if (opened) target.onNavigated?.();
        });
    };
    window.addEventListener(PROFILE_NAVIGATE, navigateProfile);
    return () => {
      window.removeEventListener(PROFILE_NAVIGATE, navigateProfile);
    };
  }, [myId]);
  const openChat = (person: Person) => {
    if (!auth()) return;
    if (person.id === 'noctgram') {
      notify('Это официальный канал. Общайтесь с командой в комментариях.');
      return;
    }
    cache.peers.set(person.id, person);
    void appHistory.current?.navigate({ page: 'messages', peerId: person.id });
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
      setPublishError('');
      let reviewNotice = '';
      try {
        const result = await request<{ queued?: boolean; notice?: string }>(
          '',
          {
            action: 'post',
            as: publisher,
            text: draft,
            media: attachments.map((x) => x.id),
            poll: poll || [],
            code: code || '',
            codeLang,
            adult,
          },
        );
        if (result.queued)
          reviewNotice = result.notice || 'Публикация отправлена на проверку';
      } catch (error) {
        setPublishError(
          error instanceof Error && error.message
            ? error.message
            : 'Не удалось отправить публикацию. Попробуй ещё раз.',
        );
        return;
      }
      // Clear the draft only after the server confirms the publication.
      setDraft('');
      setAttachments([]);
      setPoll(null);
      setCode(null);
      setCodeLang('text');
      setAdult(false);
      if (reviewNotice) {
        notify(reviewNotice);
        return;
      }
      notify('Публикация появилась в ленте');
      const results = await Promise.allSettled([
        latestRefresh.current(),
        request<Profile>('?action=profile&id=' + encodeURIComponent(publisher)),
      ]);
      const updated = results[1];
      if (updated.status === 'fulfilled') {
        if (updated.value.id === me?.id) setMe(updated.value);
        setProfile((current) =>
          current?.id === updated.value.id ? updated.value : current,
        );
      }
      if (
        results.some((result) => result.status === 'rejected') ||
        (results[0].status === 'fulfilled' && results[0].value === false)
      )
        notify(
          'Пост опубликован, но обновить данные не удалось. Обнови страницу.',
        );
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
  // The card already shows the choice; this only confirms it with the server.
  const action = (p: Post, kind: string, value: unknown) => {
    if (!writable()) return false;
    postRequests.current ??= createLatestRequests();
    return postRequests
      .current(p.id + ':' + kind, value, async (chosen) => {
        await request('', {
          action: kind,
          id: p.id,
          ...(kind === 'vote' ? { option: chosen } : { value: chosen }),
        });
        const updated = await request<Post>(
          '?action=post&id=' + encodeURIComponent(p.id),
        );
        snapshots.current.update(updated);
        setPosts((rows) => rows.map((x) => (x.id === p.id ? updated : x)));
      })
      ?.catch((e) => notify((e as Error).message));
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
        snapshots.current.remove(p.id);
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
    }, 'post:' + p.id);
  };
  const profileOwned =
    !!me && (profile?.id === me.id || profile?.ownerId === me.id);
  const profileEditable = profileOwned || !!profile?.canEditProfile;
  const editTarget =
    editId === me?.id ? me : profile?.id === editId ? profile : null;
  const editAliasLimit = profileHandleLimit(editTarget?.kind) - 1;
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
    setEditDetails(detailsDraft(target));
    setModal('edit');
  };
  useEffect(() => {
    if (
      !me ||
      new URLSearchParams(window.location.search).get('recovered') !== '1'
    )
      return;
    window.history.replaceState(null, '', window.location.pathname);
    setEditId(me.id);
    setEditName(me.name);
    setEditBio(me.bio);
    setEditAvatar(me.avatar);
    setEditCover(me.cover);
    setEditHandle(me.handle);
    setEditAliases(me.handles.filter((h) => h !== me.handle));
    setEditDetails(detailsDraft(me));
    setEditTab('account');
    setModal('edit');
  }, [me]);
  const applyAppearance = (updated: Profile) => {
    snapshots.current.clear();
    setMe((current) => (current?.id === updated.id ? updated : current));
    setProfile((current) => (current?.id === updated.id ? updated : current));
    const appearance = {
      verified: updated.verified,
      gratitude: updated.gratitude,
      premium: updated.premium,
      boostLevel: updated.boostLevel,
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
        ...(editId === me?.id ? editDetails : null),
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
    }, 'follow:' + person.id);
  };
  const composer = (
    <fieldset
      className="composer"
      disabled={busy || readOnly}
      aria-describedby={publishError ? 'composer-publish-error' : undefined}
    >
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
      <EmojiPreview text={draft} />
      <div className="toolbar">
        <EmojiPicker
          premium={!!me?.premium}
          text={draft}
          onText={setDraft}
          field={draftRef}
          disabled={uploading}
        />
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
          {busy ? <LoaderCircle size={14} className="spin" /> : 'Опубликовать'}
          <ArrowUpRight size={14} />
        </button>
      </div>
      {publishError && (
        <div
          id="composer-publish-error"
          className="composer-error"
          role="alert"
        >
          <strong>Не удалось отправить публикацию</strong>
          <p>{publishError}</p>
          <small>Текст, вложения и настройки остались в редакторе.</small>
        </div>
      )}
    </fieldset>
  );
  const cardActions = useRef({
    openProfile,
    action,
    openComments,
    postMenu,
    writable,
  });
  cardActions.current = {
    openProfile,
    action,
    openComments,
    postMenu,
    writable,
  };
  const cardCallbacks = useMemo(
    () => ({
      onProfile: (id: string) => {
        void cardActions.current.openProfile(id);
      },
      onAction: (post: Post, kind: string, value: unknown) =>
        cardActions.current.action(post, kind, value),
      onComments: (post: Post) => cardActions.current.openComments(post),
      onMenu: (post: Post, kind: string) =>
        cardActions.current.postMenu(post, kind),
      onMedia: (media: Media) => {
        setLightbox(media);
        setLightboxOpen(true);
      },
      onSupport: (post: Post) => {
        if (cardActions.current.writable()) {
          setSupportPost(post);
          setModalContent('support');
          setModalOpen(true);
        }
      },
    }),
    [],
  );
  const messageCallbacks = useMemo(
    () => ({
      onProfile: (id: string) => {
        void cardActions.current.openProfile(id, 'gifts');
      },
      onReport: (message: Message) => {
        setReportedMessage(message);
        setModalContent('reportMessage');
        setModalOpen(true);
      },
    }),
    [],
  );
  const cards = (items: Post[]) =>
    items.map((p) => (
      <PostCard
        canModerate={!!me?.canModerate && !readOnly}
        key={p.id}
        p={p}
        me={me?.id}
        busy={busy || readOnly}
        {...cardCallbacks}
        onDelete={setDeleteId}
        onView={recordView}
      />
    ));
  const shownPosts =
    page === 'profile' && profileTab === 'media'
      ? displayPosts.filter((p) => p.media.length)
      : page === 'profile'
        ? [...displayPosts].sort((a, b) => (b.pinned || 0) - (a.pinned || 0))
        : page === 'saved'
          ? displayPosts.filter((p) => p.saved)
          : displayPosts;
  const unread =
    threadUnread +
    roomList.rooms.reduce(
      (sum, room) => sum + (room.muted ? 0 : room.unread),
      0,
    );
  const dialogs = [
    ...threads.map((person) => ({
      type: 'person' as const,
      person,
      time: person.lastTime || 0,
    })),
    ...roomList.rooms.map((room) => ({
      type: 'room' as const,
      room,
      time: room.lastMessage?.created || room.updatedAt,
    })),
  ].sort((a, b) => b.time - a.time);
  const archivedDialogs = dialogs.filter((d) =>
    d.type === 'room' ? d.room.archivedAt : d.person.archivedAt,
  );
  const visibleDialogs = dialogs.filter(
    (d) =>
      Boolean(d.type === 'room' ? d.room.archivedAt : d.person.archivedAt) ===
      (chatFolder === 'archive'),
  );
  const archiveDone = async () => {
    await Promise.all([loadThreads(), roomList.refresh()]);
  };
  const online = !!profile?.lastSeen && Date.now() - profile.lastSeen < 120000;
  // The bar highlights the current section; someone else's profile keeps the
  // tab it was opened from, as a pushed screen does on iOS.
  const ownProfile = page === 'profile' && !!me && profile?.id === me.id;
  const pageTab =
    page === 'music-services'
      ? 'music'
      : page === 'saved' || ownProfile
        ? 'profile'
        : page === 'profile'
          ? ''
          : page;
  if (['feed', 'messages', 'channels', 'music', 'profile'].includes(pageTab))
    rootTab.current = pageTab;
  const navTab = pageTab || rootTab.current;
  const refreshPage = () => {
    if (['music', 'music-services'].includes(page)) {
      window.dispatchEvent(new Event('noctgram:music-refresh'));
    } else if (me) void refresh();
    else void bootstrap();
  };
  // Tapping the open tab again scrolls to the top, and at the top refreshes.
  const selectTab = (v: string) => {
    if (v === 'search' || v !== page || (v === 'profile' && !ownProfile))
      return openSection(v);
    if (window.scrollY > 0)
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    else refreshPage();
    return true;
  };
  if (accountBlocked && me)
    return (
      <>
        <MusicAccountGuard blocked />
        <BlockedAccount
          me={me}
          onUpdate={updateAccount}
          onRefresh={refreshAccount}
        />
      </>
    );
  const currentChatTheme =
    chatAppearance &&
    chatAppearance.viewer === myId &&
    chatAppearance.peer === peer?.id
      ? chatAppearance.value
      : DEFAULT_CHAT_THEME;
  if (!routeReady) {
    const error = routeError || loadError;
    return (
      <main className="app-startup" aria-busy={!error}>
        <h1 className="app-startup-brand">
          <NoctLogo size={42} /> noctgram
        </h1>
        <p className="app-startup-description">{SITE_DESCRIPTION}</p>
        <a className="app-startup-about" href="/about">
          О Noctgram
        </a>
        {error ? (
          <div className="app-startup-error" role="alert">
            <p>{error}</p>
            <button
              className="secondary"
              onClick={() => window.location.reload()}
            >
              Повторить
            </button>
            {guest && (
              <a className="secondary" href="/login">
                Войти
              </a>
            )}
            <a className="text-button" href="/">
              На главную
            </a>
          </div>
        ) : (
          <output className="app-startup-status">
            <LoaderCircle size={18} className="spin" aria-hidden="true" />{' '}
            Загрузка…
          </output>
        )}
      </main>
    );
  }
  return (
    <div
      className={
        'app-shell' +
        (['music', 'music-services'].includes(page) ? ' music-shell' : '') +
        (page === 'profile' ? ' profile-shell' : '') +
        (page === 'messages' ? ' messages-shell' : '')
      }
    >
      {audioCalls.panel}
      <aside className="sidebar">
        <AppLink
          className="brand"
          href={navigationHref('feed')}
          onNavigate={() => navigate('feed')}
        >
          <span className="brand-icon">
            <NoctLogo size={40} />
          </span>
          noctgram<span className="alpha">α</span>
        </AppLink>
        <MainNavigation
          active={navTab}
          origin={rootTab.current}
          href={navigationHref}
          navigate={selectTab}
          openingProfile={!!openingProfile}
          unread={unread}
        />
        <div className="sidebar-bottom">
          <div className="premium-nav-shell">
            <NavBorderBeam />
            <AppLink
              className="premium-nav"
              href={navigationHref('premium')}
              onNavigate={() => navigate('premium')}
              aria-label="Открыть Noct Premium"
              aria-current={page === 'premium' ? 'page' : undefined}
            >
              <PremiumIcon size={23} />
              <span>Noct Premium</span>
              <span className="badge">{me?.premium ? 'активен' : 'новое'}</span>
            </AppLink>
          </div>
          <div className="premium-nav-shell stars-nav-shell">
            <NavBorderBeam stars />
            <AppLink
              className="premium-nav"
              aria-label="Открыть Noct Stars"
              href={navigationHref('stars')}
              onNavigate={() => navigate('stars')}
            >
              <StarsIcon size={23} />
              <span>Noct Stars</span>
            </AppLink>
          </div>
          {me ? (
            <>
              <div className="sidebar-account-row">
                <AppLink
                  className="account"
                  href={navigationHref('profile')}
                  onNavigate={() => navigate('profile')}
                >
                  <Avatar person={me} />
                  <span>
                    <strong>
                      <DisplayName person={me} />
                    </strong>
                    <small>@{me.handle}</small>
                  </span>
                </AppLink>
                <button
                  className="account-settings-button"
                  aria-label="Настройки мессенджера"
                  title="Настройки"
                  onClick={() => {
                    setSettingsSection('profile');
                    setModal('settings');
                  }}
                >
                  <Settings size={20} />
                </button>
              </div>
              <AccountSwitcher userId={me.id} />
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
        data-page={page}
        className={
          'main-column ' +
          (page === 'messages'
            ? 'messages-main'
            : ['premium', 'stars'].includes(page)
              ? 'premium-main'
              : '')
        }
      >
        {page === 'messages' ? (
          <h1 className="sr-only">Сообщения</h1>
        ) : (
          <header className="page-header">
            <h1>
              {['music', 'music-services'].includes(page)
                ? 'Музыка'
                : page === 'moderation'
                  ? 'Модерация'
                  : page === 'profile'
                    ? profile?.name || 'Профиль'
                    : page === 'channels'
                      ? 'Каналы'
                      : page === 'stars'
                        ? 'Noct Stars'
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
              <AppLink
                className="icon-button"
                title="Модерация"
                aria-label="Открыть модерацию"
                href={navigationHref('moderation')}
                onNavigate={() => navigate('moderation')}
              >
                <ShieldCheck size={20} />
              </AppLink>
            )}
            {me && (
              <NotificationsBell
                me={me.id}
                activeChat={page === 'messages' ? peer?.id : undefined}
                onProfile={(id) => void openProfile(id)}
                onGift={(recipient) => {
                  if (recipient && recipient !== me.id)
                    void openProfile(recipient, 'gifts');
                  else {
                    navigate('profile');
                    setProfileTab('gifts');
                  }
                }}
                onPost={(id) => {
                  void request<Post>(
                    '?action=post&id=' + encodeURIComponent(id),
                  )
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
            {page !== 'premium' && (
              <span
                className="page-loading-indicator"
                data-loading={loading || !!openingProfile}
                aria-hidden="true"
              >
                <LoaderCircle
                  className={loading ? 'spin' : undefined}
                  size={15}
                />
              </span>
            )}
            <AppLink
              className="icon-button mobile-stars-link"
              title="Noct Stars"
              aria-label="Открыть Noct Stars"
              aria-current={page === 'stars' ? 'page' : undefined}
              href={navigationHref('stars')}
              onNavigate={() => navigate('stars')}
            >
              <StarsIcon size={22} />
            </AppLink>
            <AppLink
              className="icon-button mobile-market-link"
              title="Маркет"
              aria-label="Открыть Маркет"
              href="/market"
              // Market is a standalone page outside the in-app history.
              onNavigate={() => window.location.assign('/market')}
            >
              <Store size={20} />
            </AppLink>
            <AppLink
              className="icon-button"
              aria-label="Найти в Noctgram"
              href={navigationHref('search')}
              onNavigate={() => navigate('search')}
            >
              <Search size={20} />
            </AppLink>
            <button
              className="icon-button page-refresh"
              aria-label="Обновить"
              onClick={refreshPage}
            >
              <RefreshCw size={18} />
            </button>
          </header>
        )}
        {page === 'saved' && (
          <AppLink
            className="text-button saved-back"
            href={navigationHref('profile')}
            onNavigate={() => navigate('profile')}
          >
            <ArrowLeft size={17} aria-hidden="true" /> В профиль
          </AppLink>
        )}
        {loadError && (
          <div className="error-banner" role="alert">
            {loadError}{' '}
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
            canAdmin={!!me.canAdmin}
            onChanged={() => {
              void refreshAccount();
            }}
          />
        )}
        {page === 'profile' && profile?.blocked && (
          <SuspendedProfile profile={profile} onBack={() => navigate('feed')} />
        )}
        <div
          className="stream-intro feed-section"
          key={
            'feed:' +
            (me?.id || 'guest') +
            ':' +
            privacyVersion +
            ':' +
            accountBlocked
          }
          hidden={page !== 'feed'}
        >
          <div
            className="feed-tabs"
            data-selected={mode === 'following' ? 1 : 0}
          >
            <Tabs
              value={mode}
              onValueChange={(v) => {
                if (v !== 'all' && !auth()) return;
                appHistory.current?.cancelPending();
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
                <strong>Noctgram — социальная сеть и мессенджер</strong>
                <span>
                  Публикации, каналы, чаты, музыка и плейлисты.{' '}
                  <a href="/about">О сервисе</a>
                </span>
              </div>
              <a href="/login" target="_top" className="primary">
                Войти <ArrowUpRight size={14} />
              </a>
            </div>
          )}
          {me && !accountBlocked && (
            <StoriesBar me={me} readOnly={readOnly} active={page === 'feed'} />
          )}
          {page === 'feed' && composer}
        </div>
        {page === 'search' && (
          <div className="stream-intro search-intro">
            <div className="search-panel">
              <div className="searchbox">
                <Search size={18} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    appHistory.current?.cancelPending();
                    setQuery(e.target.value);
                  }}
                  aria-label="Поиск в ленте"
                  placeholder="Публикации, люди, группы"
                />
                {query && (
                  <button
                    aria-label="Очистить поиск"
                    onClick={() => {
                      appHistory.current?.cancelPending();
                      setQuery('');
                    }}
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
          </div>
        )}
        {page === 'search' && me && (
          <PublicRoomSearch
            query={query}
            owner={me.id}
            onOpen={openPublicGroup}
          />
        )}
        {page === 'profile' && profile && !profile.blocked && (
          <>
            <ProfileSurface key={'profile-card:' + profile.id} person={profile}>
              <div
                className="profile-cover"
                style={
                  // A cover still being decoded shows once, without a second download.
                  coverImage(profile.cover) &&
                  !coverImages.current.loading(profile.cover)
                    ? {
                        backgroundImage: `url(${coverImages.current.get(profile.cover) || profile.cover})`,
                      }
                    : undefined
                }
              >
                {profile.cover === LIQUID_COVER && profile.avatar && (
                  <LiquidCover src={profile.avatar} />
                )}
                {!(ownProfile && profileRoot) && (
                  <AppLink
                    className="back-button"
                    aria-label="Назад"
                    href={navigationHref('feed')}
                    onNavigate={() => {
                      if (!appHistory.current?.back()) navigate('feed');
                    }}
                  >
                    <ArrowLeft size={18} />
                  </AppLink>
                )}
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
                {!coverImage(profile.cover) &&
                  !(profile.cover === LIQUID_COVER && profile.avatar) && (
                    <span className="cover-monogram">n.</span>
                  )}
              </div>
              <div className="profile-info">
                <div className="profile-avatar-line">
                  <ProfileAvatar person={profile} size={128} />
                </div>
                <div className="profile-identity-row">
                  <div className="profile-identity-main">
                    <h2>
                      <DisplayName person={profile} />
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
                        className={
                          'profile-presence ' + (online ? 'online' : '')
                        }
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
                                {i > 0 && (
                                  <span className="alias-comma">, </span>
                                )}
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
                    {profile.anonymousNumber && (
                      <div className="profile-aliases profile-number">
                        <span className="aliases-prefix">Анонимный номер</span>
                        <span className="profile-alias">
                          <button
                            title="Скопировать анонимный номер"
                            onClick={() => {
                              const number = formatMarketNumber(
                                profile.anonymousNumber || '',
                              );
                              void navigator.clipboard
                                .writeText(number)
                                .then(() => notify('Номер скопирован'))
                                .catch(() => notify(number));
                            }}
                          >
                            {formatMarketNumber(profile.anonymousNumber)}
                          </button>
                        </span>
                      </div>
                    )}
                  </div>
                  <MusicActivityStatus
                    person={profile}
                    own={profile.id === me?.id}
                    onSettings={
                      profile.id === me?.id
                        ? () => {
                            setSettingsSection('music');
                            setModal('settings');
                          }
                        : undefined
                    }
                  />
                </div>

                <div className="profile-actions">
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
                        <Pencil size={17} aria-hidden="true" /> Редактировать
                      </button>
                      {profile.id === me?.id && (
                        <button
                          className="icon-button"
                          aria-label="Настройки мессенджера"
                          title="Настройки"
                          onClick={() => {
                            setSettingsSection('profile');
                            setModal('settings');
                          }}
                        >
                          <Settings size={20} />
                        </button>
                      )}
                      <button
                        className="secondary profile-design-action"
                        aria-label="Оформление профиля"
                        onClick={() => edit('design')}
                      >
                        <PremiumIcon size={21} />
                        <span>Оформление</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {profile.id !== 'noctgram' &&
                        profile.kind !== 'channel' && (
                          <button
                            className="secondary profile-message-action"
                            aria-label="Написать сообщение"
                            onClick={() => openChat(profile)}
                          >
                            <Mail size={18} aria-hidden="true" /> Написать
                          </button>
                        )}
                      <button
                        className="primary profile-follow-action"
                        disabled={readOnly || busy}
                        onClick={() => follow(profile)}
                      >
                        {profile.followed ? 'Вы читаете' : 'Читать'}
                      </button>
                    </>
                  )}
                  {profile.id !== 'noctgram' && profile.id !== me?.id && (
                    <SendGiftButton
                      key={profile.id}
                      recipient={profile}
                      senderId={me?.id || ''}
                      disabled={!me || readOnly || channelRestricted || busy}
                    />
                  )}
                </div>
                <p className="bio">
                  {profile.bio ? (
                    <MentionText text={profile.bio} />
                  ) : profile.id === me?.id ? (
                    'Добавьте описание профиля.'
                  ) : (
                    'Пока без описания.'
                  )}
                </p>
                <ProfileMeta profile={profile} />
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
                <ProfileChannels channels={profile.personalChannels} />
                {profile.id === me?.id && (
                  <AppLink
                    className="profile-saved-link"
                    href={navigationHref('saved')}
                    onNavigate={() => navigate('saved')}
                  >
                    <Bookmark size={19} aria-hidden="true" />
                    <span>Сохранённое</span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </AppLink>
                )}
                {profile.kind === 'channel' && me && (
                  <ChannelBoosts
                    key={profile.id + ':' + (boostOpen?.revision || 0)}
                    channel={profile}
                    me={me}
                    disabled={readOnly || channelRestricted}
                    initialOpen={boostOpen?.id === profile.id && boostOpen.open}
                    onClosed={() =>
                      setBoostOpen((current) =>
                        current?.id === profile.id &&
                        current.revision === boostOpen?.revision
                          ? { ...current, open: false }
                          : current,
                      )
                    }
                    onChanged={applyAppearance}
                    onPremium={() => navigate('premium')}
                    onProfile={(id) => void openProfile(id)}
                  />
                )}
                <ProfileRecognitions person={profile} />
              </div>
            </ProfileSurface>
            {profile.kind === 'channel' && me && (
              <StoriesBar
                key={profile.id}
                me={me}
                channel={profile}
                readOnly={readOnly || channelRestricted}
              />
            )}
            <div
              key={'profile-tabs:' + profile.id}
              className="feed-tabs profile-tabs has-gifts"
              data-selected={
                profileTab === 'gifts' ? 2 : profileTab === 'media' ? 1 : 0
              }
            >
              <Tabs
                value={profileTab}
                onValueChange={(v) => {
                  appHistory.current?.cancelPending();
                  setProfileTab(String(v));
                }}
              >
                <TabsList>
                  <TabsTrigger value="posts">Публикации</TabsTrigger>
                  <TabsTrigger value="media">Медиа</TabsTrigger>
                  <TabsTrigger value="gifts">Подарки</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {profileTab === 'gifts' && me && (
              <ProfileGifts
                key={'gifts:' + profile.id}
                userId={profile.id}
                own={profile.id === me.id}
                canManageVisibility={
                  profileEditable && !readOnly && !channelRestricted
                }
                ownerName={profile.name}
                selfGift={
                  profile.id === me.id || profile.kind === 'channel' ? (
                    <SendGiftButton
                      recipient={profile}
                      senderId={me.id}
                      disabled={readOnly || channelRestricted || busy}
                      showLabel
                    />
                  ) : undefined
                }
              />
            )}
            {profilePublisher &&
              profile.kind === 'channel' &&
              !readOnly &&
              !channelRestricted &&
              profileTab === 'posts' && (
                <ChannelTools
                  key={'publishing:' + profile.id}
                  profile={profile}
                  actorId={me?.id}
                  onCreated={() => void refresh()}
                />
              )}
            {profilePublisher &&
              !readOnly &&
              !channelRestricted &&
              profileTab === 'posts' &&
              composer}
          </>
        )}
        {page === 'music-services' && (
          <MusicServices
            signedIn={!!me}
            readOnly={!!readOnly}
            onMusic={(tab) => {
              if (tab) setMusicTab(tab);
              navigate('music');
            }}
          />
        )}
        {page === 'music' && (
          <MusicPanel
            signedIn={!!me}
            readOnly={!!readOnly}
            tab={musicTab}
            onTabChange={(value) => {
              appHistory.current?.cancelPending();
              setMusicTab(value);
            }}
            onProfile={(id) => void openProfile(id)}
            onServices={() => navigate('music-services')}
          />
        )}
        {page === 'stars' && me && (
          <StarsPanel
            key={me.id}
            me={me}
            onBack={() => setPage(starsReturn.current)}
          />
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
        {![
          'messages',
          'premium',
          'stars',
          'channels',
          'moderation',
          'music',
          'music-services',
        ].includes(page) &&
          !(
            page === 'profile' &&
            (profile?.blocked || profileTab === 'gifts')
          ) && (
            <div
              className={
                ['feed', 'search'].includes(page) ? 'stream-results' : undefined
              }
              key={'results:' + page}
              aria-busy={publicationLoading}
            >
              {publicationLoading && !displayPosts.length ? (
                <>
                  <PostSkeleton />
                  <PostSkeleton />
                </>
              ) : (
                cards(shownPosts)
              )}
              {shownPosts.length === 0 && !publicationLoading && (
                <Empty>
                  {query
                    ? 'Ничего не найдено. Попробуйте другой запрос.'
                    : page === 'saved'
                      ? 'Сохраняй публикации, чтобы вернуться к ним позже.'
                      : page === 'profile'
                        ? 'Публикаций пока нет.'
                        : mode === 'following'
                          ? 'Подпишись на интересных людей — их публикации появятся здесь.'
                          : 'Публикаций пока нет.'}
                </Empty>
              )}
              {displayMore && (
                <button
                  className="secondary load-more"
                  disabled={loading}
                  onClick={() =>
                    void refresh(
                      true,
                      displayPosts[displayPosts.length - 1]?.created,
                      displayPosts[displayPosts.length - 1]?.id,
                    )
                  }
                >
                  Загрузить ещё
                </button>
              )}
              <div className="feed-end">
                <Moon size={13} />
                {publicationLoading ? 'Загружаем публикации…' : 'Noctgram'}
              </div>
            </div>
          )}
        {page === 'messages' && (
          <div
            ref={messengerRef}
            className={'messenger ' + (peer || roomTarget ? 'peer-open' : '')}
          >
            <section className="threads-panel">
              <div className="threads-heading">
                <span>
                  {chatFolder === 'archive' ? 'Архив' : 'Все диалоги'}
                </span>
                <span className="grow" />
                <ChatCreateMenu
                  disabled={!me || readOnly || accountBlocked}
                  onCreateGroup={() => {
                    beginRoomCreation('group');
                  }}
                  onCreateSecret={() => {
                    beginRoomCreation('secret');
                  }}
                />
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
              <ArchiveFolderButton
                archived={chatFolder === 'archive'}
                count={archivedDialogs.length}
                unread={archivedDialogs.reduce(
                  (n, d) =>
                    n +
                    (d.type === 'room'
                      ? d.room.muted
                        ? 0
                        : d.room.unread
                      : d.person.unread || 0),
                  0,
                )}
                onClick={() =>
                  setChatFolder(chatFolder === 'archive' ? 'active' : 'archive')
                }
              />
              {roomList.error && (
                <div className="room-error" role="alert">
                  {roomList.error}
                  <button
                    className="text-button"
                    onClick={() => void roomList.refresh()}
                  >
                    Повторить
                  </button>
                </div>
              )}
              {visibleDialogs.map((dialog) => {
                if (dialog.type === 'room')
                  return (
                    <ArchiveRow
                      key={myId + ':room:' + dialog.room.id}
                      owner={myId || ''}
                      id={dialog.room.id}
                      kind="room"
                      archived={!!dialog.room.archivedAt}
                      onDone={archiveDone}
                    >
                      <RoomThreadRow
                        room={dialog.room}
                        active={roomTarget?.roomId === dialog.room.id}
                        onOpen={() => openRoom(dialog.room.id)}
                      />
                    </ArchiveRow>
                  );
                const t = dialog.person;
                return (
                  <ArchiveRow
                    key={myId + ':' + t.id}
                    owner={myId || ''}
                    id={t.id}
                    kind="person"
                    archived={!!t.archivedAt}
                    onDone={archiveDone}
                  >
                    <button
                      type="button"
                      className={
                        'thread-row ' + (peer?.id === t.id ? 'active' : '')
                      }
                      aria-label={'Открыть диалог с ' + t.name}
                      aria-busy={openingChat === t.id}
                      onClick={() => openChat(t)}
                    >
                      <Avatar person={t} size={38} />
                      <span className="thread-copy">
                        <strong>
                          <DisplayName person={t} />
                        </strong>
                        <small>
                          <ChatEmojiText
                            text={emojiFallback(t.lastText || 'Открыть диалог')}
                            mentions={false}
                          />
                        </small>
                      </span>
                      {openingChat === t.id && (
                        <LoaderCircle
                          size={16}
                          className="spin"
                          aria-hidden="true"
                        />
                      )}
                      {!!t.unread && <span className="unread">{t.unread}</span>}
                    </button>
                  </ArchiveRow>
                );
              })}
              {!visibleDialogs.length && (
                <Empty>
                  <p>
                    {chatFolder === 'archive'
                      ? 'Здесь появятся диалоги, которые ты перенесёшь в архив.'
                      : 'Найди человека по юзернейму и начни разговор.'}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => setModal('people')}
                  >
                    Новый диалог <Plus size={14} />
                  </button>
                </Empty>
              )}
            </section>
            <section
              key={
                'chat-panel:' +
                myId +
                ':' +
                (roomTarget ? JSON.stringify(roomTarget) : peer?.id || 'empty')
              }
              className={'chat-panel' + (peer ? ' chat-themed' : '')}
              style={
                peer
                  ? chatTheme(
                      currentChatTheme.personal || currentChatTheme.shared,
                    ).style
                  : undefined
              }
            >
              {roomTarget && me ? (
                <RoomConversation
                  key={me.id + JSON.stringify(roomTarget)}
                  target={roomTarget}
                  me={me}
                  disabled={readOnly || accountBlocked}
                  onOpen={resolveRoomLink}
                  onBack={exitChat}
                  onProfile={(id) => void openProfile(id)}
                  onRoomsChanged={roomList.refresh}
                />
              ) : peer && me ? (
                <>
                  <div className="chat-header">
                    <button
                      className="chat-back icon-button"
                      aria-label="Назад к диалогам"
                      onClick={exitChat}
                    >
                      <ArrowLeft size={18} />
                    </button>
                    <ChatPeerProfile
                      key={'peer-profile:' + me.id + ':' + peer.id}
                      peer={peer}
                      viewerId={me.id}
                      lastSeen={
                        (
                          threads.find((thread) => thread.id === peer.id) ||
                          peer
                        ).lastSeen
                      }
                    />
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
                    {me && peer.id !== me.id && (
                      <SendGiftButton
                        key={'chat-gift:' + me.id + ':' + peer.id}
                        recipient={peer}
                        senderId={me.id}
                        disabled={busy || readOnly || !messageAccess?.allowed}
                      />
                    )}
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
                          chatSnapshots.current.remove(peer.id);
                          await loadMessages();
                          setPrivacyVersion((v) => v + 1);
                          notify(
                            messageAccess?.blockedByMe
                              ? 'Собеседник разблокирован'
                              : 'Собеседник добавлен в чёрный список',
                          );
                        }, 'block:' + peer.id)
                      }
                    >
                      <Ban size={17} />
                    </button>
                    <ChatThemeMenu
                      key={'chat-theme:' + myId + ':' + peer.id}
                      owner={myId || ''}
                      peer={peer.id}
                      value={currentChatTheme}
                      canShare={!readOnly && !!messageAccess?.allowed}
                      onRefresh={() => {
                        void Promise.all([loadThreads(), loadMessages()]).catch(
                          (e) => notify(e.message),
                        );
                      }}
                      onSave={async (scope, theme) => {
                        const saved = await request<ChatThemeState>('', {
                          action: 'chatTheme',
                          peer: peer.id,
                          scope,
                          theme,
                        });
                        if (activePeer.current === peer.id) {
                          chatSnapshots.current.updateTheme(peer.id, saved);
                          setChatAppearance((previous) => {
                            if (
                              previous &&
                              previous.viewer === myId &&
                              previous.peer === peer.id &&
                              previous.value.revision > saved.revision
                            )
                              return previous;
                            return {
                              viewer: myId || '',
                              peer: peer.id,
                              value: saved,
                            };
                          });
                        }
                      }}
                    />
                  </div>
                  <ChatConversation
                    key={'conversation:' + myId + ':' + peer.id}
                    messages={messages}
                    ready={!!messageAccess}
                    me={me}
                    peer={peer}
                    threads={threads}
                    disabled={busy || !!readOnly}
                    canSend={!!messageAccess?.allowed}
                    privacyNote={
                      messageAccess?.allowed
                        ? ''
                        : !messageAccess
                          ? 'Проверяем доступ к сообщениям…'
                          : messageAccess.blockedByMe
                            ? 'Собеседник в чёрном списке. История переписки сохранена.'
                            : 'Отправка сообщений недоступна из-за настроек приватности.'
                    }
                    text={messageText}
                    onText={setMessageText}
                    onRefresh={() => {
                      chatSnapshots.current.remove(peer.id);
                      return Promise.all([loadMessages(), loadThreads()]);
                    }}
                    onFocus={async (id) => {
                      if (activePeer.current !== peer.id) return;
                      messageFocus.current = id;
                      await loadMessages();
                    }}
                    notify={notify}
                    {...messageCallbacks}
                  />
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
      {!['profile', 'messages', 'music', 'music-services'].includes(page) && (
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
              <AppLink
                className="topic"
                key={tag}
                href={appRouteHref({ page: 'search', query: tag })}
                onNavigate={() => {
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
              </AppLink>
            ))}
            <AppLink
              className="side-card-footer"
              href={navigationHref('search')}
              onNavigate={() => navigate('search')}
            >
              Открыть поиск <ArrowUpRight size={15} />
            </AppLink>
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
            )
              .slice(0, 5)
              .map((person) => (
                <div className="suggest" key={person.id}>
                  <AppLink
                    href={appRouteHref({
                      page: 'profile',
                      profileId: person.id,
                      handle: person.handle,
                    })}
                    onNavigate={() => void openProfile(person.id)}
                  >
                    <Avatar person={person} size={36} />
                    <span>
                      <strong>
                        <DisplayName person={person} />
                      </strong>
                      <small>@{person.handle}</small>
                    </span>
                  </AppLink>
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
              Найти пользователей <ArrowUpRight size={15} />
            </button>
          </section>
          <div className="aside-footer">
            <a href="/about">О Noctgram</a>
            <span>alpha / 2026</span>
            <p>Меньше шума. Больше своего.</p>
          </div>
        </aside>
      )}
      <CreateGroupDialog
        key={'create-group:' + (me?.id || '')}
        open={creationOwner === me?.id && roomCreation === 'group'}
        onOpenChange={(open) => {
          if (!open) setRoomCreation('');
        }}
        people={found}
        ownerId={me?.id || ''}
        peopleLoading={peopleLoading}
        peopleError={peopleError}
        onQueryChange={setPeopleQuery}
        onRetryPeople={() => setPeopleRetry((value) => value + 1)}
        onSubmit={async (input) => {
          if (!me) throw new Error('Войдите в аккаунт');
          const owner = me.id;
          const data = await createRoomWithRetry({
            action: 'create',
            actor: owner,
            kind: 'group',
            ...input,
          });
          if (roomOwner.current !== owner) return;
          openRoom(data.id);
          void roomList.refresh();
        }}
      />
      <SelectSecretPeerDialog
        key={'create-secret:' + (me?.id || '')}
        open={creationOwner === me?.id && roomCreation === 'secret'}
        onOpenChange={(open) => {
          if (!open) setRoomCreation('');
        }}
        people={found}
        ownerId={me?.id || ''}
        peopleLoading={peopleLoading}
        peopleError={peopleError}
        onQueryChange={setPeopleQuery}
        onRetryPeople={() => setPeopleRetry((value) => value + 1)}
        onSubmit={async (person) => {
          if (!me) throw new Error('Войдите в аккаунт');
          const owner = me.id;
          const data = await createRoomWithRetry({
            action: 'create',
            actor: owner,
            kind: 'secret',
            peerId: person.id,
          });
          if (roomOwner.current !== owner) return;
          try {
            const key = await ensureKey(
              owner,
              data.id,
              data.members.find((member) => member.userId === owner)
                ?.publicKey || null,
            );
            if (roomOwner.current !== owner) return;
            await roomAction({
              action: 'acceptSecret',
              actor: owner,
              id: data.id,
              publicKey: key.publicKey,
            });
          } catch (error) {
            if (roomOwner.current === owner)
              notify(
                error instanceof Error
                  ? error.message
                  : 'Подключите устройство в секретном чате',
              );
          }
          if (roomOwner.current === owner) {
            openRoom(data.id);
            void roomList.refresh();
          }
        }}
      />
      <Dialog
        open={modalOpen}
        onOpenChangeComplete={(open) => {
          if (!open && !modalOpen) {
            setModalContent('');
            if (pendingBoostOpen.current) {
              setBoostOpen({
                id: pendingBoostOpen.current,
                revision: Date.now(),
                open: true,
              });
              pendingBoostOpen.current = null;
            }
          }
        }}
        onOpenChange={(open) => {
          if (!open && !uploading) setModal('');
        }}
      >
        <DialogContent
          className={
            'noct-dialog ' +
            (modal === 'settings'
              ? 'settings-dialog'
              : modal === 'edit'
                ? 'profile-editor-dialog'
                : modal === 'comments'
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
                settings: 'Настройки',
                premium: 'Noct Premium',
                edit: 'Редактировать профиль',
                support: 'Поддержать автора',
                comments: 'Комментарии',
                people: 'Найти пользователей',
                report: 'Пожаловаться',
                reportMessage: 'Жалоба на сообщение',
                moderateContent: 'Удалить публикацию',
                followers: 'Подписчики',
                following: 'Подписки',
              } as Record<string, string>
            )[modal] || 'Noctgram'}
          </DialogTitle>
          <DialogDescription
            className={modal === 'settings' ? 'sr-only' : undefined}
          >
            {
              (
                {
                  signin: 'Войдите или создайте аккаунт.',
                  settings:
                    'Профиль, оформление, приватность, музыка и доступ.',
                  premium: 'Оформление профиля и дополнительные функции.',
                  edit: 'Данные и оформление профиля.',
                  reportMessage:
                    'Модератор получит только это сообщение и причину жалобы.',
                  support: 'Благодарность за публикацию в Noct Stars.',
                  comments: 'Комментарии к публикации.',
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
          {modal === 'settings' && me && (
            <SettingsPanel
              key={me.id}
              me={me}
              initialSection={settingsSection}
              onEdit={(tab) => edit(tab, true)}
              onMusicServices={() => {
                setModal('');
                navigate('music-services');
              }}
              onChanged={() => {
                setPrivacyVersion((value) => value + 1);
                void latestRefresh.current();
                void loadThreads().catch(() => {});
                if (peer) void loadMessages().catch(() => {});
              }}
            />
          )}
          {modal === 'edit' && editTarget && (
            <div
              className="edit-tabs"
              data-selected={
                editTab === 'design'
                  ? 1
                  : editTab === 'privacy'
                    ? 2
                    : editTab === 'account'
                      ? 3
                      : 0
              }
              style={
                { '--editor-tabs': editId === me?.id ? 4 : 2 } as CSSProperties
              }
              aria-label="Раздел редактирования"
            >
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
              {editId === me?.id && (
                <>
                  <button
                    aria-pressed={editTab === 'privacy'}
                    disabled={uploading || busy}
                    onClick={() => setEditTab('privacy')}
                  >
                    Приватность
                  </button>
                  <button
                    aria-pressed={editTab === 'account'}
                    disabled={uploading || busy}
                    onClick={() => setEditTab('account')}
                  >
                    Аккаунт
                  </button>
                </>
              )}
            </div>
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
          {modal === 'edit' && (
            <div className="profile-editor-body">
              <EditorPane active={editTab === 'profile'}>
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
                            void upload(f, 'avatar')
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
                      <button
                        type="button"
                        className="secondary"
                        aria-pressed={editCover === LIQUID_COVER}
                        title="Живой фон из цветов аватарки вместо своей обложки"
                        onClick={() => setEditCover(LIQUID_COVER)}
                      >
                        Жидкое
                      </button>
                    </div>
                    {editCover === LIQUID_COVER && !editAvatar && (
                      <p className="meta">
                        «Жидкое» строится из аватарки — добавьте её, и фон
                        появится.
                      </p>
                    )}
                    {editCover && (
                      <div className="edit-cover">
                        {editCover === LIQUID_COVER ? (
                          <LiquidCover src={editAvatar} />
                        ) : (
                          <img src={editCover} alt="Новая обложка" />
                        )}
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
                                rows.map((v, n) =>
                                  n === i ? e.target.value : v,
                                ),
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
                      {editAliases.length < editAliasLimit && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            setEditAliases((rows) =>
                              rows.length < editAliasLimit
                                ? [...rows, '']
                                : rows,
                            )
                          }
                        >
                          <Plus size={14} />
                          Добавить под-юзернейм
                        </button>
                      )}
                      <span className="meta">
                        До {editAliasLimit} дополнительных имён. 4–24 латинские
                        буквы, цифры или _.
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
                    {editId === me?.id && editDetails && (
                      <ProfileDetailsFields
                        value={editDetails}
                        onChange={setEditDetails}
                        disabled={busy || uploading || readOnly}
                      />
                    )}
                    <button
                      className="primary"
                      disabled={busy || uploading || !editName.trim()}
                    >
                      {uploading ? 'Загрузка…' : 'Сохранить изменения'}
                    </button>
                  </fieldset>
                </form>
              </EditorPane>
              {editTarget && (
                <>
                  <EditorPane active={editTab === 'design'}>
                    <ProfileDesign
                      key={editTarget.id}
                      me={editTarget}
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
                        if (editTarget.kind === 'channel')
                          pendingBoostOpen.current = editTarget.id;
                        else navigate('premium');
                      }}
                    />
                  </EditorPane>
                  {editId === me?.id && (
                    <>
                      <EditorPane active={editTab === 'account'}>
                        <AccountPanel />
                      </EditorPane>
                      <EditorPane active={editTab === 'privacy'}>
                        <PrivacyPanel
                          onChanged={() => {
                            setPrivacyVersion((v) => v + 1);
                            void latestRefresh.current();
                            void loadThreads().catch(() => {});
                            if (peer) void loadMessages().catch(() => {});
                          }}
                        />
                      </EditorPane>
                    </>
                  )}
                </>
              )}
            </div>
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
                snapshots.current.remove(reportPost.id);
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
      <PhotoViewer
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onOpenChangeComplete={(open) => {
          if (!open && !lightboxOpen) setLightbox(null);
        }}
        className="lightbox"
        title={lightbox?.name || 'Фотография'}
        src={lightbox ? '/api/media/' + lightbox.id : ''}
        alt={lightbox?.name || ''}
      />
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
                  snapshots.current.remove(deleteId);
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
          className="toast"
          data-leaving={toastLeaving || undefined}
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
                  setToastLeaving(true);
                  await latestRefresh.current();
                }, 'post:' + undoHidden.id)
              }
            >
              Отменить
            </button>
          )}
          <button
            aria-label="Закрыть уведомление"
            onClick={() => setToastLeaving(true)}
          >
            <X size={15} />
          </button>
        </output>
      )}
    </div>
  );
}
