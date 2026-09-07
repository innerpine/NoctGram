export type SoundCloudSound = {
  id: number;
  title: string;
  permalink_url: string;
  duration: number;
  artwork_url?: string;
  user?: { username: string; permalink_url: string };
};
export type Widget = {
  bind(
    event: string,
    listener: (event?: { currentPosition?: number }) => void,
  ): void;
  unbind(event: string): void;
  load(url: string, options: Record<string, unknown>): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setVolume(value: number): void;
  next(): void;
  prev(): void;
  getCurrentSound(callback: (sound: SoundCloudSound | null) => void): void;
  getSounds(callback: (sounds: SoundCloudSound[]) => void): void;
  getCurrentSoundIndex(callback: (index: number) => void): void;
  getDuration(callback: (ms: number) => void): void;
};
type SoundCloud = {
  Widget: ((frame: HTMLIFrameElement) => Widget) & {
    Events: Record<string, string>;
  };
};
declare global {
  interface Window {
    SC?: SoundCloud;
  }
}
let pending: Promise<SoundCloud> | null = null;
export function loadSoundCloudWidget(): Promise<SoundCloud> {
  if (window.SC) return Promise.resolve(window.SC);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.async = true;
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      pending = null;
      reject(new Error('SoundCloud не отвечает. Попробуйте ещё раз.'));
    };
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (window.SC) resolve(window.SC);
      else fail();
    };
    document.head.appendChild(script);
  });
  return pending;
}
