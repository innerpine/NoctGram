import type { MusicLink, MusicTrack } from './music-links';

export type ListenState = {
  status:
    | 'idle'
    | 'checking'
    | 'off'
    | 'tracking'
    | 'counted'
    | 'error'
    | 'excluded';
  seconds: number;
};
type Reply = { session?: string | null; counted?: boolean };
type Request = (
  action: string,
  body: Record<string, unknown>,
) => Promise<Reply>;

// Metadata-only entries cannot advance an otherwise playable queue.
export function adjacentPlayable(
  queue: MusicLink[],
  url: string,
  direction = 1,
  spotifyAvailable = false,
) {
  const current = queue.findIndex((item) => item.url === url);
  if (current < 0) return undefined;
  for (let step = 1; step < queue.length; step++) {
    const i =
      (current + Math.sign(direction) * step + queue.length) % queue.length;
    const item = queue[i] as MusicTrack;
    if (spotifyAvailable && item.provider === 'spotify')
      return { ...item, playback: 'spotify' as const };
    if (
      item.provider === 'soundcloud' ||
      item.provider === 'youtube' ||
      item.audioUrl ||
      item.playback === 'spotify'
    )
      return item;
  }
  return undefined;
}

/** Count elapsed audio, never seeks, paused time or a jump after suspension. */
export class MusicListenTracker {
  private version = 0;
  private session = '';
  private total = 0;
  private position = -1;
  private time = 0;
  private busy = false;
  private attempts = 0;
  private retryAt = 0;
  private day = 0;
  private url = '';
  private state: ListenState = { status: 'idle', seconds: 0 };
  constructor(
    private request: Request,
    private changed: (state: ListenState) => void,
    private counted: () => void,
    private now = () => performance.now(),
    private wall = () => Date.now(),
  ) {}
  private publish(status: ListenState['status']) {
    const seconds = Math.min(30, Math.floor(this.total / 1000));
    if (this.state.status === status && this.state.seconds === seconds) return;
    this.state = { status, seconds };
    this.changed(this.state);
  }
  dispose() {
    this.version++;
    this.session = '';
    this.url = '';
  }
  resetPosition() {
    this.position = -1;
  }
  async start(url: string) {
    const version = ++this.version;
    this.url = url;
    this.day = Math.floor(this.wall() / 86400000);
    this.total = 0;
    this.session = '';
    this.busy = false;
    this.attempts = 0;
    this.retryAt = 0;
    this.resetPosition();
    this.publish('checking');
    try {
      const reply = await this.request('start', { url });
      if (version !== this.version) return;
      this.session = reply.session || '';
      this.resetPosition();
      if (reply.counted) this.total = 30000;
      this.publish(
        reply.counted ? 'counted' : this.session ? 'tracking' : 'off',
      );
    } catch {
      if (version === this.version) this.publish('error');
    }
  }
  sample(position: number, playing: boolean) {
    if (this.url && this.day !== Math.floor(this.wall() / 86400000)) {
      void this.start(this.url);
      return;
    }
    const now = this.now(),
      delta = position - this.position,
      elapsed = now - this.time;
    if (
      this.session &&
      playing &&
      this.position >= 0 &&
      delta > 0 &&
      delta <= 2000 &&
      elapsed > 0 &&
      elapsed < 3000
    )
      this.total += Math.min(delta, elapsed);
    this.position = playing ? position : -1;
    this.time = now;
    if (!this.session || this.attempts >= 3) return;
    this.publish('tracking');
    if (this.total < 30000 || this.busy || now < this.retryAt) return;
    // One acknowledgement per listen, rather than a write every five seconds.
    const version = this.version;
    this.busy = true;
    this.attempts++;
    void this.request('progress', { session: this.session, totalMs: 30000 })
      .then((reply) => {
        if (version !== this.version) return;
        if (!reply.counted) throw new Error('Not acknowledged');
        this.session = '';
        this.total = 30000;
        this.publish('counted');
        this.counted();
      })
      .catch(() => {
        if (version !== this.version) return;
        this.retryAt = this.now() + 10000;
        if (this.attempts >= 3) this.publish('error');
      })
      .finally(() => {
        if (version === this.version) this.busy = false;
      });
  }
}
