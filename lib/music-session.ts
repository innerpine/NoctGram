import { parseMusicLink, type MusicLink } from './music-links';

export const MUSIC_SESSION_KEY = 'noctgram:music-session';
export type SavedMusicTrack = MusicLink & {
  title: string;
  artist: string;
  artwork: string;
};
export type MusicSession = {
  version: 1;
  track: SavedMusicTrack;
  queue: SavedMusicTrack[];
  position: number;
  duration: number;
};
const milliseconds = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(value, 86400000))
    : 0;
const text = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.slice(0, limit) : '';
function track(value: unknown): SavedMusicTrack | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const link = parseMusicLink(data.url);
  if (!link || link.kind !== 'track') return null;
  let artwork = '';
  try {
    const url = new URL(text(data.artwork, 2000));
    if (url.protocol === 'https:' && !url.username && !url.password)
      artwork = url.href;
  } catch {
    /* Artwork is optional. */
  }
  return {
    ...link,
    ...(link.provider === 'spotify' &&
    ['file', 'spotify'].includes(String(data.playback))
      ? { playback: data.playback as 'file' | 'spotify' }
      : {}),
    title: text(data.title, 300),
    artist: text(data.artist, 200),
    artwork,
  };
}

/** Store public metadata only, never stream URLs, credentials or room state. */
export function musicSession(value: unknown): MusicSession | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.version !== 1) return null;
  const current = track(data.track);
  if (!current) return null;
  const queue = (Array.isArray(data.queue) ? data.queue.slice(0, 200) : [])
    .map(track)
    .filter((item): item is SavedMusicTrack => !!item)
    .map((item) => (item.url === current.url ? current : item));
  if (!queue.some((item) => item.url === current.url)) queue.push(current);
  const duration = milliseconds(data.duration);
  return {
    version: 1,
    track: current,
    queue,
    duration,
    position: duration ? Math.min(milliseconds(data.position), duration) : 0,
  };
}
export function readMusicSession(value: string | null): MusicSession | null {
  try {
    return value && value.length <= 700000
      ? musicSession(JSON.parse(value))
      : null;
  } catch {
    return null;
  }
}
