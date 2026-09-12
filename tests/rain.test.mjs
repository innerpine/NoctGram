import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './lib/rain-engine'; export * from './lib/rain-preference';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  packages: 'external',
  write: false,
  platform: 'node',
  format: 'cjs',
});
const compiled = { exports: {} };
// Run the actual local engine with deterministic browser clocks and canvas recording.
// eslint-disable-next-line typescript/no-implied-eval
new Function('require', 'module', 'exports', outputFiles[0].text)(
  require,
  compiled,
  compiled.exports,
);
const { attachRain, readRainPreference, rainEnabled, saveRainPreference } =
  compiled.exports;

class Events {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) {
    this.listeners.get(name)?.delete(callback);
  }
  emit(name, event = {}) {
    for (const callback of this.listeners.get(name) || []) callback(event);
  }
  count() {
    return [...this.listeners.values()].reduce(
      (sum, listeners) => sum + listeners.size,
      0,
    );
  }
}

function fixture(t, { coarse = false, reduced = false } = {}) {
  const frames = new Map(),
    timers = new Map(),
    observers = [],
    disposals = [];
  let sequence = 0,
    geometryReads = 0;
  class Observer {
    disconnected = false;
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target) {
      this.target = target;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const window = new Events();
  Object.assign(window, {
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    MutationObserver: Observer,
  });
  const body = new Events();
  body.contains = () => true;
  body.querySelectorAll = () => [
    {
      parentElement: null,
      getBoundingClientRect() {
        geometryReads++;
        return {
          left: 100,
          top: 80,
          right: 300,
          bottom: 140,
          width: 200,
          height: 60,
        };
      },
    },
  ];
  const document = Object.assign(new Events(), {
    body,
    hidden: false,
    fonts: new Events(),
  });
  const motion = Object.assign(new Events(), { matches: reduced });
  const storage = new Map();
  const globals = {
    window,
    document,
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    MutationObserver: Observer,
    matchMedia: (query) =>
      query.includes('pointer') ? { matches: coarse } : motion,
    requestAnimationFrame: (callback) => {
      frames.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback) => {
      timers.set(++sequence, callback);
      return sequence;
    },
    clearTimeout: (id) => timers.delete(id),
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  const before = Object.fromEntries(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  t.after(() => {
    disposals.forEach((dispose) => dispose());
    for (const [key, descriptor] of Object.entries(before)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const flush = () => {
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach((callback) => callback());
  };
  const step = (now) => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(now));
  };
  function layer(scope = 'site', width = 1440, height = 900) {
    const operations = [];
    const context = Object.fromEntries(
      [
        'clearRect',
        'setTransform',
        'beginPath',
        'moveTo',
        'lineTo',
        'stroke',
      ].map((name) => [name, (...args) => operations.push([name, ...args])]),
    );
    const host = Object.assign(new Events(), {
      contains: () => true,
      querySelectorAll: body.querySelectorAll,
    });
    const canvas = {
      width: 300,
      height: 150,
      parentElement: host,
      getContext: () => context,
      getBoundingClientRect() {
        geometryReads++;
        return { left: 0, top: 0, right: width, bottom: height, width, height };
      },
    };
    const cleanup = attachRain(canvas, scope);
    let disposed = false;
    const dispose = () => {
      if (!disposed) {
        disposed = true;
        cleanup();
      }
    };
    disposals.push(dispose);
    return {
      canvas,
      host,
      operations,
      dispose,
      strokes: () => operations.filter(([name]) => name === 'stroke').length,
    };
  }
  return {
    layer,
    flush,
    step,
    frames,
    timers,
    observers,
    window,
    document,
    motion,
    storage,
    reads: () => geometryReads,
  };
}

await test('rain modes select only their surfaces and malformed settings stay bounded', () => {
  for (const input of [
    null,
    undefined,
    'bad',
    [],
    {},
    { mode: 'all', player: 'invalid' },
  ])
    assert.deepEqual(readRainPreference(input), {
      mode: 'site',
      player: 'full-and-dock',
    });
  const scopes = ['site', 'full', 'dock'];
  for (const [mode, player, expected] of [
    ['off', 'full-and-dock', [false, false, false]],
    ['site', 'full-and-dock', [true, true, true]],
    ['site', 'full', [true, true, false]],
    ['player', 'full-and-dock', [false, true, true]],
    ['player', 'full', [false, true, false]],
  ])
    assert.deepEqual(
      scopes.map((scope) => rainEnabled({ mode, player }, scope)),
      expected,
    );
});

await test('desktop clock is shared, capped, protects content, and never reads layout per frame', (t) => {
  const f = fixture(t),
    site = f.layer(),
    dock = f.layer('dock', 320, 800);
  f.flush();
  const reads = f.reads();
  assert.equal(f.frames.size, 1);
  for (let i = 1; i <= 60; i++) f.step((i * 1000) / 60);
  assert.equal(f.reads(), reads);
  assert.ok(site.strokes() > 30 && site.strokes() <= 90);
  assert.ok(dock.strokes() > 0 && dock.strokes() <= 90);
  assert.ok(
    site.operations.some(
      (operation) =>
        JSON.stringify(operation) ===
        JSON.stringify(['clearRect', 92, 73, 216, 74]),
    ),
    'Text/button rectangle stays clear, with padding',
  );
  assert.ok(
    site.operations.filter(([name]) => name === 'lineTo').length <= 90 * 30,
  );
  assert.equal(f.frames.size, 1);
});

await test('hidden tabs, reduced motion, and closed surfaces stop drawing and release resources', (t) => {
  const f = fixture(t),
    layer = f.layer();
  f.flush();
  f.step(100);
  f.document.hidden = true;
  f.document.emit('visibilitychange');
  assert.equal(f.frames.size, 0);
  const strokes = layer.strokes();
  f.step(200);
  assert.equal(layer.strokes(), strokes);
  f.document.hidden = false;
  f.document.emit('visibilitychange');
  f.flush();
  f.step(300);
  assert.ok(layer.strokes() > strokes);
  f.motion.matches = true;
  f.motion.emit('change');
  assert.equal(f.frames.size, 0);
  f.motion.matches = false;
  f.motion.emit('change');
  f.flush();
  assert.equal(f.frames.size, 1);
  layer.dispose();
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(
    f.window.count() +
      f.document.count() +
      f.document.fonts.count() +
      f.motion.count() +
      f.document.body.count(),
    0,
  );
  assert.ok(f.observers.every((observer) => observer.disconnected));
  assert.equal(layer.canvas.width * layer.canvas.height, 0);
});

await test('full player pauses background rain and scrolling waits for fresh safe geometry', (t) => {
  const f = fixture(t),
    site = f.layer();
  f.flush();
  f.step(100);
  const full = f.layer('full');
  f.flush();
  const before = site.strokes();
  for (let i = 1; i <= 10; i++) f.step(100 + i * 40);
  assert.equal(site.strokes(), before);
  assert.ok(full.strokes() > 0);
  full.dispose();
  f.step(600);
  assert.ok(site.strokes() > before);
  f.document.body.emit('scroll');
  const stopped = site.strokes();
  f.step(700);
  assert.equal(site.strokes(), stopped);
  assert.equal(f.frames.size, 0);
  f.flush();
  f.step(800);
  assert.ok(site.strokes() > stopped);
});

await test('mobile density and frame rate are lower and 4K bitmap memory stays bounded', (t) => {
  const f = fixture(t, { coarse: true }),
    layer = f.layer('site', 3840, 2160);
  f.flush();
  assert.ok(layer.canvas.width * layer.canvas.height <= 1_202_500);
  for (let i = 1; i <= 60; i++) f.step((i * 1000) / 60);
  assert.ok(layer.strokes() > 0 && layer.strokes() <= 60);
  assert.ok(
    layer.operations.filter(([name]) => name === 'lineTo').length <= 40 * 20,
  );
});

await test('device preferences persist and unsupported canvas does not break the page', (t) => {
  const f = fixture(t, { reduced: true });
  saveRainPreference({ mode: 'player', player: 'full' });
  assert.deepEqual(JSON.parse(f.storage.get('noctgram:rain')), {
    mode: 'player',
    player: 'full',
  });
  globalThis.localStorage.setItem = () => {
    throw new Error('Storage blocked');
  };
  assert.doesNotThrow(() => saveRainPreference({ mode: 'off' }));
  assert.doesNotThrow(() => attachRain({ getContext: () => null }, 'site')());
  f.layer();
  f.flush();
  assert.equal(f.frames.size, 0);
});
