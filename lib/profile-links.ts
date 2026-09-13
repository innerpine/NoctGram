export const PROFILE_NAVIGATE = 'noctgram:profile-navigate';
type LinkTargets = {
  id: string;
  handle: string;
  group: string;
  invite: string;
  roomId: string;
};
export type ProfileTarget = {
  [Key in keyof LinkTargets]: Pick<LinkTargets, Key> &
    Partial<Record<Exclude<keyof LinkTargets, Key>, never>>;
}[keyof LinkTargets];
export type ProfileNavigation = ProfileTarget & { onNavigated?: () => void };
export function profileHref(target: ProfileTarget) {
  const query: Record<string, string> = target.id
    ? { profile: target.id }
    : target.group
      ? { group: target.group }
      : target.invite
        ? { invite: target.invite }
        : target.roomId
          ? { room: target.roomId }
          : { handle: target.handle || '' };
  return '/?' + new URLSearchParams(query);
}

/** Only app links from this exact origin can become in-app navigation. */
export function profileTargetFromURL(
  href: string,
  origin: string,
): ProfileTarget | null {
  try {
    const url = new URL(href, origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== new URL(origin).origin ||
      url.username ||
      url.password ||
      url.pathname !== '/'
    )
      return null;
    const keys = ['profile', 'handle', 'group', 'invite', 'room'].filter(
      (key) => url.searchParams.has(key),
    );
    if (keys.length !== 1 || url.searchParams.getAll(keys[0]).length !== 1)
      return null;
    const key = keys[0],
      value = url.searchParams.get(key)!;
    if (key === 'handle' || key === 'group') {
      if (!/^[a-z0-9_]{4,24}$/i.test(value)) return null;
      return key === 'handle'
        ? { handle: value.toLowerCase() }
        : { group: value.toLowerCase() };
    }
    if (key === 'invite')
      return /^[a-f0-9]{64}$/.test(value) ? { invite: value } : null;
    if (!/^[a-z0-9_:.-]{1,100}$/i.test(value)) return null;
    return key === 'room' ? { roomId: value } : { id: value };
  } catch {
    return null;
  }
}

export type MentionPart = { text: string; handle?: string; href?: string };
export function mentionParts(text: string): MentionPart[] {
  const pattern =
    /https?:\/\/[^\s<>"\p{Cc}]+|(?<![\w/])\/\?(?:profile|handle|group|invite|room)=[^\s<>"\p{Cc}]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?<![\p{L}\p{N}_/@.+-])@[a-z0-9_]{4,24}(?![\p{L}\p{N}_])/giu;
  const parts: MentionPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    if (
      !raw.startsWith('@') &&
      !/^https?:\/\//i.test(raw) &&
      !raw.startsWith('/?')
    )
      continue;
    // Sentence punctuation stays outside the clickable URL. A closing bracket
    // belongs to a URL only when the matching opening bracket is also present.
    let value = raw;
    if (!raw.startsWith('@')) {
      value = value.replace(/[.,!?:;\u2026\u00bb\u201d]+$/u, '');
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
      if (value.startsWith('/?')) {
        if (!profileTargetFromURL(value, 'https://noctgram.invalid')) continue;
      } else {
        try {
          const url = new URL(value);
          if (url.username || url.password) continue;
        } catch {
          continue;
        }
      }
    }
    if (match.index > cursor)
      parts.push({ text: text.slice(cursor, match.index) });
    parts.push(
      value.startsWith('@')
        ? { text: value, handle: value.slice(1).toLowerCase() }
        : { text: value, href: value },
    );
    cursor = match.index + value.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
