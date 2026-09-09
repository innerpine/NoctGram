export type MusicProviderId = 'soundcloud' | 'spotify' | 'youtube';
export function musicProviderName(provider?: string) {
  return provider === 'youtube'
    ? 'YouTube'
    : provider === 'spotify'
      ? 'Spotify'
      : 'SoundCloud';
}
export type MusicLink = {
  url: string;
  kind: 'track' | 'playlist';
  provider: MusicProviderId;
  playback?: 'file' | 'spotify' | 'soundcloud';
};
export type MusicTrack = MusicLink & {
  id: string;
  title: string;
  artist: string;
  artwork: string;
  authorUrl: string;
  durationMs?: number;
  audioUrl?: string | null;
  shared?: number;
  listeners?: number;
};

// Only public, canonical links are accepted. Never forward private-link tokens.
export function parseMusicLink(value: unknown): MusicLink | null {
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const u = new URL(value.trim());
    if (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'music.youtube.com',
        'youtu.be',
      ].includes(u.hostname)
    ) {
      const id =
        u.hostname === 'youtu.be'
          ? u.pathname.match(/^\/([\w-]{11})\/?$/)?.[1]
          : u.pathname === '/watch'
            ? u.searchParams.get('v')
            : u.pathname.match(
                /^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/,
              )?.[1];
      return id && /^[\w-]{11}$/.test(id)
        ? {
            url: 'https://www.youtube.com/watch?v=' + id,
            kind: 'track',
            provider: 'youtube',
          }
        : null;
    }
    if (
      u.protocol === 'https:' &&
      u.hostname === 'open.spotify.com' &&
      !u.username &&
      !u.password &&
      !u.port
    ) {
      const match = u.pathname.match(
        /^\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]{22})\/?$/,
      );
      return match
        ? {
            url: 'https://open.spotify.com/track/' + match[1],
            kind: 'track',
            provider: 'spotify',
          }
        : null;
    }
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      !['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(
        u.hostname,
      ) ||
      u.searchParams.has('secret_token')
    )
      return null;
    const parts = u.pathname.replace(/\/$/, '').split('/').slice(1);
    if (!parts.every((p) => /^[a-zA-Z0-9_-]+$/.test(p))) return null;
    if (
      [
        'discover',
        'search',
        'charts',
        'you',
        'settings',
        'upload',
        'stream',
      ].includes(parts[0])
    )
      return null;
    const kind =
      parts.length === 2 &&
      ![
        'sets',
        'likes',
        'tracks',
        'comments',
        'reposts',
        'popular-tracks',
        'albums',
      ].includes(parts[1])
        ? 'track'
        : parts.length === 3 && parts[1] === 'sets'
          ? 'playlist'
          : null;
    return kind
      ? {
          url: 'https://soundcloud.com/' + parts.join('/'),
          kind,
          provider: 'soundcloud',
        }
      : null;
  } catch {
    return null;
  }
}
export function findMusicLink(text: string) {
  for (const match of text.matchAll(/https:\/\/[^\s<>]+/g)) {
    const link = parseMusicLink(match[0].replace(/[),.!?;]+$/, ''));
    if (link) return link;
  }
  return null;
}
export function musicLabel(link: MusicLink) {
  if (link.provider === 'youtube') return 'Трек YouTube';
  if (link.provider === 'spotify') return 'Трек Spotify';
  return decodeURIComponent(link.url.split('/').at(-1) || '').replaceAll(
    '-',
    ' ',
  );
}
export function formatMusicTime(ms: number) {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export async function musicRequest<T>(
  action: string,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<T> {
  const response = await fetch(
    '/api/music' +
      (body ? '' : '?' + new URLSearchParams({ ...query, action })),
    {
      signal: AbortSignal.timeout(15000),
      ...(body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, action }),
          }
        : { cache: 'no-store' }),
    },
  );
  const data = (await response.json()) as T & { error?: string; code?: string };
  if (!response.ok) {
    if (['ACCOUNT_BLOCKED', 'READ_ONLY'].includes(data.code || ''))
      window.dispatchEvent(new Event('noctgram:restriction'));
    throw new Error(data.error || 'Не удалось загрузить музыку');
  }
  return data;
}
