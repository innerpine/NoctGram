import type { ChatAttachment } from './chat-files';

export const chatLibraryKinds = [
  'photos',
  'videos',
  'files',
  'audio',
  'links',
] as const;
export type ChatLibraryKind = (typeof chatLibraryKinds)[number];
export type ChatLibraryStats = {
  messages: number;
  sent: number;
  received: number;
  first: number | null;
  photos: number;
  videos: number;
  files: number;
  audio: number;
};
export type ChatLibraryItem = {
  id: string;
  messageId: string;
  sender: string;
  created: number;
  file?: ChatAttachment;
  url?: string;
  text?: string;
};
export type ChatLibraryPage = { items: ChatLibraryItem[]; next: string | null };

export function chatLinks(text: string): string[] {
  const links = new Set<string>();
  // Exclude control bytes from clickable URLs.
  for (const match of text.matchAll(
    // eslint-disable-next-line no-control-regex
    /(?:https?:\/\/|www\.)[^\s<>"\u0000-\u001f]+/gi,
  )) {
    let value = match[0].replace(/[.,!?:;…]+$/u, '');
    // Keep balanced URL parentheses, but drop prose wrapped around a link.
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ]) {
      while (
        value.endsWith(close) &&
        value.split(close).length > value.split(open).length
      )
        value = value.slice(0, -1);
    }
    try {
      const url = new URL(/^www\./i.test(value) ? 'https://' + value : value);
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        url.hostname &&
        !url.username &&
        !url.password
      )
        links.add(url.href);
    } catch {
      /* An incomplete link is ordinary message text. */
    }
  }
  return [...links];
}
