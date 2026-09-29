import type { RoomMessage } from './rooms-types';
import type { QueuedSubmission } from './antispam-types';
import type { ChatDraft } from './chat-outbox';
import { roomAction } from './rooms-client';

export type RoomOutgoing = {
  roomId: string;
  // The forum topic the message is sent to, if any.
  topic?: string;
  status: 'sending' | 'sent' | 'failed' | 'queued';
  error?: string;
  // Moderation notice for a message held by anti-spam review.
  notice?: string;
  message: RoomMessage;
};
export type RoomSendBody = {
  actor: string;
  action: 'send';
  id: string;
  key: string;
  text: string;
  attachments: string[];
  replyTo: string | null;
  quote?: string;
  // Forum topic of the message: 'general' or a topic id.
  topic?: string;
  sticker?: string;
};
type Send = (body: RoomSendBody) => Promise<{ id: string } | QueuedSubmission>;
type Author = { id: string; name: string; avatar: string };

// Group messages use the client key as their ID, so the optimistic copy and
// the stored one share an identity. Like direct chats, an unfinished send
// survives leaving the conversation, and retries always reuse the same key.
export function createRoomOutbox(send: Send) {
  let entries: RoomOutgoing[] = [];
  const listeners = new Set<() => void>();
  const active = new Set<string>();
  let lastCreated = 0;
  const publish = () => listeners.forEach((listener) => listener());
  const update = (id: string, patch: Partial<RoomOutgoing>) => {
    if (!entries.some((entry) => entry.message.id === id)) return;
    entries = entries.map((entry) =>
      entry.message.id === id ? { ...entry, ...patch } : entry,
    );
    publish();
  };
  const transmit = async (entry: RoomOutgoing) => {
    const { message, roomId } = entry;
    try {
      const result = await send({
        actor: message.sender,
        action: 'send',
        id: roomId,
        key: message.id,
        text: message.text,
        attachments: message.attachments?.map((file) => file.id) ?? [],
        replyTo: message.replyTo,
        ...(message.reply?.quote ? { quote: message.reply.quote } : {}),
        ...(entry.topic ? { topic: entry.topic } : {}),
        ...(message.sticker ? { sticker: message.sticker } : {}),
      });
      if ('queued' in result)
        update(message.id, {
          status: 'queued',
          notice: result.notice,
          error: undefined,
        });
      else if (result.id !== message.id)
        throw new Error('Не удалось подтвердить отправку');
      else update(message.id, { status: 'sent', error: undefined });
    } catch (error) {
      update(message.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Не удалось отправить',
      });
    } finally {
      active.delete(roomId + ':' + message.sender);
      pump(roomId, message.sender);
    }
  };
  const pump = (roomId: string, sender: string) => {
    const lane = roomId + ':' + sender;
    if (active.has(lane)) return;
    const next = entries.find(
      (entry) =>
        entry.roomId === roomId &&
        entry.message.sender === sender &&
        entry.status === 'sending',
    );
    if (!next) return;
    active.add(lane);
    void transmit(next);
  };
  return {
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => entries,
    enqueue(
      author: Author,
      roomId: string,
      draft: ChatDraft,
      context: { topic?: string; thread?: RoomMessage } = {},
    ) {
      const id = crypto.randomUUID();
      lastCreated = Math.max(Date.now(), lastCreated + 1);
      // In a thread, a message without its own reply answers the thread root.
      const root = context.thread;
      const reply =
        draft.reply ??
        (root
          ? {
              id: root.id,
              sender: root.sender,
              name: root.senderName,
              text: root.text || 'Сообщение',
              unavailable: false,
            }
          : undefined);
      entries = [
        ...entries,
        {
          roomId,
          ...(context.topic ? { topic: context.topic } : {}),
          status: 'sending',
          message: {
            id,
            roomId,
            sender: author.id,
            senderName: author.name,
            senderAvatar: author.avatar,
            text: draft.text.trim(),
            ciphertext: null,
            replyTo: reply?.id ?? null,
            created: lastCreated,
            deletedAt: 0,
            attachments: draft.attachments?.map((file) => ({ ...file })) ?? [],
            reply: reply ? { ...reply } : undefined,
            ...(draft.sticker ? { sticker: draft.sticker } : {}),
            ...(context.topic && context.topic !== 'general'
              ? { topicId: context.topic }
              : {}),
            ...(root ? { threadRootId: root.threadRootId || root.id } : {}),
          },
        },
      ];
      publish();
      pump(roomId, author.id);
      return id;
    },
    retry(id: string, sender: string) {
      const entry = entries.find(
        (item) => item.message.id === id && item.message.sender === sender,
      );
      if (!entry || entry.status !== 'failed') return;
      update(id, { status: 'sending', error: undefined });
      pump(entry.roomId, sender);
    },
    // Removes a held message once its moderation notice has been shown.
    dismiss(id: string) {
      const next = entries.filter((entry) => entry.message.id !== id);
      if (next.length === entries.length) return;
      entries = next;
      publish();
    },
    acknowledge(roomId: string, messages: RoomMessage[]) {
      const ids = new Set(messages.map((message) => message.id));
      const next = entries.filter(
        (entry) => entry.roomId !== roomId || !ids.has(entry.message.id),
      );
      if (next.length === entries.length) return;
      entries = next;
      publish();
    },
  };
}

export const roomOutbox = createRoomOutbox((body) =>
  roomAction<{ id: string } | QueuedSubmission>(body),
);
export const emptyRoomOutbox: RoomOutgoing[] = [];
export function mergeRoomOutgoing(
  messages: RoomMessage[],
  outgoing: RoomOutgoing[],
) {
  const ids = new Set(messages.map((message) => message.id));
  return [
    ...messages,
    ...outgoing
      .filter((entry) => entry.status !== 'queued' && !ids.has(entry.message.id))
      .map((entry) => entry.message),
  ];
}
