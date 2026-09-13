import type { MusicTrack } from './music-links';

export type PlaylistSummary = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  created: number;
  updatedAt: number;
  trackCount: number;
  memberCount: number;
  artwork: string | null;
  status: 'accepted' | 'invited';
};
export type PlaylistDetail = {
  id: string;
  name: string;
  ownerId: string;
  me: string;
  tracks: MusicTrack[];
  members: {
    userId: string;
    name: string;
    avatar: string;
    handle: string;
    status: 'accepted' | 'invited';
    listening: number;
  }[];
  playback: {
    trackId: string | null;
    playing: number;
    repeatOne: number;
    positionMs: number;
    durationMs: number;
    playbackAt: number;
    revision: number;
  };
  listenSession: string;
  serverTime: number;
};
export type TrackPlaylists = {
  playlists: (PlaylistSummary & { savedTrackId: string | null })[];
};
export function roomPosition(
  playback: PlaylistDetail['playback'],
  now: number,
) {
  const position =
    playback.positionMs +
    (playback.playing ? Math.max(0, now - playback.playbackAt) : 0);
  return Math.max(
    0,
    playback.durationMs > 0
      ? Math.min(position, playback.durationMs)
      : position,
  );
}
export async function playlistRequest<T>(
  query = '',
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch('/api/music/playlists' + query, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || 'Не удалось обновить плейлист'),
      { status: response.status },
    );
  return data;
}
