import type { Message } from './client';
import { chatRequest } from './chat-client';

export type ChatDraft = Pick<Message, 'text' | 'attachments' | 'reply'>;
export type OutgoingMessage = {
  message: Message;
  key: string;
  status: 'sending' | 'sent' | 'failed';
  error?: string;
};

type Send = (body: {
  action: 'message';
  id: string;
  text: string;
  attachments: string[];
  key: string;
  replyTo: string | null;
  expectedSender: string;
}) => Promise<{ id: string }>;

// Session memory keeps an unfinished send alive when its conversation unmounts.
// No background retries: an explicit retry always reuses the original request.
export function createChatOutbox(send: Send) {
  let entries: OutgoingMessage[] = [];
  const listeners = new Set<() => void>();
  const active = new Set<string>();
  let lastCreated = 0;
  const publish = () => listeners.forEach((listener) => listener());
  const update = (id: string, patch: Partial<OutgoingMessage>) => {
    if (!entries.some((entry) => entry.message.id === id)) return;
    entries = entries.map((entry) =>
      entry.message.id === id ? { ...entry, ...patch } : entry,
    );
    publish();
  };
  const transmit = async (entry: OutgoingMessage) => {
    const { message, key } = entry;
    try {
      const result = await send({
        action: 'message',
        id: message.recipient,
        text: message.text,
        attachments: message.attachments?.map((file) => file.id) ?? [],
        key,
        replyTo: message.reply?.id ?? null,
        expectedSender: message.sender,
      });
      if (result.id !== message.id)
        throw new Error('Не удалось подтвердить отправку');
      update(message.id, { status: 'sent', error: undefined });
    } catch (error) {
      update(message.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Не удалось отправить',
      });
    } finally {
      active.delete(JSON.stringify([message.sender, message.recipient]));
      pump(message.sender, message.recipient);
    }
  };
  const pump = (sender: string, recipient: string) => {
    const conversation = JSON.stringify([sender, recipient]);
    if (active.has(conversation)) return;
    const next = entries.find(
      (entry) =>
        entry.message.sender === sender &&
        entry.message.recipient === recipient &&
        entry.status === 'sending',
    );
    if (!next) return;
    active.add(conversation);
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
    enqueue(sender: string, recipient: string, draft: ChatDraft) {
      const key = crypto.randomUUID();
      lastCreated = Math.max(Date.now(), lastCreated + 1);
      const entry: OutgoingMessage = {
        key,
        status: 'sending',
        message: {
          ...draft,
          text: draft.text.trim(),
          attachments: draft.attachments?.map((file) => ({ ...file })),
          reply: draft.reply ? { ...draft.reply } : undefined,
          id: `message:${sender}:${key}`,
          sender,
          recipient,
          created: lastCreated,
          read: 0,
        },
      };
      entries = [...entries, entry];
      publish();
      pump(sender, recipient);
      return entry.message.id;
    },
    retry(id: string, sender: string) {
      const entry = entries.find(
        (item) => item.message.id === id && item.message.sender === sender,
      );
      if (!entry || entry.status !== 'failed') return;
      update(id, { status: 'sending', error: undefined });
      pump(entry.message.sender, entry.message.recipient);
    },
    acknowledge(messages: Message[]) {
      const ids = new Set(messages.map((message) => message.id));
      const next = entries.filter((entry) => !ids.has(entry.message.id));
      if (next.length === entries.length) return;
      entries = next;
      publish();
    },
  };
}

export const chatOutbox = createChatOutbox((body) =>
  chatRequest('/api/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  }),
);
export const emptyOutbox: OutgoingMessage[] = [];
export function mergeOutgoing(
  messages: Message[],
  outgoing: OutgoingMessage[],
) {
  const ids = new Set(messages.map((message) => message.id));
  return [
    ...messages,
    ...outgoing
      .filter((entry) => !ids.has(entry.message.id))
      .map((entry) => entry.message),
  ];
}
