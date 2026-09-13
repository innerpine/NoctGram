import type { Message } from './client';

/** Retain only confirmed deletions for a short exit, even if polling refreshes
 * the list mid-animation. A stale snapshot cannot resurrect a deleted row. */
export function createChatRemoval(list: HTMLElement, update: () => void) {
  const removed = new Set<string>();
  const leaving = new Map<string, Message>();
  const running = new Map<
    string,
    { animation: Animation; timer: number; row: HTMLElement; gap: number }
  >();
  const host = list.ownerDocument.defaultView!;
  let disposed = false;
  const clearAnimation = (id: string) => {
    const item = running.get(id);
    if (!item) return;
    running.delete(id);
    host.clearTimeout(item.timer);
    item.animation.onfinish = null;
    item.animation.oncancel = null;
    item.animation.cancel();
  };
  const finish = (id: string) => {
    if (disposed) return;
    const item = running.get(id);
    if (item) {
      // Keep the finished row collapsed until React commits its removal.
      item.row.style.height = '0px';
      item.row.style.opacity = '0';
      item.row.style.marginBottom = -item.gap + 'px';
    }
    leaving.delete(id);
    clearAnimation(id);
    update();
  };
  return {
    has: (id: string) => removed.has(id),
    visible(messages: Message[]) {
      if (!removed.size) return messages;
      return [
        ...messages.filter((message) => !removed.has(message.id)),
        ...leaving.values(),
      ].sort(
        (a, b) =>
          a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    },
    remove(messages: Message[]) {
      if (disposed) return;
      const rows = Array.from(
        list.querySelectorAll<HTMLElement>(
          ':scope > [data-chat-message-id], :scope > .chat-history-content > [data-chat-message-id]',
        ),
      );
      const reduced =
        host.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        list.ownerDocument.hidden;
      const gap = Number.parseFloat(host.getComputedStyle(list).rowGap) || 0;
      let changed = false;
      for (const message of messages) {
        if (removed.has(message.id)) continue;
        removed.add(message.id);
        changed = true;
        const row = rows.find(
          (node) => node.dataset.chatMessageId === message.id,
        );
        if (!row || reduced || typeof row.animate !== 'function') continue;
        const height = row.getBoundingClientRect().height;
        leaving.set(message.id, message);
        try {
          const animation = row.animate(
            [
              {
                height: height + 'px',
                opacity: 1,
                transform: 'scale(1)',
                marginBottom: '0px',
              },
              {
                height: height + 'px',
                opacity: 0,
                transform: 'translateY(-3px) scale(.98)',
                marginBottom: '0px',
                offset: 0.42,
              },
              {
                height: '0px',
                opacity: 0,
                transform: 'translateY(-3px) scale(.98)',
                marginBottom: -gap + 'px',
              },
            ],
            {
              duration: 240,
              delay: 100,
              easing: 'cubic-bezier(.2,.75,.25,1)',
              fill: 'both',
            },
          );
          running.set(message.id, {
            animation,
            timer: host.setTimeout(() => finish(message.id), 420),
            row,
            gap,
          });
          animation.onfinish = () => finish(message.id);
          animation.oncancel = () => finish(message.id);
        } catch {
          leaving.delete(message.id);
        }
      }
      if (changed) update();
    },
    dispose() {
      disposed = true;
      for (const id of running.keys()) clearAnimation(id);
      leaving.clear();
      removed.clear();
    },
  };
}
