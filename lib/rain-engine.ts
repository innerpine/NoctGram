import { readRainOptions, type RainOptions } from './rain-options';
import { createRainPainter } from './rain-painter';
import type { RainRect, RainScope } from './rain-renderer';
export type { RainScope } from './rain-renderer';
export type RainHandle = (() => void) & {
  update: (options: RainOptions) => void;
};

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
  if (!frame && allowed()) {
    for (const layer of layers) {
      if (layer.ready) {
        frame = requestAnimationFrame(tick);
        break;
      }
    }
  }
}
function tick(now: number) {
  frame = 0;
  if (!allowed()) return;
  for (const layer of layers) if (layer.ready) layer.draw(now);
  wake();
}
function activityChanged() {
  let full = false;
  for (const layer of layers)
    if (layer.scope === 'full' && layer.visible) full = true;
  for (const layer of layers)
    layer.setActive(
      Boolean(allowed() && layer.visible && !(full && layer.scope === 'site')),
    );
  wake();
}
function visibilityChanged() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  if (allowed()) for (const layer of layers) layer.invalidate();
  activityChanged();
}
function register(layer: RainSurface) {
  if (!layers.size) {
    motion = matchMedia('(prefers-reduced-motion: reduce)');
    motion.addEventListener('change', visibilityChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
  }
  layers.add(layer);
  activityChanged();
}
function unregister(layer: RainSurface) {
  layers.delete(layer);
  if (!layers.size) {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    motion?.removeEventListener('change', visibilityChanged);
    motion = undefined;
    document.removeEventListener('visibilitychange', visibilityChanged);
  } else activityChanged();
}

class RainSurface {
  visible = true;
  private active = false;
  private elements = new Set<HTMLElement>();
  private elementsDirty = true;
  private geometryDirty = true;
  private disposed = false;
  private readonly host: HTMLElement;
  private readonly scrollRoot: HTMLElement | Document;
  private readonly painter: ReturnType<typeof createRainPainter>;
  private readonly resize: ResizeObserver;
  private readonly mutations: MutationObserver;
  private readonly intersection: IntersectionObserver;
  get ready() {
    return this.active && (this.geometryDirty || this.painter.needsFrame);
  }

  constructor(
    private canvas: HTMLCanvasElement,
    readonly scope: RainScope,
    forceMain: boolean,
    failed: () => void,
  ) {
    this.host = scope === 'site' ? document.body : canvas.parentElement!;
    this.scrollRoot = scope === 'site' ? document : this.host;
    this.painter = createRainPainter(
      canvas,
      scope,
      matchMedia('(pointer: coarse)').matches,
      wake,
      failed,
      forceMain,
    );
    this.resize = new ResizeObserver(this.geometryChanged);
    this.resize.observe(canvas);
    this.resize.observe(this.host);
    this.mutations = new MutationObserver(this.contentChanged);
    this.mutations.observe(this.host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'data-open', 'data-state'],
    });
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.geometryChanged();
      activityChanged();
    });
    this.intersection.observe(canvas);
    window.addEventListener('resize', this.geometryChanged, { passive: true });
    this.scrollRoot.addEventListener('scroll', this.geometryChanged, {
      capture: true,
      passive: true,
    });
    this.host.addEventListener('transitionend', this.layoutTransitionEnded);
    document.fonts?.addEventListener('loadingdone', this.geometryChanged);
    register(this);
  }
  setActive(active: boolean) {
    this.active = active;
    this.painter.setActive(active);
  }
  update = (options: RainOptions) => {
    if (this.disposed) return;
    this.painter.update(readRainOptions(options));
    wake();
  };
  invalidate = () => {
    if (this.disposed) return;
    this.elementsDirty = true;
    this.geometryChanged();
  };
  private geometryChanged = () => {
    if (this.disposed) return;
    this.geometryDirty = true;
    wake();
  };
  private contentChanged = (records: MutationRecord[]) => {
    // Content inside an already protected card/player cannot expose text to
    // rain. ResizeObserver updates its mask only if its outer dimensions change.
    for (const record of records) {
      let element =
        record.target.nodeType === 1
          ? (record.target as HTMLElement)
          : record.target.parentElement;
      let covered = false;
      while (element && element !== this.host) {
        if (
          this.elements.has(element) &&
          (record.type === 'childList' || element !== record.target)
        ) {
          covered = true;
          break;
        }
        element = element.parentElement;
      }
      if (!covered) {
        if (record.type === 'childList') this.invalidate();
        else this.geometryChanged();
        return;
      }
    }
  };
  private layoutTransitionEnded = (event: TransitionEvent) => {
    if (
      /^(width|height|max-height|transform|translate|scale|grid-template-columns|gap|padding|margin)/.test(
        event.propertyName,
      )
    )
      this.geometryChanged();
  };
  private measure() {
    this.geometryDirty = false;
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height || !this.visible || !allowed()) return;
    if (this.elementsDirty) {
      const elements = new Set(
        [...this.host.querySelectorAll<HTMLElement>(safeSelector)].filter(
          (element) => {
            const parent = element.parentElement?.closest(safeSelector);
            return (
              !parent || parent === this.host || !this.host.contains(parent)
            );
          },
        ),
      );
      for (const element of this.elements)
        if (!elements.has(element)) this.resize.unobserve(element);
      for (const element of elements)
        if (!this.elements.has(element)) this.resize.observe(element);
      this.elements = elements;
      this.elementsDirty = false;
    }
    const safe: RainRect[] = [];
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
      safe.push({
        x: rect.left - box.left - 8,
        y: rect.top - box.top - 7,
        width: rect.width + 16,
        height: rect.height + 14,
      });
    }
    this.painter.configure({ width: box.width, height: box.height, safe });
  }
  draw(now: number) {
    if (this.geometryDirty) this.measure();
    this.painter.draw(now);
  }
  dispose() {
    this.disposed = true;
    unregister(this);
    this.resize.disconnect();
    this.mutations.disconnect();
    this.intersection.disconnect();
    window.removeEventListener('resize', this.geometryChanged);
    this.scrollRoot.removeEventListener('scroll', this.geometryChanged, true);
    this.host.removeEventListener('transitionend', this.layoutTransitionEnded);
    document.fonts?.removeEventListener('loadingdone', this.geometryChanged);
    this.painter.dispose();
    this.elements.clear();
  }
}

export function attachRain(
  canvas: HTMLCanvasElement,
  scope: RainScope,
  recovery?: { forceMain: boolean; failed: () => void },
): RainHandle {
  const noop = () => {};
  if (
    !window.ResizeObserver ||
    !window.IntersectionObserver ||
    !window.MutationObserver
  )
    return Object.assign(noop, { update: noop });
  try {
    const layer = new RainSurface(
      canvas,
      scope,
      recovery?.forceMain ?? false,
      recovery?.failed ?? noop,
    );
    return Object.assign(() => layer.dispose(), { update: layer.update });
  } catch {
    return Object.assign(noop, { update: noop });
  }
}
