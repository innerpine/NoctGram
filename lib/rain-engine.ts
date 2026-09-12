import {
  defaultRainOptions,
  readRainOptions,
  type RainOptions,
} from './rain-options';

export type RainScope = 'site' | 'full' | 'dock';
export type RainHandle = (() => void) & {
  update: (options: RainOptions) => void;
};
type Rect = { x: number; y: number; width: number; height: number };
type Drop = {
  x: number;
  y: number;
  speed: number;
  length: number;
  depth: number;
};

// All surfaces share one clock. Layout/scroll events coalesce into one geometry
// refresh before painting; idle frames reuse cached padded safe areas.
const safeSelector = [
  '[data-rain-safe]',
  'header',
  'footer',
  'nav',
  'button',
  'a',
  'input',
  'textarea',
  '[contenteditable="true"]',
  '[role="dialog"]',
  '[role="slider"]',
  'label',
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'small',
  'strong',
  'time',
  '.post',
  '.side-card',
  '.profile-card',
  '.profile-tabs',
  '.composer',
  '.feed-tabs',
  '.thread-list',
  '.chat-panel',
  '.room-conversation',
  '.music-player',
  '.music-lyrics-dock',
  '.music-stage',
  '.aside-footer',
  '.feed-end',
  '.empty-state',
  '.music-stage-main',
  '.music-stage-aside',
  '.music-dock-footer',
  '.music-lyrics-footer',
  '.music-lyrics-empty',
].join(',');

const layers = new Set<RainSurface>();
let frame = 0;
let motion: MediaQueryList | undefined;
function allowed() {
  return !document.hidden && !motion?.matches;
}
function wake() {
  const full = [...layers].some(
    (layer) => layer.scope === 'full' && layer.visible,
  );
  if (
    !frame &&
    allowed() &&
    [...layers].some(
      (layer) => layer.ready && !(full && layer.scope === 'site'),
    )
  )
    frame = requestAnimationFrame(tick);
}
function tick(now: number) {
  frame = 0;
  if (!allowed()) return;
  const full = [...layers].some(
    (layer) => layer.scope === 'full' && layer.visible,
  );
  for (const layer of layers) {
    if (full && layer.scope === 'site') layer.clear();
    else if (layer.visible) layer.draw(now);
  }
  wake();
}
function visibilityChanged() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  for (const layer of layers) layer.clear();
  if (allowed()) {
    for (const layer of layers) layer.invalidate();
    wake();
  }
}
function register(layer: RainSurface) {
  if (!layers.size) {
    motion = matchMedia('(prefers-reduced-motion: reduce)');
    motion.addEventListener('change', visibilityChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
  }
  layers.add(layer);
  wake();
}
function unregister(layer: RainSurface) {
  layers.delete(layer);
  if (!layers.size) {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    motion?.removeEventListener('change', visibilityChanged);
    motion = undefined;
    document.removeEventListener('visibilitychange', visibilityChanged);
  } else wake();
}

class RainSurface {
  visible = true;
  private width = 0;
  private height = 0;
  private drops: Drop[] = [];
  private safe: Rect[] = [];
  private elements: HTMLElement[] = [];
  private elementsDirty = true;
  private geometryDirty = true;
  private measured = false;
  private disposed = false;
  private painted = false;
  private last: number | undefined;
  private nextFrame = 0;
  private readonly host: HTMLElement;
  private readonly root: HTMLElement;
  private readonly scrollRoot: HTMLElement | Document;
  private readonly context: CanvasRenderingContext2D;
  private interval: number;
  private options = defaultRainOptions;
  private readonly compact: boolean;
  private readonly limit: number;
  private readonly resize: ResizeObserver;
  private readonly mutations: MutationObserver;
  private readonly intersection: IntersectionObserver;

  get ready() {
    return this.visible && (this.measured || this.geometryDirty);
  }

  constructor(
    private canvas: HTMLCanvasElement,
    readonly scope: RainScope,
  ) {
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas unavailable');
    this.context = context;
    this.host = scope === 'site' ? document.body : canvas.parentElement!;
    this.root = this.host;
    this.scrollRoot = scope === 'site' ? document : this.root;
    this.compact = matchMedia('(pointer: coarse)').matches;
    this.interval = 1000 / (this.compact ? 30 : 60);
    this.limit = scope === 'dock' ? 24 : this.compact ? 40 : 90;
    this.resize = new ResizeObserver(this.invalidate);
    this.resize.observe(canvas);
    this.resize.observe(this.host);
    this.mutations = new MutationObserver(this.invalidate);
    this.mutations.observe(this.root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'data-open', 'data-state'],
    });
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.invalidate();
      else this.clear();
      wake();
    });
    this.intersection.observe(canvas);
    window.addEventListener('resize', this.invalidate, { passive: true });
    this.scrollRoot.addEventListener('scroll', this.geometryChanged, {
      capture: true,
      passive: true,
    });
    this.root.addEventListener('transitionend', this.layoutTransitionEnded);
    document.fonts?.addEventListener('loadingdone', this.invalidate);
    this.invalidate();
    register(this);
  }

  update = (options: RainOptions) => {
    if (this.disposed) return;
    this.options = readRainOptions(options);
    const fps =
      this.options.fps === 'auto' ? (this.compact ? 30 : 60) : this.options.fps;
    const interval = 1000 / fps;
    if (interval !== this.interval) {
      this.interval = interval;
      this.nextFrame = this.last === undefined ? 0 : this.last + interval;
    }
    this.syncDrops();
    wake();
  };

  private syncDrops() {
    if (!this.width || !this.height) return;
    const base = Math.min(
      this.limit,
      Math.max(12, Math.round((this.width * this.height) / 15000)),
    );
    const count = Math.round((base * this.options.intensity) / 100);
    // Preserve existing particles when changing density; sliders must not restart rain.
    if (this.drops.length > count) this.drops.length = count;
    while (this.drops.length < count)
      this.drops.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        speed: 150 + Math.random() * 190,
        length: 18 + Math.random() * 24,
        depth: this.drops.length % 3,
      });
  }

  invalidate = () => {
    if (this.disposed) return;
    this.elementsDirty = true;
    this.geometryChanged();
  };

  private geometryChanged = () => {
    if (this.disposed) return;
    // Keep particles and the clock running while refreshing masks on the next
    // paint. Scrolling must not erase the canvas or restart the animation.
    this.geometryDirty = true;
    wake();
  };

  private layoutTransitionEnded = (event: TransitionEvent) => {
    if (
      /^(width|height|max-height|transform|translate|scale|grid-template-columns|gap|padding|margin)/.test(
        event.propertyName,
      )
    )
      this.invalidate();
  };

  private measure = () => {
    if (this.disposed) return;
    this.geometryDirty = false;
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height || !this.visible || !allowed()) {
      this.measured = false;
      return;
    }
    if (
      this.width &&
      this.height &&
      (this.width !== box.width || this.height !== box.height)
    ) {
      for (const drop of this.drops) {
        drop.x *= box.width / this.width;
        drop.y *= box.height / this.height;
      }
    }
    this.width = box.width;
    this.height = box.height;
    // Bound the backing bitmap on Retina/4K displays instead of multiplying by DPR.
    const scale = Math.min(
      1,
      Math.sqrt(1_200_000 / (this.width * this.height)),
    );
    const width = Math.max(1, Math.round(this.width * scale));
    const height = Math.max(1, Math.round(this.height * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.setTransform(
      width / this.width,
      0,
      0,
      height / this.height,
      0,
      0,
    );
    if (this.elementsDirty) {
      this.elements = [
        ...this.root.querySelectorAll<HTMLElement>(safeSelector),
      ].filter((element) => {
        const parent = element.parentElement?.closest(safeSelector);
        return !parent || parent === this.host || !this.host.contains(parent);
      });
      this.elementsDirty = false;
    }
    this.safe = [];
    for (const element of this.elements) {
      const rect = element.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        rect.bottom < box.top ||
        rect.top > box.bottom ||
        rect.right < box.left ||
        rect.left > box.right
      )
        continue;
      this.safe.push({
        x: rect.left - box.left - 8,
        y: rect.top - box.top - 7,
        width: rect.width + 16,
        height: rect.height + 14,
      });
    }
    this.syncDrops();
    this.measured = true;
  };

  clear() {
    if (this.painted) this.context.clearRect(0, 0, this.width, this.height);
    this.painted = false;
    this.last = undefined;
    this.nextFrame = 0;
  }
  draw(now: number) {
    if (now + 0.5 < this.nextFrame) return;
    if (this.geometryDirty) this.measure();
    if (!this.measured) return;
    // Preserve the cadence across fractional/jittered RAF timestamps instead
    // of resetting the deadline to each frame and accidentally skipping one.
    this.nextFrame =
      (this.nextFrame && now - this.nextFrame < this.interval
        ? this.nextFrame
        : now) + this.interval;
    const seconds =
      this.last === undefined ? 0 : Math.min((now - this.last) / 1000, 0.08);
    this.last = now;
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    context.globalAlpha = this.options.brightness / 150;
    for (let depth = 0; depth < 3; depth++) {
      context.beginPath();
      context.strokeStyle = [
        'rgba(181,197,219,.30)',
        'rgba(205,218,235,.48)',
        'rgba(225,235,248,.69)',
      ][depth];
      context.lineWidth = depth === 2 ? 1.4 : 1;
      for (const drop of this.drops) {
        if (drop.depth !== depth) continue;
        const distance = (drop.speed * seconds * this.options.speed) / 100;
        drop.y += distance;
        drop.x -= distance * 0.075;
        if (drop.y > this.height + drop.length) {
          drop.y = -drop.length;
          drop.x = Math.random() * this.width;
        }
        if (drop.x < -3) drop.x = this.width + 3;
        context.moveTo(drop.x, drop.y);
        context.lineTo(drop.x - drop.length * 0.075, drop.y + drop.length);
      }
      context.stroke();
    }
    // clearRect unions overlapping safe areas; an even-odd clip would expose overlaps.
    for (const rect of this.safe)
      context.clearRect(rect.x, rect.y, rect.width, rect.height);
    this.painted = true;
  }
  dispose() {
    this.disposed = true;
    unregister(this);
    this.resize.disconnect();
    this.mutations.disconnect();
    this.intersection.disconnect();
    window.removeEventListener('resize', this.invalidate);
    this.scrollRoot.removeEventListener('scroll', this.geometryChanged, true);
    this.root.removeEventListener('transitionend', this.layoutTransitionEnded);
    document.fonts?.removeEventListener('loadingdone', this.invalidate);
    this.clear();
    this.canvas.width = this.canvas.height = 0;
  }
}

export function attachRain(
  canvas: HTMLCanvasElement,
  scope: RainScope,
): RainHandle {
  const noop = () => {};
  if (
    !window.ResizeObserver ||
    !window.IntersectionObserver ||
    !window.MutationObserver
  )
    return Object.assign(noop, { update: noop });
  try {
    const layer = new RainSurface(canvas, scope);
    return Object.assign(() => layer.dispose(), { update: layer.update });
  } catch {
    // Decoration must never prevent opening a page on a restricted browser.
    return Object.assign(noop, { update: noop });
  }
}
