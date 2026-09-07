'use client';
import { createContext, useContext, type Context } from 'react';
import type { MusicLink } from './music-links';

export type MusicContextValue = {
  play: (link: MusicLink, queue?: MusicLink[]) => void;
  currentUrl: string;
  playing: boolean;
  stop: () => void;
};

// Vite can refresh a consumer before the root layout. Keep the context identity
// across client module reloads so both still talk to the mounted audio provider.
// Only the context object is retained, never a user's playback state or tokens.
const contextKey = Symbol.for('noctgram.music-context');
type MusicWindow = Window & {
  [contextKey]?: Context<MusicContextValue | null>;
};
const client = typeof window === 'undefined' ? null : (window as MusicWindow);
export const MusicContext = client
  ? (client[contextKey] ??= createContext<MusicContextValue | null>(null))
  : createContext<MusicContextValue | null>(null);

export function useMusic() {
  return useContext(MusicContext);
}
