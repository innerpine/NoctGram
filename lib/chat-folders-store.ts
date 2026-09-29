'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { chatRequest } from './chat-client';
import { FOLDER_LIMIT, type ChatFolder } from './chat-folders-filter';

export type FolderDraft = Omit<ChatFolder, 'id' | 'position'> & { id?: string };
type State = {
  owner: string;
  folders: ChatFolder[];
  limit: number;
  loaded: boolean;
};
const empty: State = {
  owner: '',
  folders: [],
  limit: FOLDER_LIMIT,
  loaded: false,
};
let state = empty;
let latest: symbol | null = null;
const listeners = new Set<() => void>();
const publish = (next: State) => {
  state = next;
  listeners.forEach((listener) => listener());
};
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
// One copy of the viewer's folders for the tabs and every chat row menu.
export async function loadFolders(owner: string) {
  if (!owner) return;
  const ticket = Symbol(owner);
  latest = ticket;
  const data = await chatRequest<{ folders: ChatFolder[]; limit: number }>(
    '/api/chat-folders?actor=' + encodeURIComponent(owner),
    { cache: 'no-store' },
  );
  // Only the latest request wins, so a slow answer cannot bring back another
  // account's folders.
  if (latest === ticket)
    publish({ owner, folders: data.folders, limit: data.limit, loaded: true });
}
async function post(owner: string, body: Record<string, unknown>) {
  const result = await chatRequest<{ id?: string }>('/api/chat-folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, actor: owner }),
    signal: AbortSignal.timeout(20000),
  });
  await loadFolders(owner);
  return result;
}
export const saveChatFolder = (owner: string, folder: FolderDraft) =>
  post(owner, { action: 'save', ...folder });
export const deleteChatFolder = (owner: string, id: string) =>
  post(owner, { action: 'delete', id });
export const reorderChatFolders = (owner: string, ids: string[]) =>
  post(owner, { action: 'reorder', ids });
// Adds a chat to a folder's chosen chats and takes it off its exclusions.
export function addChatToFolder(
  owner: string,
  folder: ChatFolder,
  key: string,
) {
  const { position, ...rest } = folder;
  void position;
  return saveChatFolder(owner, {
    ...rest,
    includePeers: [...new Set([...folder.includePeers, key])],
    excludePeers: folder.excludePeers.filter((peer) => peer !== key),
  });
}
export const currentFolders = () => state.folders;
export function useChatFolders(owner: string) {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => empty,
  );
  useEffect(() => {
    if (owner && (state.owner !== owner || !state.loaded))
      void loadFolders(owner).catch(() => {});
  }, [owner]);
  return snapshot.owner === owner ? snapshot : { ...empty, owner };
}
