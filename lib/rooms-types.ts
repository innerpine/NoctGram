import type { SecretPublicKey } from './secret-format';

export type RoomKind = 'group' | 'secret';
export type RoomRole = 'owner' | 'admin' | 'member';
export type RoomMember = {
  userId: string;
  name: string;
  avatar: string;
  handle: string;
  role: RoomRole;
  status: 'active';
  publicKey: SecretPublicKey | null;
  joinedAt: number;
};
export type RoomMessage = {
  reactions?: import('./message-reactions').MessageReaction[];
  giveawayId?: string | null;
  id: string;
  roomId: string;
  sender: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  ciphertext: string | null;
  replyTo: string | null;
  replyText?: string | null;
  replyName?: string | null;
  replyUnavailable?: boolean;
  created: number;
  deletedAt: number;
};
export type RoomPreview = {
  id: string;
  kind: RoomKind;
  ownerId: string;
  name: string;
  description: string;
  avatar: string;
  username: string | null;
  visibility: 'public' | 'private';
  created: number;
  updatedAt: number;
  memberCount: number;
  joined: boolean;
  label: 'Группа' | 'Секретный чат';
};
export type RoomSummary = Omit<RoomPreview, 'joined'> & {
  role: RoomRole;
  archivedAt: number;
  muted: boolean;
  unread: number;
  lastMessage: {
    id: string;
    text: string;
    created: number;
    sender: string;
  } | null;
};
export type RoomDetail = RoomSummary & {
  me: string;
  members: RoomMember[];
  messages: RoomMessage[];
  nextCursor: string | null;
  pageCursor?: string | null;
  canSend: boolean;
};
