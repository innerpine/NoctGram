'use client';
import { createContext, useContext, type Context } from 'react';
import type { MusicLink } from './music-links';
import type { MusicRoom } from './use-music-room';

export type MusicContextValue = {
  play: (link: MusicLink, queue?: MusicLink[]) => void;
  currentUrl: string;
  playing: boolean;
  stop: () => void;
  room?: MusicRoom;
};

// Vite can refresh a consumer before the root layout. Keep the context identity
// across client module reloads so both still talk to the mounted audio provider.
// Only the context object is retained, never a user's playback state or tokens.
const contextKey = Symbol.for('noctgram.music-context');
const playbackKey = Symbol.for('noctgram.music-playback-context');
export type MusicPlayback = {
  ready: boolean;
  position: number;
  duration: number;
};
type MusicWindow = Window & {
  [contextKey]?: Context<MusicContextValue | null>;
  [playbackKey]?: Context<MusicPlayback | null>;
};
const client = typeof window === 'undefined' ? null : (window as MusicWindow);
export const MusicContext = client
  ? (client[contextKey] ??= createContext<MusicContextValue | null>(null))
  : createContext<MusicContextValue | null>(null);
export const MusicPlaybackContext = client
  ? (client[playbackKey] ??= createContext<MusicPlayback | null>(null))
  : createContext<MusicPlayback | null>(null);
export function useMusicPlayback() {
  return useContext(MusicPlaybackContext);
}

export function useMusic() {
  return useContext(MusicContext);
}
