import type { Message } from './client';
import type { ChatThemeState } from './chat-themes';

export type ChatSnapshot = {
  messages: Message[];
  theme: ChatThemeState;
  access: { allowed: boolean; blockedByMe: boolean };
};

/** Session memory only. Account changes also invalidate unfinished requests. */
export function createChatSnapshots() {
  const entries = new Map<string, ChatSnapshot>();
  const requests = new Map<string, number>();
  let owner = '',
    generation = 0,
    sequence = 0;
  return {
    reset(nextOwner: string) {
      if (owner === nextOwner) return;
      owner = nextOwner;
      generation++;
      entries.clear();
      requests.clear();
    },
    begin(peer: string) {
      const request = ++sequence;
      requests.set(peer, request);
      return { peer, generation, request };
    },
    get(peer: string, scope = generation) {
      if (scope !== generation) return;
      const entry = entries.get(peer);
      if (entry) {
        entries.delete(peer);
        entries.set(peer, entry);
      }
      return entry;
    },
    remove(peer: string) {
      entries.delete(peer);
      requests.delete(peer);
    },
    updateTheme(peer: string, theme: ChatThemeState) {
      const entry = entries.get(peer);
      if (entry && theme.revision >= entry.theme.revision)
        entries.set(peer, { ...entry, theme });
    },
    save(
      snapshot: ChatSnapshot,
      ticket: { peer: string; generation: number; request: number },
    ) {
      const peer = ticket.peer;
      if (
        !owner ||
        !peer ||
        ticket.generation !== generation ||
        requests.get(peer) !== ticket.request
      )
        return;
      const previous = entries.get(peer);
      const next =
        previous && previous.theme.revision > snapshot.theme.revision
          ? { ...snapshot, theme: previous.theme }
          : snapshot;
      entries.delete(peer);
      entries.set(peer, next);
      if (entries.size > 20) {
        const oldest = entries.keys().next().value!;
        entries.delete(oldest);
        requests.delete(oldest);
      }
      return next;
    },
  };
}
