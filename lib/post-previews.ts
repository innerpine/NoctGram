import { chatRequest } from './chat-client';
import type { PostPreview } from './post-preview-server';

export type { PostPreview };
type Entry = { value: PostPreview | null; loaded: number };

// Shared posts in chats load through one batched request per animation frame
// of visible cards. Entries are per viewer; a hidden post resolves to null.
const TTL = 5 * 60_000,
  BATCH = 30;
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const queued = new Map<string, Set<string>>();
const inflight = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

const entryKey = (viewer: string, id: string) => viewer + '\n' + id;
function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}
async function load(viewer: string, ids: string[]) {
  try {
    const rows = await chatRequest<PostPreview[]>(
      '/api/social?action=postPreviews&ids=' +
        ids.map(encodeURIComponent).join(',') +
        '&actor=' +
        encodeURIComponent(viewer),
      { signal: AbortSignal.timeout(20000) },
    );
    const found = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids) {
      const key = entryKey(viewer, id);
      cache.set(key, { value: found.get(id) ?? null, loaded: Date.now() });
      inflight.delete(key);
      notify(key);
    }
  } catch {
    // Leave the cards loading-free: a later subscription retries.
    for (const id of ids) {
      const key = entryKey(viewer, id);
      inflight.delete(key);
      if (!cache.has(key)) cache.set(key, { value: null, loaded: 0 });
      notify(key);
    }
  }
}
function flush() {
  timer = null;
  for (const [viewer, ids] of queued) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += BATCH)
      void load(viewer, list.slice(i, i + BATCH));
  }
  queued.clear();
}
function request(viewer: string, id: string) {
  const key = entryKey(viewer, id);
  const entry = cache.get(key);
  if (inflight.has(key) || (entry && Date.now() - entry.loaded < TTL)) return;
  inflight.add(key);
  const ids = queued.get(viewer) ?? new Set<string>();
  ids.add(id);
  queued.set(viewer, ids);
  timer ??= setTimeout(flush, 16);
}
export function readPostPreview(viewer: string, id: string) {
  return cache.get(entryKey(viewer, id));
}
export function subscribePostPreview(
  viewer: string,
  id: string,
  listener: () => void,
) {
  const key = entryKey(viewer, id);
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  request(viewer, id);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(key);
  };
}
