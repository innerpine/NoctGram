type YouTubeDevice = {
  loadVideoById(id: string): void;
  cueVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getVolume(): number;
  isMuted(): boolean;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
};
export type YouTubeSDK = {
  Player: new (
    frame: HTMLIFrameElement,
    options: {
      events: {
        onReady(): void;
        onStateChange(event: { data: number }): void;
        onError(event: { data: number }): void;
        onAutoplayBlocked(): void;
      };
    },
  ) => YouTubeDevice;
};
declare global {
  interface Window {
    YT?: YouTubeSDK;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let loading: Promise<YouTubeSDK> | null = null;
export function loadYouTubeSDK(): Promise<YouTubeSDK> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YouTubeSDK>((resolve, reject) => {
    const script = document.createElement('script');
    const previous = window.onYouTubeIframeAPIReady;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.onerror = null;
      window.onYouTubeIframeAPIReady = previous;
      if (error || !window.YT?.Player) {
        script.remove();
        reject(error || new Error('YouTube не загрузился. Повторите попытку.'));
      } else resolve(window.YT);
    };
    const timer = setTimeout(
      () => finish(new Error('YouTube не отвечает. Повторите попытку.')),
      15000,
    );
    window.onYouTubeIframeAPIReady = () => {
      try {
        previous?.();
      } finally {
        finish();
      }
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => finish(new Error('Не удалось загрузить YouTube.'));
    document.head.appendChild(script);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
type Hooks = {
  ready(): void;
  state(value: {
    playing: boolean;
    position: number;
    duration: number;
    volume: number;
  }): void;
  error(message: string): void;
  blocked(): void;
  ended(): void;
  control(
    command: 'pause' | 'resume' | 'seek',
    extra?: Record<string, unknown>,
  ): void;
  shouldPlay(): boolean;
};

// YouTube still owns the media stream. The host stays mounted independently of
// Noctgram's controls, so opening or collapsing the music view cannot restart it.
export class YouTubePlayback {
  private device: YouTubeDevice;
  private frame: HTMLIFrameElement;
  private disposed = false;
  private ready = false;
  private expected: number | null = null;
  private state = -1;
  private sample: { position: number; time: number } | null = null;
  private ignoreSeekUntil = 0;
  private pendingVolume: { value: number; until: number } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private timeout: ReturnType<typeof setTimeout>;
  constructor(
    sdk: YouTubeSDK,
    host: HTMLElement,
    id: string,
    volume: number,
    private hooks: Hooks,
    private now = () => performance.now(),
  ) {
    this.frame = document.createElement('iframe');
    this.frame.title = 'YouTube';
    this.frame.tabIndex = -1;
    this.frame.allow =
      'autoplay; encrypted-media; picture-in-picture; fullscreen';
    this.frame.allowFullscreen = true;
    this.frame.referrerPolicy = 'strict-origin-when-cross-origin';
    this.frame.src =
      'https://www.youtube.com/embed/' +
      id +
      '?' +
      new URLSearchParams({
        enablejsapi: '1',
        playsinline: '1',
        autoplay: '0',
        origin: window.location.origin,
      });
    host.appendChild(this.frame);
    this.timeout = setTimeout(
      () => this.fail('YouTube не отвечает. Повторите попытку.'),
      20000,
    );
    this.device = new sdk.Player(this.frame, {
      events: {
        onReady: () => {
          if (this.disposed) return;
          clearTimeout(this.timeout);
          this.ready = true;
          this.device.setVolume(volume);
          this.hooks.ready();
          this.timer = setInterval(() => this.publish(), 250);
          if (this.hooks.shouldPlay()) this.resume();
          else this.publish();
        },
        onStateChange: ({ data }) => {
          if (this.disposed) return;
          const previous = this.state;
          this.state = data;
          const commanded = this.expected === data;
          if (commanded) this.expected = null;
          if (!commanded && data === 2 && (previous === 1 || previous === 3))
            this.hooks.control('pause');
          if (
            !commanded &&
            data === 1 &&
            (previous === 2 || previous === 5 || previous === -1)
          )
            this.hooks.control('resume');
          this.publish();
          if (data === 0) this.hooks.ended();
        },
        onError: ({ data }) =>
          this.fail(
            data === 100
              ? 'Видео удалено или стало приватным.'
              : data === 101 || data === 150
                ? 'Автор запретил воспроизведение этого видео на других сайтах.'
                : data === 153
                  ? 'Браузер не передал YouTube адрес страницы. Проверьте расширения приватности и повторите попытку.'
                  : 'YouTube не смог воспроизвести видео. Попробуйте другую ссылку.',
          ),
        onAutoplayBlocked: () => {
          if (!this.disposed) {
            this.expected = null;
            this.hooks.blocked();
          }
        },
      },
    });
  }
  load(id: string, hooks: Hooks) {
    if (this.disposed || !this.ready) return false;
    this.hooks = hooks;
    this.state = -1;
    this.sample = null;
    this.ignoreSeekUntil = this.now() + 3000;
    this.expected = hooks.shouldPlay() ? 1 : 5;
    if (hooks.shouldPlay()) this.device.loadVideoById(id);
    else this.device.cueVideoById(id);
    hooks.ready();
    return true;
  }
  private fail(message: string) {
    if (this.disposed) return;
    this.ready = false;
    clearTimeout(this.timeout);
    clearInterval(this.timer);
    this.hooks.error(message);
  }
  private publish() {
    if (this.disposed || !this.ready) return;
    const position = this.device.getCurrentTime() * 1000;
    const duration = this.device.getDuration() * 1000;
    const playing = this.device.getPlayerState() === 1;
    const now = this.now();
    if (
      this.sample &&
      now > this.ignoreSeekUntil &&
      Math.abs(
        position -
          this.sample.position -
          (playing ? now - this.sample.time : 0),
      ) > 2500
    )
      this.hooks.control('seek', { positionMs: position });
    this.sample = { position, time: now };
    const nativeVolume = this.device.isMuted() ? 0 : this.device.getVolume();
    if (
      this.pendingVolume &&
      (this.pendingVolume.value === nativeVolume ||
        now > this.pendingVolume.until)
    )
      this.pendingVolume = null;
    this.hooks.state({
      playing,
      position,
      duration,
      volume: this.pendingVolume?.value ?? nativeVolume,
    });
  }
  resume() {
    if (this.disposed || !this.ready) return;
    this.expected = 1;
    this.device.playVideo();
  }
  pause() {
    if (this.disposed || !this.ready) return;
    this.expected = 2;
    this.device.pauseVideo();
  }
  seek(ms: number) {
    if (this.disposed || !this.ready) return;
    this.ignoreSeekUntil = this.now() + 3000;
    this.sample = null;
    this.device.seekTo(Math.max(0, ms) / 1000, true);
  }
  volume(value: number) {
    if (this.disposed || !this.ready) return;
    value = Math.max(0, Math.min(100, value));
    this.pendingVolume = { value, until: this.now() + 2000 };
    if (value > 0) this.device.unMute();
    this.device.setVolume(value);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timeout);
    clearInterval(this.timer);
    try {
      this.device.destroy();
    } catch {
      /* The browser may already have removed the frame. */
    } finally {
      this.frame.remove();
    }
  }
}
