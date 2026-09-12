import { premiumEmoji } from './premium-emoji';
import type { AnimationItem, LottiePlayer } from 'lottie-web';
import { giftRenderer, type GiftRenderer } from './gift-renderer';

// One scheduler for the catalog, profile and chat. Frames stay out of React.
const MAX_PLAYERS = 8;
const MAX_PLAYING = 6;
const FRAME_MS = 1000 / 30;
const SCROLL_SETTLE_MS = 180;
type Entry = {
  host: HTMLElement;
  id: string;
  loaded: (value: boolean) => void;
  visible: boolean;
  settledAt: number;
  usedAt: number;
  elapsed: number;
  player?: AnimationItem;
  ready?: boolean;
  failed?: boolean;
};
const entries = new Map<Element, Entry>();
const dataCache = new Map<string, Promise<object>>();
let observer: IntersectionObserver | undefined;
let motion: MediaQueryList | undefined;
let frame = 0;
let previousFrame = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let loading = false;
const libraries: Partial<Record<GiftRenderer, Promise<LottiePlayer>>> = {};
function libraryFor(renderer: GiftRenderer) {
  return (libraries[renderer] ??= (
    renderer === 'svg'
      ? import('lottie-web/build/player/lottie_light')
      : import('lottie-web/build/player/lottie_light_canvas')
  )
    .then((module) => module.default)
    .catch((error) => {
      delete libraries[renderer];
      throw error;
    }));
}

function dataFor(id: string) {
  const cached = dataCache.get(id);
  if (cached) {
    dataCache.delete(id);
    dataCache.set(id, cached);
    return cached;
  }
  const emoji = id.startsWith('emoji:')
    ? premiumEmoji.find((e) => e.id === id.slice(6))
    : null;
  const asset = emoji
    ? '/assets/emoji/' + emoji.id + '.json'
    : '/assets/gifts/' + encodeURIComponent(id) + (id.startsWith('collectible-') ? '.tgs' : '.json');
  const promise: Promise<object> = fetch(asset, {
    signal: AbortSignal.timeout(15000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error('Gift animation unavailable');
      if (id.startsWith('collectible-')) {
        if (!response.body) throw new Error('Missing collectible animation');
        const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).json() as Promise<object>;
      }
      return response.json() as Promise<object>;
    })
    .catch((error) => {
      if (dataCache.get(id) === promise) dataCache.delete(id);
      throw error;
    });
  dataCache.set(id, promise);
  if (dataCache.size > 24) dataCache.delete(dataCache.keys().next().value!);
  return promise;
}
function selected(now: number) {
  if (document.hidden || motion?.matches) return [];
  return [...entries.values()]
    .filter((entry) => entry.visible && entry.settledAt <= now && !entry.failed)
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, MAX_PLAYING);
}
function release(entry: Entry) {
  entry.player?.destroy();
  entry.player = undefined;
  entry.ready = false;
  entry.loaded(false);
}
function draw(now: number) {
  frame = 0;
  const active = selected(now).filter((entry) => entry.ready && entry.player);
  if (!active.length) {
    previousFrame = 0;
    return;
  }
  const delta = previousFrame ? now - previousFrame : FRAME_MS;
  if (delta >= FRAME_MS) {
    const elapsed = Math.floor(delta / FRAME_MS) * FRAME_MS;
    previousFrame = now - (delta % FRAME_MS);
    for (const entry of active) {
      entry.elapsed += Math.min(elapsed, 100);
      const player = entry.player!;
      player.goToAndStop(
        ((entry.elapsed * player.frameRate) / 1000) % player.totalFrames,
        true,
      );
    }
  }
  frame = requestAnimationFrame(draw);
}
function schedule(delay = 0) {
  if (!entries.size) return;
  if (!frame && selected(performance.now()).some((entry) => entry.ready))
    frame = requestAnimationFrame(draw);
  if (timer !== undefined || loading) return;
  timer = setTimeout(() => {
    timer = undefined;
    void prepare();
  }, delay);
}
async function prepare() {
  const now = performance.now();
  const candidates = selected(now);
  const entry = candidates.find((candidate) => !candidate.player);
  if (!entry) {
    const waiting = [...entries.values()].filter(
      (item) => item.visible && item.settledAt > now,
    );
    if (waiting.length)
      schedule(
        Math.max(1, Math.min(...waiting.map((item) => item.settledAt)) - now),
      );
    return;
  }
  loading = true;
  try {
    const data = await dataFor(entry.id);
    if (
      entries.get(entry.host) !== entry ||
      !selected(performance.now()).includes(entry)
    )
      return;
    const renderer = giftRenderer(data);
    const lottie = await libraryFor(renderer);
    if (
      entries.get(entry.host) !== entry ||
      !selected(performance.now()).includes(entry)
    )
      return;
    const players = [...entries.values()].filter((item) => item.player);
    if (players.length >= MAX_PLAYERS) {
      const victim = players
        .filter((item) => !candidates.includes(item))
        .sort((a, b) => a.usedAt - b.usedAt)[0];
      if (!victim) return;
      release(victim);
    }
    const player = lottie.loadAnimation({
      container: entry.host,
      renderer,
      loop: false,
      autoplay: false,
      animationData: structuredClone(data),
      rendererSettings:
        renderer === 'canvas'
          ? {
              clearCanvas: true,
              dpr: Math.min(window.devicePixelRatio || 1, 1.5),
            }
          : { progressiveLoad: true },
    });
    entry.player = player;
    player.setSubframe(false);
    const ready = () => {
      if (entries.get(entry.host) !== entry || entry.player !== player) return;
      entry.ready = true;
      player.goToAndStop(0, true);
      entry.loaded(true);
      schedule();
    };
    player.addEventListener('DOMLoaded', ready);
    player.addEventListener('data_failed', () => {
      if (entries.get(entry.host) !== entry || entry.player !== player) return;
      entry.failed = true;
      release(entry);
      schedule();
    });
    if (player.isLoaded) ready();
  } catch {
    if (entries.get(entry.host) === entry) entry.failed = true;
  } finally {
    loading = false;
    // Spread construction across separate tasks, never a burst of six SVG trees.
    schedule(32);
  }
}
function scroll(event: Event) {
  const target = event.target;
  const all = target === document;
  const now = performance.now();
  for (const entry of entries.values()) {
    if (all || (target instanceof Element && target.contains(entry.host)))
      entry.settledAt = now + SCROLL_SETTLE_MS;
  }
  schedule(SCROLL_SETTLE_MS);
}
function visibility() {
  if (document.hidden || motion?.matches) {
    cancelAnimationFrame(frame);
    frame = 0;
    previousFrame = 0;
    if (motion?.matches) for (const entry of entries.values()) release(entry);
  } else schedule();
}
function resize() {
  for (const entry of entries.values()) entry.player?.resize();
}
export function mountGiftAnimation(
  host: HTMLElement,
  id: string,
  loaded: Entry['loaded'],
) {
  const entry: Entry = {
    host,
    id,
    loaded,
    visible: false,
    settledAt: 0,
    usedAt: 0,
    elapsed: 0,
  };
  entries.set(host, entry);
  if (!observer) {
    motion = matchMedia('(prefers-reduced-motion: reduce)');
    observer = new IntersectionObserver(
      (changes) => {
        const now = performance.now();
        for (const change of changes) {
          const item = entries.get(change.target);
          if (!item) continue;
          item.visible =
            change.isIntersecting && change.intersectionRatio >= 0.3;
          if (item.visible) {
            item.usedAt = now;
            item.settledAt = now + SCROLL_SETTLE_MS;
          }
        }
        schedule(SCROLL_SETTLE_MS);
      },
      { threshold: [0, 0.3] },
    );
    document.addEventListener('scroll', scroll, {
      capture: true,
      passive: true,
    });
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', visibility);
    window.addEventListener('resize', resize);
  }
  observer.observe(host);
  const prioritize = () => {
    entry.usedAt = performance.now() + 1;
    schedule();
  };
  host.parentElement?.addEventListener('pointerenter', prioritize);
  return () => {
    host.parentElement?.removeEventListener('pointerenter', prioritize);
    observer?.unobserve(host);
    entries.delete(host);
    entry.loaded = () => {};
    release(entry);
    if (entries.size) schedule();
    else {
      observer?.disconnect();
      observer = undefined;
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('visibilitychange', visibility);
      motion?.removeEventListener('change', visibility);
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frame);
      frame = 0;
      previousFrame = 0;
      clearTimeout(timer);
      timer = undefined;
    }
  };
}
