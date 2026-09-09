export const MUSIC_SERVICES = ['soundcloud', 'yandex', 'youtube'] as const;
// Retain stored legacy tracks and connections; only these three services are offered in the UI.
export type MusicServiceId =
  | (typeof MUSIC_SERVICES)[number]
  | 'spotify'
  | 'vk'
  | 'deezer';
export type OAuthMusicService = 'soundcloud' | 'spotify';
export const SERVICE_NAMES: Record<MusicServiceId, string> = {
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  yandex: 'Яндекс Музыка',
  youtube: 'YouTube',
  vk: 'VK Музыка',
  deezer: 'Deezer',
};
export function oauthService(value: string): OAuthMusicService {
  if (value !== 'soundcloud' && value !== 'spotify')
    throw new Error('Unsupported music service');
  return value;
}
export type ServiceStatus = {
  provider: MusicServiceId;
  configured: boolean;
  status:
    | 'link_only'
    | 'unavailable'
    | 'setup_required'
    | 'disconnected'
    | 'connected'
    | 'expired';
  displayName?: string;
  profileUrl?: string;
};
export type ServicePlaylist = {
  id: string;
  provider: OAuthMusicService;
  title: string;
  url: string;
  artwork: string;
  trackCount: number;
  playable: boolean;
  imported?: boolean;
  localPlaylistId?: string | null;
  importedTrackCount?: number;
};
export type ServicePage = { items: ServicePlaylist[]; next: string | null };
