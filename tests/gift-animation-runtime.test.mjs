import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Controlled browser APIs, no UI automation or real gift/account requests.
let now = 1000,
  serial = 0,
  constructions = 0,
  maxPlayers = 0,
  observerCount = 0;
const jobs = new Map(),
  players = new Set(),
  fetched = [],
  states = new Map();
class Target extends EventTarget {
  listeners = new Map();
  addEventListener(type, fn, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    super.addEventListener(type, fn, options);
  }
  removeEventListener(type, fn, options) {
    this.listeners.get(type)?.delete(fn);
    super.removeEventListener(type, fn, options);
  }
}
class Element extends Target {
  constructor() {
    super();
    this.parentElement = new Target();
  }
  contains(other) {
    return this === other;
  }
}
let observer;
class Observer {
  targets = new Set();
  constructor(callback) {
    observerCount++;
    this.callback = callback;
    observer = this;
  }
  observe(element) {
    this.targets.add(element);
  }
  unobserve(element) {
    this.targets.delete(element);
  }
  disconnect() {
    this.targets.clear();
  }
  show(elements) {
    this.callback(
      [...this.targets].map((target) => ({
        target,
        isIntersecting: elements.includes(target),
        intersectionRatio: elements.includes(target) ? 1 : 0,
      })),
    );
  }
}
const document = Object.assign(new Target(), { hidden: false });
const window = Object.assign(new Target(), { devicePixelRatio: 3 });
const motion = Object.assign(new Target(), { matches: false });
const lottie = {
  loadAnimation(options) {
    const masked = options.animationData.layers?.some(
      (layer) => layer.ty === 'gf',
    );
    assert.equal(options.renderer, masked ? 'svg' : 'canvas');
    assert.equal(options.autoplay, false);
    if (!masked) assert.ok(options.rendererSettings.dpr <= 1.5);
    constructions++;
    const player = {
      frameRate: 60,
      totalFrames: 180,
      isLoaded: true,
      draws: 0,
      setSubframe() {},
      addEventListener() {},
      resize() {},
      goToAndStop(frame) {
        assert.ok(frame >= 0 && frame < 180);
        this.draws++;
      },
      destroy() {
        players.delete(this);
      },
    };
    players.add(player);
    maxPlayers = Math.max(maxPlayers, players.size);
    return player;
  },
};
let pendingFetch;
const globals = {
  document,
  window,
  Element,
  IntersectionObserver: Observer,
  matchMedia: () => motion,
  performance: { now: () => now },
  setTimeout: (fn, delay = 0) => {
    const id = ++serial;
    jobs.set(id, { at: now + delay, fn });
    return id;
  },
  clearTimeout: (id) => jobs.delete(id),
  requestAnimationFrame: (fn) => {
    const id = ++serial;
    jobs.set(id, { at: now + 16, fn: () => fn(now), frame: true });
    return id;
  },
  cancelAnimationFrame: (id) => jobs.delete(id),
  fetch: async (url) => {
    fetched.push(url);
    if (url.includes('pending-test'))
      await new Promise((resolve) => {
        pendingFetch = resolve;
      });
    return {
      ok: true,
      json: async () => ({
        layers: url.includes('masked-test')
          ? [
              {
                ty: 'gf',
                g: { p: 2, k: { k: [0, 1, 1, 1, 1, 1, 1, 1, 0.4, 0.2, 1, 1] } },
              },
            ]
          : [],
        fr: 60,
      }),
    };
  },
  __giftLottie: lottie,
};
const saved = new Map(
  Object.keys(globals).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
const flush = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
async function advance(ms) {
  const end = now + ms;
  let iterations = 0;
  while (true) {
    await flush();
    const next = [...jobs]
      .filter(([, job]) => job.at <= end)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    assert.ok(++iterations < 10000, 'Scheduler must settle, not spin');
    const [id, job] = next;
    jobs.delete(id);
    now = job.at;
    job.fn();
  }
  now = end;
  await flush();
}
try {
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  const compiled = await build({
    entryPoints: ['lib/gift-animation-runtime.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'controlled-lottie',
        setup(build) {
          build.onResolve({ filter: /^lottie-web/ }, () => ({
            path: 'lottie',
            namespace: 'fixture',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export default globalThis.__giftLottie;',
          }));
        },
      },
    ],
  });
  const { mountGiftAnimation } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );
  const hosts = Array.from({ length: 144 }, () => new Element());
  const cleanup = hosts.map((host, i) =>
    mountGiftAnimation(host, 'gift_' + i, (loaded) => states.set(host, loaded)),
  );
  await advance(100);
  assert.equal(fetched.length, 0, 'Offscreen catalog entries fetch nothing');
  assert.equal(observerCount, 1, '144 entries share one visibility observer');
  observer.show(hosts.slice(0, 6));
  await advance(150);
  assert.equal(constructions, 0, 'Do not initialize while scrolling/settling');
  await advance(900);
  assert.equal(players.size, 6);
  const player = [...players][0],
    beforeFrames = player.draws;
  await advance(1000);
  assert.ok(
    player.draws - beforeFrames >= 25 && player.draws - beforeFrames <= 32,
    'Animation duration is preserved at approximately 30 fps',
  );
  const beforeScroll = constructions;
  for (let i = 1; i <= 12; i++) {
    document.dispatchEvent(new Event('scroll'));
    observer.show(hosts.slice(i * 6, i * 6 + 6));
    await advance(40);
  }
  assert.equal(
    constructions,
    beforeScroll,
    'Fast scrolling does not repeatedly construct and destroy animations',
  );
  await advance(1000);
  assert.ok(
    maxPlayers <= 8,
    'Decoded renderers remain bounded after scrolling',
  );
  assert.equal(
    constructions,
    beforeScroll + 6,
    'Only the final visible group loads',
  );
  const beforeHidden = [...players].reduce((sum, item) => sum + item.draws, 0);
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  await advance(1000);
  assert.equal(
    [...players].reduce((sum, item) => sum + item.draws, 0),
    beforeHidden,
  );
  document.hidden = false;
  motion.matches = true;
  motion.dispatchEvent(new Event('change'));
  await advance(1000);
  assert.equal(players.size, 0, 'Reduced motion uses static posters');
  motion.matches = false;
  motion.dispatchEvent(new Event('change'));
  await advance(1000);
  assert.ok(players.size > 0, 'Animations resume when motion is enabled');
  cleanup.forEach((dispose) => dispose());
  await advance(1000);
  assert.equal(players.size, 0);
  assert.equal(jobs.size, 0, 'Closing all gifts removes animation work');
  assert.equal(
    [...document.listeners.values()].reduce(
      (sum, listeners) => sum + listeners.size,
      0,
    ),
    0,
  );
  const late = new Element();
  const close = mountGiftAnimation(late, 'pending-test', () => {});
  observer.show([late]);
  await advance(200);
  assert.equal(typeof pendingFetch, 'function');
  close();
  pendingFetch();
  await advance(500);
  assert.equal(players.size, 0, 'Late fetch cannot mount after closing');
  const masked = new Element();
  const closeMasked = mountGiftAnimation(masked, 'masked-test', () => {});
  observer.show([masked]);
  await advance(1000);
  assert.equal(
    players.size,
    1,
    'SVG fallback shares the scheduler and stays animated',
  );
  closeMasked();
  await advance(500);
  assert.equal(players.size, 0, 'SVG fallback is released on close');
  console.log(
    'Gift performance: 144 entries / one observer, no work during rapid scrolling, at most 8 players / 6 playing, 30 fps, Canvas/SVG selection and hidden/reduced-motion/late-response cleanup passed.',
  );
} finally {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
