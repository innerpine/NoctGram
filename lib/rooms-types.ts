import type { SecretPublicKey } from './secret-format';
import type { ChatAttachment } from './chat-files';

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
  created: number;
  deletedAt: number;
  attachments?: ChatAttachment[];
  reply?: RoomMessageReply;
  forwardedName?: string;
  forwardedFrom?: string | null;
  postShare?: { id: string };
  // Forum topic id; absent for «Общее».
  topicId?: string;
  // The thread this reply belongs to, and how many replies a message has.
  threadRootId?: string;
  replies?: number;
};
export type RoomMessageReply = {
  id: string;
  sender: string;
  name: string;
  text: string;
  unavailable: boolean;
  quote?: string;
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
  // Groups with topics; unread then counts topics with new messages.
  forum: boolean;
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
  canSend: boolean;
  topics?: import('./room-topic-shared').RoomTopic[];
  // The topic the messages belong to ('general' or an id), when filtered.
  topic?: string;
  // The first message of a thread, when reading its replies.
  threadRoot?: RoomMessage;
  // Set when the history was opened around this message.
  around?: string;
};
