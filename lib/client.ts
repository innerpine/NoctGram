import type { Appearance } from './appearance';
export type Person = Appearance & {
  id: string;
  name: string;
  avatar: string;
  handle: string;
  followed?: number;
  lastText?: string;
  lastTime?: number;
  unread?: number;
  lastSeen?: number;
  kind?: string;
  ownerId?: string | null;
};
export type ConnectionsPage = {
  people: Person[];
  hasMore: boolean;
  nextCursor: string | null;
};
export type AccountRestriction = {
  eventId: string;
  mode: 'read_only' | 'blocked';
  reason: string;
  expiresAt: number | null;
  created: number;
};
export type AccountAppeal = {
  id: string;
  eventId: string;
  status: string;
  text: string;
  reviewNote: string;
  created: number;
};
export type Profile = Person & {
  channelRole?: 'owner' | 'admin' | 'editor' | null;
  canPublish?: boolean;
  canEditProfile?: boolean;
  canManagePosts?: boolean;
  canManageMembers?: boolean;
  restriction?: AccountRestriction | null;
  appeal?: AccountAppeal | null;
  canModerate?: boolean;
  blocked?: boolean;
  blockedAt?: number;
  pinnedPostId?: string | null;
  bio: string;
  cover: string;
  handles: string[];
  created: number;
  followers: number;
  following: number;
  postCount: number;
};
export type Media = { id: string; type: string; name: string; url?: string };
export type Post = Appearance & {
  publishAt?: number;
  publisherId?: string;
  cancelledAt?: number;
  canManagePosts?: boolean;
  id: string;
  userId: string;
  name: string;
  avatar: string;
  handle: string;
  text: string;
  media: Media[];
  poll: string[];
  created: number;
  likes: number;
  comments: number;
  liked: number;
  saved: number;
  pinned?: number;
  kind?: string;
  ownerId?: string | null;
  views?: number;
  stars?: number;
  mySupport?: number;
  adult?: number;
  code?: string;
  codeLang?: string;
  voted: number | null;
  votes: { option: number; count: number }[];
};
export type Comment = Appearance & {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  handle: string;
  text: string;
  created: number;
};
export type Message = {
  id: string;
  sender: string;
  recipient: string;
  text: string;
  created: number;
  read: number;
};
export const welcome: Post[] = [
  {
    id: 'welcome',
    userId: 'noctgram',
    name: 'Noctgram',
    avatar: '',
    handle: 'noctgram',
    text: 'У каждого времени суток есть своё настроение. У этой ночи теперь есть своё место.\n\nДелись мыслями, фотографиями и моментами. Начинай разговоры и находи своих. Добро пожаловать в Noctgram ☾',
    media: [],
    poll: [],
    created: 1788609600000,
    likes: 0,
    comments: 0,
    liked: 0,
    saved: 0,
    voted: null,
    votes: [],
  },
  {
    id: 'first-poll',
    userId: 'noctgram',
    name: 'Noctgram',
    avatar: '',
    handle: 'noctgram',
    text: 'Что не даёт тебе уснуть?',
    media: [],
    poll: [
      'Мысли обо всём',
      'Музыка и новые открытия',
      'Разговоры с близкими',
      'Просто люблю ночь',
    ],
    created: 1788609500000,
    likes: 0,
    comments: 0,
    liked: 0,
    saved: 0,
    voted: null,
    votes: [],
  },
];
export async function request<T>(query: string, body?: unknown): Promise<T> {
  const response = await fetch(
    '/api/social' + query,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { cache: 'no-store' },
  );
  const data = (await response.json()) as T & { error?: string; code?: string };
  if (data.code === 'ONBOARDING_REQUIRED' && typeof window !== 'undefined')
    window.location.replace('/welcome');
  if (
    !response.ok &&
    typeof window !== 'undefined' &&
    ['ACCOUNT_BLOCKED', 'READ_ONLY'].includes(data.code || '')
  )
    window.dispatchEvent(new Event('noctgram:restriction'));
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Войдите в Noctgram, чтобы продолжить.'
        : data.error || 'Не удалось загрузить данные',
    );
  return data;
}
export async function upload(file: File): Promise<Media> {
  if (file.size > 25 * 1024 * 1024)
    throw new Error('Максимальный размер файла — 25 МБ');
  const data = new FormData();
  data.set('file', file);
  const r = await fetch('/api/upload', { method: 'POST', body: data });
  const body = (await r.json()) as Media & { error?: string; code?: string };
  if (!r.ok && ['ACCOUNT_BLOCKED', 'READ_ONLY'].includes(body.code || ''))
    window.dispatchEvent(new Event('noctgram:restriction'));
  if (!r.ok) throw new Error(body.error || 'Не удалось загрузить файл');
  return body;
}

export type StarTransaction = Appearance & {
  id: string;
  sender: string | null;
  recipient: string;
  postId: string | null;
  postText: string;
  amount: number;
  kind: string;
  created: number;
  name: string;
  avatar: string;
};
export type Wallet = {
  balance: number;
  testMode: boolean;
  received: number;
  sent: number;
  transactions: StarTransaction[];
};
