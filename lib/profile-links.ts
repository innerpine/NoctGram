export const PROFILE_NAVIGATE = 'noctgram:profile-navigate';
export type ProfileTarget =
  | { id: string; handle?: string }
  | { handle: string; id?: never };
export type ProfileNavigation = ProfileTarget & { onNavigated?: () => void };
export function profileHref(target: ProfileTarget) {
  return (
    '/?' +
    new URLSearchParams({
      profile:
        target.handle?.replace(/^@/, '').toLowerCase() || target.id || '',
    })
  );
}
export function mentionParts(
  text: string,
): { text: string; handle?: string }[] {
  const pattern =
    /https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?<![\p{L}\p{N}_/@.+-])@[a-z0-9_]{4,24}(?![\p{L}\p{N}_])/giu;
  const parts: { text: string; handle?: string }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (!match[0].startsWith('@')) continue;
    if (match.index > cursor)
      parts.push({ text: text.slice(cursor, match.index) });
    parts.push({ text: match[0], handle: match[0].slice(1).toLowerCase() });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
