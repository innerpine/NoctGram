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
  skip(index: number): void;
  getCurrentSound(callback: (sound: SoundCloudSound | null) => void): void;
  getSounds(callback: (sounds: SoundCloudSound[]) => void): void;
  getCurrentSoundIndex(callback: (index: number) => void): void;
  getDuration(callback: (ms: number) => void): void;
  getPosition(callback: (ms: number) => void): void;
  isPaused(callback: (paused: boolean) => void): void;
};
// Widget events can be delayed or missed. Confirm playback without trusting a
// query started before a newer event, seek, or playback command.
export class SoundCloudStateMonitor {
  private stateRevision = 0;
  private positionRevision = 0;
  private request = 0;
  private pendingUntil = 0;
  private disposed = false;
  constructor(
    private widget: Pick<Widget, 'isPaused' | 'getPosition'>,
    private onPlaying: (playing: boolean) => void,
    private onPosition: (position: number) => void,
  ) {}
  invalidate() {
    this.stateRevision++;
    this.positionRevision++;
  }
  playing(value: boolean) {
    if (this.disposed) return;
    this.invalidate();
    this.onPlaying(value);
  }
  position(value: number) {
    if (this.disposed || !Number.isFinite(value) || value < 0) return;
    this.positionRevision++;
    this.onPosition(value);
  }
  refresh() {
    const now = performance.now();
    if (this.disposed || now < this.pendingUntil) return;
    const request = ++this.request;
    const stateRevision = this.stateRevision;
    const positionRevision = this.positionRevision;
    const expires = now + 2500;
    this.pendingUntil = expires;
    let remaining = 2;
    const current = () =>
      !this.disposed && request === this.request && performance.now() < expires;
    const finish = () => {
      if (--remaining === 0 && request === this.request) this.pendingUntil = 0;
    };
    try {
      this.widget.isPaused((paused) => {
        if (
          current() &&
          stateRevision === this.stateRevision &&
          typeof paused === 'boolean'
        )
          this.onPlaying(!paused);
        finish();
      });
      this.widget.getPosition((position) => {
        if (
          current() &&
          positionRevision === this.positionRevision &&
          Number.isFinite(position) &&
          position >= 0
        )
          this.onPosition(position);
        finish();
      });
    } catch {
      // Detached frames and provider failures are handled by the main engine.
      this.request++;
      this.pendingUntil = 0;
    }
  }
  dispose() {
    this.disposed = true;
    this.invalidate();
  }
}
type SoundCloud = {
  Widget: ((frame: HTMLIFrameElement) => Widget) & {
    Events: Record<string, string>;
  };
};
export function releaseSoundCloudWidget(
  widget: Widget,
  events: Record<string, string>,
) {
  // React can remove a keyed iframe before passive-effect cleanup. SoundCloud's
  // SDK then throws while trying to postMessage to the detached frame.
  for (const event of Object.values(events)) {
    try {
      widget.unbind(event);
    } catch {
      /* The removed frame cannot emit events. */
    }
  }
  try {
    widget.pause();
  } catch {
    /* Removing an iframe already stops its audio. */
  }
}
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
    let settled = false;
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.async = true;
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.onload = script.onerror = null;
      script.remove();
      pending = null;
      reject(new Error('SoundCloud не отвечает. Попробуйте ещё раз.'));
    };
    script.onerror = fail;
    script.onload = () => {
      if (settled) return;
      clearTimeout(timer);
      if (window.SC) {
        settled = true;
        script.onload = script.onerror = null;
        resolve(window.SC);
      } else fail();
    };
    document.head.appendChild(script);
  });
  return pending;
}
