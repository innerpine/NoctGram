import { musicLabel, parseMusicLink, type MusicLink } from './music-links';

export type SoundCloudQueueEntry = {
  nativeIndex: number;
  track: MusicLink & { title: string; artist: string; artwork: string };
};

// Unavailable widget tracks can be id-only placeholders. Keep native indices
// while excluding them from the editable queue, so skip still selects the song.
export function soundCloudQueue(sounds: unknown): SoundCloudQueueEntry[] {
  if (!Array.isArray(sounds)) return [];
  const seen = new Set<string>();
  return sounds.flatMap((sound: unknown, nativeIndex) => {
    if (!sound || typeof sound !== 'object') return [];
    const value = sound as Record<string, unknown>;
    const link = parseMusicLink(value.permalink_url);
    if (
      !link ||
      link.provider !== 'soundcloud' ||
      link.kind !== 'track' ||
      seen.has(link.url)
    )
      return [];
    seen.add(link.url);
    const user = value.user as { username?: unknown } | null;
    return [
      {
        nativeIndex,
        track: {
          ...link,
          title:
            typeof value.title === 'string' && value.title.trim()
              ? value.title
              : musicLabel(link),
          artist: typeof user?.username === 'string' ? user.username : '',
          artwork:
            typeof value.artwork_url === 'string' ? value.artwork_url : '',
        },
      },
    ];
  });
}
