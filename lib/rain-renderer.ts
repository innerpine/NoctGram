import {
  defaultRainOptions,
  readRainOptions,
  type RainOptions,
} from './rain-options';

export type RainScope = 'site' | 'full' | 'dock';
export type RainRect = { x: number; y: number; width: number; height: number };
export type RainLayout = { width: number; height: number; safe: RainRect[] };
type Drop = {
  x: number;
  y: number;
  speed: number;
  length: number;
  depth: number;
};
const colors = [
  'rgba(181,197,219,.30)',
  'rgba(205,218,235,.48)',
  'rgba(225,235,248,.69)',
];

// No DOM or React work runs here. The same renderer also supports browsers
// without transferable canvases through the main-thread fallback.
export class RainRenderer {
  private context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private layout: RainLayout = { width: 0, height: 0, safe: [] };
  private drops: Drop[] = [];
  private options = defaultRainOptions;
  private interval: number;
  private last: number | undefined;
  private nextFrame = 0;
  private painted = false;
  active = false;
  constructor(
    private canvas: HTMLCanvasElement | OffscreenCanvas,
    private scope: RainScope,
    private compact: boolean,
  ) {
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas unavailable');
    this.context = context as typeof this.context;
    this.interval = 1000 / (compact ? 30 : 60);
  }
  get ready() {
    return this.active && this.layout.width > 0 && this.layout.height > 0;
  }
  configure(layout: RainLayout) {
    const previous = this.layout;
    if (
      previous.width &&
      previous.height &&
      (previous.width !== layout.width || previous.height !== layout.height)
    ) {
      for (const drop of this.drops) {
        drop.x *= layout.width / previous.width;
        drop.y *= layout.height / previous.height;
      }
    }
    this.layout = layout;
    const scale = Math.min(
      1,
      Math.sqrt(1_200_000 / (layout.width * layout.height)),
    );
    const width = Math.max(1, Math.round(layout.width * scale));
    const height = Math.max(1, Math.round(layout.height * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.setTransform(
      width / layout.width,
      0,
      0,
      height / layout.height,
      0,
      0,
    );
    this.syncDrops();
  }
  update(options: RainOptions) {
    this.options = readRainOptions(options);
    const fps =
      this.options.fps === 'auto' ? (this.compact ? 30 : 60) : this.options.fps;
    const interval = 1000 / fps;
    if (interval !== this.interval) {
      this.interval = interval;
      this.nextFrame = this.last === undefined ? 0 : this.last + interval;
    }
    this.syncDrops();
  }
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    if (!active) this.clear();
  }
  private syncDrops() {
    const { width, height } = this.layout;
    if (!width || !height) return;
    const limit = this.scope === 'dock' ? 24 : this.compact ? 40 : 90;
    const base = Math.min(
      limit,
      Math.max(12, Math.round((width * height) / 15000)),
    );
    const count = Math.round((base * this.options.intensity) / 100);
    if (this.drops.length > count) this.drops.length = count;
    while (this.drops.length < count)
      this.drops.push({
        x: Math.random() * width,
        y: Math.random() * height,
        speed: 150 + Math.random() * 190,
        length: 18 + Math.random() * 24,
        depth: this.drops.length % 3,
      });
  }
  private clear() {
    if (this.painted)
      this.context.clearRect(0, 0, this.layout.width, this.layout.height);
    this.painted = false;
    this.last = undefined;
    this.nextFrame = 0;
  }
  draw(now: number) {
    if (!this.ready || now + 0.5 < this.nextFrame) return;
    this.nextFrame =
      (this.nextFrame && now - this.nextFrame < this.interval
        ? this.nextFrame
        : now) + this.interval;
    const seconds =
      this.last === undefined ? 0 : Math.min((now - this.last) / 1000, 0.08);
    this.last = now;
    const { width, height, safe } = this.layout;
    const context = this.context;
    context.clearRect(0, 0, width, height);
    context.globalAlpha = this.options.brightness / 150;
    for (let depth = 0; depth < 3; depth++) {
      context.beginPath();
      context.strokeStyle = colors[depth];
      context.lineWidth = depth === 2 ? 1.4 : 1;
      for (const drop of this.drops) {
        if (drop.depth !== depth) continue;
        const distance = (drop.speed * seconds * this.options.speed) / 100;
        drop.y += distance;
        drop.x -= distance * 0.075;
        if (drop.y > height + drop.length) {
          drop.y = -drop.length;
          drop.x = Math.random() * width;
        }
        if (drop.x < -3) drop.x = width + 3;
        context.moveTo(drop.x, drop.y);
        context.lineTo(drop.x - drop.length * 0.075, drop.y + drop.length);
      }
      context.stroke();
    }
    for (const rect of safe)
      context.clearRect(rect.x, rect.y, rect.width, rect.height);
    this.painted = true;
  }
  dispose() {
    this.clear();
    this.drops = [];
    this.canvas.width = this.canvas.height = 0;
  }
}

export type RainWorkerMessage =
  | {
      type: 'attach';
      id: number;
      canvas: OffscreenCanvas;
      scope: RainScope;
      compact: boolean;
    }
  | { type: 'layout'; id: number; layout: RainLayout }
  | { type: 'options'; id: number; options: RainOptions }
  | { type: 'active'; id: number; active: boolean }
  | { type: 'dispose'; id: number };
