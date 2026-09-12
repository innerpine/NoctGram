export type RainScope = 'site' | 'full' | 'dock';
type Rect = { x: number; y: number; width: number; height: number };
type Drop = {
  x: number;
  y: number;
  speed: number;
  length: number;
  depth: number;
};

// All surfaces share one clock. Geometry is read only after layout changes,
// never inside the drawing loop. Opaque cards and padded safe areas protect UI.
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
  private measured = false;
  private disposed = false;
  private painted = false;
  private last = 0;
  private measureTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly host: HTMLElement;
  private readonly root: HTMLElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly interval: number;
  private readonly limit: number;
  private readonly resize: ResizeObserver;
  private readonly mutations: MutationObserver;
  private readonly intersection: IntersectionObserver;

  get ready() {
    return this.visible && this.measured;
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
    const compact = matchMedia('(pointer: coarse)').matches;
    this.interval = 1000 / (compact ? 20 : 30);
    this.limit = scope === 'dock' ? 24 : compact ? 40 : 90;
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
    this.root.addEventListener('scroll', this.invalidate, {
      capture: true,
      passive: true,
    });
    this.root.addEventListener('transitionend', this.layoutTransitionEnded);
    document.fonts?.addEventListener('loadingdone', this.invalidate);
    this.invalidate();
    register(this);
  }

  invalidate = () => {
    if (this.disposed) return;
    // Hide during scrolling/layout changes so stale holes cannot cross text.
    this.measured = false;
    this.clear();
    if (this.measureTimer !== undefined) clearTimeout(this.measureTimer);
    if (document.hidden || !this.visible || motion?.matches) return;
    this.measureTimer = setTimeout(this.measure, 100);
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
    this.measureTimer = undefined;
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height || !this.visible || !allowed()) return;
    const changed = this.width !== box.width || this.height !== box.height;
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
    this.safe = [];
    for (const element of this.root.querySelectorAll<HTMLElement>(
      safeSelector,
    )) {
      const parent = element.parentElement?.closest(safeSelector);
      if (parent && parent !== this.host && this.host.contains(parent))
        continue;
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
    if (changed || !this.drops.length) {
      const count = Math.min(
        this.limit,
        Math.max(12, Math.round((this.width * this.height) / 15000)),
      );
      this.drops = Array.from({ length: count }, (_, index) => ({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        speed: 150 + Math.random() * 190,
        length: 10 + Math.random() * 19,
        depth: index % 3,
      }));
    }
    this.last = 0;
    this.measured = true;
    wake();
  };

  clear() {
    if (this.painted) this.context.clearRect(0, 0, this.width, this.height);
    this.painted = false;
    this.last = 0;
  }
  draw(now: number) {
    if (!this.measured || now - this.last < this.interval) return;
    const seconds = this.last
      ? Math.min((now - this.last) / 1000, 0.08)
      : this.interval / 1000;
    this.last = now;
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    for (let depth = 0; depth < 3; depth++) {
      context.beginPath();
      context.strokeStyle = [
        'rgba(166,182,205,.075)',
        'rgba(181,197,219,.12)',
        'rgba(205,218,235,.18)',
      ][depth];
      context.lineWidth = depth === 2 ? 1.15 : 0.75;
      for (const drop of this.drops) {
        if (drop.depth !== depth) continue;
        drop.y += drop.speed * seconds;
        drop.x -= drop.speed * seconds * 0.075;
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
    if (this.measureTimer !== undefined) clearTimeout(this.measureTimer);
    this.resize.disconnect();
    this.mutations.disconnect();
    this.intersection.disconnect();
    window.removeEventListener('resize', this.invalidate);
    this.root.removeEventListener('scroll', this.invalidate, true);
    this.root.removeEventListener('transitionend', this.layoutTransitionEnded);
    document.fonts?.removeEventListener('loadingdone', this.invalidate);
    this.clear();
    this.canvas.width = this.canvas.height = 0;
  }
}

export function attachRain(canvas: HTMLCanvasElement, scope: RainScope) {
  if (
    !window.ResizeObserver ||
    !window.IntersectionObserver ||
    !window.MutationObserver
  )
    return () => {};
  try {
    const layer = new RainSurface(canvas, scope);
    return () => layer.dispose();
  } catch {
    // Decoration must never prevent opening a page on a restricted browser.
    return () => {};
  }
}
