// Chat folders, shared by the server and the chat list.
export const FOLDER_LIMIT = 10;
export const FOLDER_PREMIUM_LIMIT = 20;
export const FOLDER_PEER_LIMIT = 100;
export const FOLDER_PEER_PREMIUM_LIMIT = 200;
export const FOLDER_TITLE_LIMIT = 12;
export type ChatFolder = {
  id: string;
  title: string;
  emoji: string;
  position: number;
  includePersonal: boolean;
  includeGroups: boolean;
  includeSecret: boolean;
  excludeRead: boolean;
  excludeArchived: boolean;
  // 'person:<id>' or 'room:<id>'.
  includePeers: string[];
  excludePeers: string[];
};
export type FolderChat = {
  key: string;
  kind: 'person' | 'group' | 'secret';
  unread: number;
  archived: boolean;
};
export const folderPeerKey = (kind: 'person' | 'room', id: string) =>
  kind + ':' + id;
// Whether a chat belongs to a folder: chosen types or chats, minus excluded
// chats, and minus read or archived chats when the folder asks for that.
export function folderIncludes(folder: ChatFolder, chat: FolderChat) {
  if (folder.excludePeers.includes(chat.key)) return false;
  const typed =
    (chat.kind === 'person' && folder.includePersonal) ||
    (chat.kind === 'group' && folder.includeGroups) ||
    (chat.kind === 'secret' && folder.includeSecret);
  if (!typed && !folder.includePeers.includes(chat.key)) return false;
  if (folder.excludeRead && !chat.unread) return false;
  if (folder.excludeArchived && chat.archived) return false;
  return true;
}
