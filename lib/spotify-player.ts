import type { MusicTrack } from './music-links';

export type SpotifyState = {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: {
      uri: string;
      name: string;
      artists: { name: string }[];
      album: { images: { url: string }[] };
    };
  };
};
type EventData = { device_id?: string; message?: string };
export type SpotifyDevice = {
  addListener: (event: string, callback: (value: never) => void) => boolean;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  setVolume: (level: number) => Promise<void>;
  activateElement: () => Promise<void>;
  getCurrentState: () => Promise<SpotifyState | null>;
};
export type SpotifySDK = {
  Player: new (options: {
    name: string;
    volume: number;
    getOAuthToken: (callback: (token: string) => void) => void;
  }) => SpotifyDevice;
};
declare global {
  interface Window {
    Spotify?: SpotifySDK;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}
let loading: Promise<SpotifySDK> | null = null;
export function loadSpotifySDK(): Promise<SpotifySDK> {
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (loading) return loading;
  loading = new Promise<SpotifySDK>((resolve, reject) => {
    const script = document.createElement('script');
    const previous = window.onSpotifyWebPlaybackSDKReady;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      window.onSpotifyWebPlaybackSDKReady = previous;
      if (error) {
        script.remove();
        reject(error);
      } else if (window.Spotify) resolve(window.Spotify);
    };
    const timer = setTimeout(
      () => finish(new Error('Spotify не загрузился. Повторите попытку.')),
      20000,
    );
    window.onSpotifyWebPlaybackSDKReady = () => {
      previous?.();
      finish();
    };
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.onerror = () => finish(new Error('Не удалось загрузить Spotify.'));
    document.head.appendChild(script);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
type Hooks = {
  ready: () => void;
  state: (value: {
    playing: boolean;
    position: number;
    duration: number;
    track: MusicTrack;
  }) => void;
  error: (message: string) => void;
  ended: () => void;
  autoplayBlocked?: () => void;
};

/** One local Spotify device. Audio and decryption stay inside the official SDK. */
export class SpotifyPlayback {
  private device: SpotifyDevice;
  private disposed = false;
  private abort = new AbortController();
  private deviceId = '';
  private credential: { accessToken: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;
  private latest: SpotifyState | null = null;
  private time = 0;
  private ending = false;
  private manualPause = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private started = false;
  constructor(
    sdk: SpotifySDK,
    private url: string,
    volume: number,
    private hooks: Hooks,
    private request = fetch,
    private now = () => performance.now(),
  ) {
    this.device = new sdk.Player({
      name: 'Noctgram',
      volume: Math.max(0, Math.min(1, volume)),
      getOAuthToken: (callback) => {
        void this.token()
          .then((token) => {
            if (!this.disposed) callback(token);
          })
          .catch((error) => this.fail(error));
      },
    });
    this.device.addListener('ready', ({ device_id }: EventData) => {
      if (this.disposed || !device_id) return;
      this.deviceId = device_id;
      this.hooks.ready();
      void this.startTrack().catch((error) => this.fail(error));
    });
    this.device.addListener('not_ready', () =>
      this.fail(new Error('Spotify отключил устройство. Нажмите «Повторить».')),
    );
    this.device.addListener(
      'player_state_changed',
      (state: SpotifyState | null) => this.receive(state),
    );
    const errors: Record<string, string> = {
      initialization_error:
        'Этот браузер не поддерживает защищённое воспроизведение Spotify.',
      authentication_error: 'Переподключите аккаунт Spotify в сервисах.',
      account_error:
        'Для прослушивания Spotify нужен Premium на вашем аккаунте.',
      playback_error:
        'Spotify не может воспроизвести этот трек. Проверьте доступность и подключение.',
    };
    for (const [event, message] of Object.entries(errors))
      this.device.addListener(event, () => this.fail(new Error(message)));
    this.device.addListener('autoplay_failed', () => {
      if (!this.disposed) {
        this.manualPause = true;
        this.latest = null;
        this.hooks.autoplayBlocked?.();
      }
    });
  }
  private fail(error: unknown) {
    if (
      !this.disposed &&
      !(error instanceof DOMException && error.name === 'AbortError')
    ) {
      this.latest = null;
      this.hooks.error(
        error instanceof Error ? error.message : 'Spotify недоступен.',
      );
    }
  }
  private token(): Promise<string> {
    if (this.disposed)
      return Promise.reject(new DOMException('Stopped', 'AbortError'));
    if (this.credential && this.credential.expiresAt > Date.now() + 60000)
      return Promise.resolve(this.credential.accessToken);
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = (async () => {
      const response = await this.request(
        '/api/music/services/spotify/playback-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          cache: 'no-store',
          signal: this.abort.signal,
        },
      );
      const data = (await response.json()) as {
        accessToken: string;
        expiresAt: number;
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || 'Подключите Spotify в сервисах.');
      if (
        typeof data.accessToken !== 'string' ||
        !Number.isFinite(data.expiresAt)
      )
        throw new Error('Spotify не выдал подключение.');
      if (this.disposed) throw new DOMException('Stopped', 'AbortError');
      this.credential = data;
      return data.accessToken as string;
    })().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }
  async connect() {
    // Fail before constructing a remote device when account setup is incomplete.
    await this.token();
    if (this.disposed) return;
    if (!(await this.device.connect()))
      throw new Error('Не удалось подключить плеер Spotify.');
    if (this.disposed) {
      this.device.disconnect();
      return;
    }
    this.timer = setInterval(() => {
      if (this.latest && !this.latest.paused) this.publish(this.latest);
    }, 250);
  }
  private async startTrack() {
    if (this.disposed || !this.deviceId) return;
    const id = this.url.match(/\/track\/([A-Za-z0-9]{22})$/)?.[1];
    if (!id) throw new Error('Некорректная ссылка Spotify.');
    const token = await this.token();
    if (this.disposed) return;
    const response = await this.request(
      'https://api.spotify.com/v1/me/player/play?device_id=' +
        encodeURIComponent(this.deviceId),
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: ['spotify:track:' + id], position_ms: 0 }),
        signal: this.abort.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
    );
    if (this.disposed) {
      this.device.disconnect();
      return;
    }
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? 'Spotify не разрешил воспроизведение. Проверьте Premium и доступ приложения.'
          : response.status === 429
            ? 'Spotify временно ограничил запросы. Попробуйте позже.'
            : 'Не удалось запустить трек Spotify. Переподключите аккаунт или повторите попытку.',
      );
    this.started = true;
    this.ending = false;
  }
  private publish(state: SpotifyState) {
    const track = state.track_window.current_track;
    this.hooks.state({
      playing: !state.paused,
      position: Math.min(
        state.duration,
        state.position +
          (state.paused ? 0 : Math.max(0, this.now() - this.time)),
      ),
      duration: state.duration,
      track: {
        url: this.url,
        provider: 'spotify',
        kind: 'track',
        id: track.uri,
        title: track.name,
        artist: track.artists.map((x) => x.name).join(', '),
        artwork: track.album.images[0]?.url || '',
        authorUrl: this.url,
      },
    });
  }
  private receive(state: SpotifyState | null) {
    if (this.disposed) return;
    if (!state) {
      if (this.started)
        this.fail(
          new Error(
            'Воспроизведение перенесено на другое устройство. Нажмите «Повторить», чтобы слушать здесь.',
          ),
        );
      return;
    }
    const expected = 'spotify:track:' + this.url.split('/').at(-1);
    if (state.track_window.current_track.uri !== expected) {
      if (this.started) {
        void this.device.pause().catch(() => {});
        this.fail(
          new Error(
            'Трек изменён вне Noctgram. Выберите песню в своей очереди.',
          ),
        );
      }
      return;
    }
    const previous = this.latest;
    const ended =
      !this.manualPause &&
      !this.ending &&
      previous &&
      !previous.paused &&
      state.paused &&
      state.position === 0 &&
      previous.duration > 0 &&
      previous.position + Math.max(0, this.now() - this.time) >=
        previous.duration - 1500;
    this.latest = state;
    this.time = this.now();
    this.publish(state);
    if (ended) {
      this.ending = true;
      this.hooks.ended();
    }
  }
  toggle() {
    // Called directly in a user gesture, including Safari's activation requirement.
    void this.device.activateElement().catch(() => {});
    const paused = this.latest?.paused ?? true;
    this.manualPause = !paused;
    void (paused ? this.device.resume() : this.device.pause()).catch((error) =>
      this.fail(error),
    );
  }
  resume() {
    void this.device.activateElement().catch(() => {});
    this.manualPause = false;
    void this.device.resume().catch((error) => this.fail(error));
  }
  seek(ms: number) {
    this.ending = false;
    if (this.latest) {
      this.latest = { ...this.latest, position: ms };
      this.time = this.now();
    }
    void this.device.seek(ms).catch((error) => this.fail(error));
  }
  volume(value: number) {
    void this.device
      .setVolume(Math.max(0, Math.min(1, value)))
      .catch((error) => this.fail(error));
  }
  repeat() {
    this.manualPause = false;
    void this.startTrack().catch((error) => this.fail(error));
  }
  dispose() {
    this.disposed = true;
    this.abort.abort();
    clearInterval(this.timer);
    this.credential = null;
    this.latest = null;
    this.device.disconnect();
  }
}
