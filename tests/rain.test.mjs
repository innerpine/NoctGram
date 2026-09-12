import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './lib/rain-engine'; export * from './lib/rain-preference'; export * from './lib/rain-options';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  packages: 'external',
  write: false,
  platform: 'node',
  format: 'cjs',
  define: { 'import.meta.url': '"file:///rain-painter.ts"' },
});
const compiled = { exports: {} };
// Run the actual local engine with deterministic browser clocks and canvas recording.
// eslint-disable-next-line typescript/no-implied-eval
new Function('require', 'module', 'exports', outputFiles[0].text)(
  require,
  compiled,
  compiled.exports,
);
const {
  attachRain,
  readRainPreference,
  rainEnabled,
  saveRainPreference,
  defaultRainOptions,
  readRainOptions,
} = compiled.exports;
const workerBuild = await build({
  entryPoints: ['lib/rain-worker.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
});
const workerSource = workerBuild.outputFiles[0].text;

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

function fixture(
  t,
  {
    coarse = false,
    reduced = false,
    worker = false,
    workerSupported = true,
  } = {},
) {
  const frames = new Map(),
    timers = new Map(),
    observers = [],
    disposals = [];
  let sequence = 0,
    geometryReads = 0,
    queries = 0;
  t.mock.method(Math, 'random', () => 0.5);
  const workers = [];
  class Offscreen {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {};
    }
  }
  class TestWorker {
    messages = [];
    outbox = [];
    frames = new Map();
    terminated = false;
    constructor() {
      workers.push(this);
      this.events = new Events();
      runInNewContext(workerSource, {
        Math,
        OffscreenCanvas: Offscreen,
        addEventListener: (...args) => this.events.addEventListener(...args),
        postMessage: (message) => this.outbox.push(message),
        requestAnimationFrame: workerSupported
          ? (callback) => {
              this.frames.set(++sequence, callback);
              return sequence;
            }
          : undefined,
        cancelAnimationFrame: (id) => this.frames.delete(id),
      });
    }
    postMessage(message) {
      assert.equal(this.terminated, false);
      this.messages.push(message);
      this.events.emit('message', { data: message });
    }
    async deliver() {
      for (const data of this.outbox.splice(0)) this.onmessage?.({ data });
      await Promise.resolve();
    }
    step(now) {
      const callbacks = [...this.frames.values()];
      this.frames.clear();
      callbacks.forEach((callback) => callback(now));
    }
    terminate() {
      this.terminated = true;
      this.frames.clear();
    }
  }
  class Observer {
    disconnected = false;
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target) {
      this.target = target;
    }
    unobserve() {}
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
  const safeBox = {
    left: 100,
    top: 80,
    right: 300,
    bottom: 140,
    width: 200,
    height: 60,
  };
  const safeElement = {
    nodeType: 1,
    parentElement: null,
    getBoundingClientRect() {
      geometryReads++;
      return safeBox;
    },
  };
  body.nodeType = 1;
  body.querySelectorAll = () => {
    queries++;
    return [safeElement];
  };
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
    Worker: worker ? TestWorker : undefined,
    OffscreenCanvas: worker ? Offscreen : undefined,
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
  function layer(scope = 'site', width = 1440, height = 900, recovery) {
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
    let transferred = false,
      failures = 0;
    const canvas = {
      width: 300,
      height: 150,
      parentElement: host,
      getContext: () => {
        assert.equal(
          transferred,
          false,
          'Transferred canvas cannot acquire a main-thread context',
        );
        return context;
      },
      transferControlToOffscreen() {
        assert.equal(transferred, false);
        transferred = true;
        return { width: 300, height: 150, getContext: () => context };
      },
      getBoundingClientRect() {
        geometryReads++;
        return { left: 0, top: 0, right: width, bottom: height, width, height };
      },
    };
    const cleanup = attachRain(
      canvas,
      scope,
      recovery || {
        forceMain: false,
        failed: () => {
          failures++;
        },
      },
    );
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
      context,
      update: cleanup.update,
      dispose,
      transferred: () => transferred,
      failures: () => failures,
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
    safeBox,
    safeElement,
    workers,
    queries: () => queries,
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
      ...defaultRainOptions,
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

await test('new rain controls migrate old preferences and bound invalid stored values', () => {
  assert.deepEqual(readRainPreference({ mode: 'player', player: 'full' }), {
    ...defaultRainOptions,
    mode: 'player',
    player: 'full',
  });
  assert.deepEqual(
    readRainOptions({ fps: 240, intensity: 1e6, speed: -20, brightness: NaN }),
    {
      fps: 'auto',
      intensity: 200,
      speed: 50,
      brightness: 100,
    },
  );
  assert.deepEqual(
    readRainOptions({
      fps: '120',
      intensity: '100',
      speed: Infinity,
      brightness: null,
    }),
    defaultRainOptions,
  );
  assert.deepEqual(
    readRainOptions({ fps: 120, intensity: 0, speed: 164, brightness: 999 }),
    {
      fps: 120,
      intensity: 25,
      speed: 165,
      brightness: 150,
    },
  );
});

await test('desktop clock paints at 60 FPS, is shared, protects content, and caches idle layout', (t) => {
  const f = fixture(t),
    site = f.layer(),
    dock = f.layer('dock', 320, 800);
  f.flush();
  f.step(0);
  site.operations.length = dock.operations.length = 0;
  const reads = f.reads();
  assert.equal(f.frames.size, 1);
  for (let i = 1; i <= 60; i++) f.step((i * 1000) / 60);
  assert.equal(f.reads(), reads);
  assert.equal(site.strokes(), 180);
  assert.equal(dock.strokes(), 180);
  assert.ok(
    site.operations.some(
      (operation) =>
        JSON.stringify(operation) ===
        JSON.stringify(['clearRect', 92, 73, 216, 74]),
    ),
    'Text/button rectangle stays clear, with padding',
  );
  assert.ok(
    site.operations.filter(([name]) => name === 'lineTo').length <= 90 * 60,
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

await test('full player pauses background rain until it closes', (t) => {
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
});

await test('continuous document/nested scrolling updates masks without blanking or restarting rain', (t) => {
  const f = fixture(t),
    site = f.layer(),
    dock = f.layer('dock', 320, 800);
  // Offscreen elements must remain in the cache so scrolling them into view is safe.
  f.safeBox.top = 1000;
  f.safeBox.bottom = 1060;
  f.step(0);
  const queries = f.queries();
  const firstY = site.operations.find(([name]) => name === 'moveTo')[2];
  for (let i = 1; i <= 60; i++) {
    site.operations.length = dock.operations.length = 0;
    f.safeBox.top = 200 - i;
    f.safeBox.bottom = f.safeBox.top + 60;
    const reads = f.reads();
    for (let event = 0; event < 4; event++) {
      f.document.emit('scroll');
      dock.host.emit('scroll');
    }
    assert.equal(
      site.operations.length + dock.operations.length,
      0,
      'Scroll never erases the painted frame',
    );
    assert.equal(
      f.reads(),
      reads,
      'Events coalesce without synchronous layout reads',
    );
    f.step((i * 1000) / 60);
    assert.equal(site.strokes(), 3);
    assert.equal(dock.strokes(), 3);
    assert.equal(f.frames.size, 1);
    assert.equal(
      f.reads() - reads,
      4,
      'One mask refresh per surface per paint',
    );
    assert.equal(f.queries(), queries, 'Scrolling reuses the element list');
    assert.ok(
      site.operations.some(
        (operation) =>
          JSON.stringify(operation) ===
          JSON.stringify(['clearRect', 92, f.safeBox.top - 7, 216, 74]),
      ),
    );
    const y = site.operations.find(([name]) => name === 'moveTo')[2];
    assert.ok(
      Math.abs(y - firstY - (245 * i) / 60) < 0.001,
      'Particles keep moving at the same speed',
    );
  }
  // New feed content refreshes masks on the next frame, without an erase/restart.
  site.operations.length = 0;
  f.observers[1].callback([{ type: 'childList', target: f.document.body }]);
  assert.equal(site.operations.length, 0);
  f.step(1017);
  assert.equal(site.strokes(), 3);
  assert.ok(f.queries() > queries);
});

await test('fractional RAF timing stays smooth on 60 Hz and caps high-refresh displays', (t) => {
  const f = fixture(t),
    layer = f.layer('site', 1440, 1600);
  f.step(0);
  let previousY = layer.operations.find(([name]) => name === 'moveTo')[2];
  let previousTime = 0;
  for (let i = 1; i <= 120; i++) {
    layer.operations.length = 0;
    const now = (i * 1000) / 60 + (i % 2 ? -0.2 : 0.2);
    f.step(now);
    assert.equal(
      layer.strokes(),
      3,
      'Small RAF jitter must not skip alternate frames',
    );
    const y = layer.operations.find(([name]) => name === 'moveTo')[2];
    assert.ok(
      Math.abs(y - previousY - (245 * (now - previousTime)) / 1000) < 0.001,
    );
    previousY = y;
    previousTime = now;
  }
  let paints = 0;
  for (let i = 1; i <= 144; i++) {
    layer.operations.length = 0;
    f.step(previousTime + (i * 1000) / 144);
    if (layer.strokes()) paints++;
  }
  assert.ok(
    paints >= 59 && paints <= 61,
    `144 Hz display produced ${paints} paints`,
  );
});

await test('mobile density and frame rate are lower and 4K bitmap memory stays bounded', (t) => {
  const f = fixture(t, { coarse: true }),
    layer = f.layer('site', 3840, 2160);
  f.flush();
  f.step(0);
  layer.operations.length = 0;
  assert.ok(layer.canvas.width * layer.canvas.height <= 1_202_500);
  for (let i = 1; i <= 60; i++) f.step((i * 1000) / 60);
  assert.equal(layer.strokes(), 90);
  assert.ok(
    layer.operations.filter(([name]) => name === 'lineTo').length <= 40 * 30,
  );
});

for (const fps of [30, 60, 90, 120]) {
  await test(`selected ${fps} FPS controls actual drawing on a high-refresh clock`, (t) => {
    const f = fixture(t),
      layer = f.layer();
    layer.update({ ...defaultRainOptions, fps });
    f.step(0);
    layer.operations.length = 0;
    for (let i = 1; i <= 240; i++) f.step((i * 1000) / 240);
    assert.equal(layer.strokes(), fps * 3);
    assert.equal(f.frames.size, 1);
  });
}

await test('120 FPS respects a 60 Hz screen and an explicit mobile choice overrides auto', (t) => {
  const f = fixture(t, { coarse: true }),
    layer = f.layer();
  layer.update({ ...defaultRainOptions, fps: 120 });
  f.step(0);
  layer.operations.length = 0;
  for (let i = 1; i <= 60; i++) f.step((i * 1000) / 60);
  assert.equal(layer.strokes(), 60 * 3);
  assert.equal(
    layer.operations.filter(([name]) => name === 'lineTo').length,
    40 * 60,
  );
});

await test('live tuning preserves particle positions and updates density, speed and brightness without a restart', (t) => {
  const f = fixture(t),
    layer = f.layer();
  f.step(0);
  f.step(1000 / 60);
  const previousY = layer.operations.filter(
    ([name]) => name === 'moveTo',
  )[86][2];
  const reads = f.reads(),
    observers = f.observers.length;
  layer.operations.length = 0;
  layer.update({ fps: 120, intensity: 200, speed: 150, brightness: 150 });
  assert.equal(
    layer.operations.length,
    0,
    'Changing a slider does not clear the bitmap',
  );
  f.step(25);
  assert.equal(f.observers.length, observers, 'No new renderer or observers');
  assert.equal(f.reads(), reads, 'Tuning does not rescan the page');
  assert.equal(
    layer.operations.filter(([name]) => name === 'lineTo').length,
    172,
  );
  assert.equal(layer.context.globalAlpha, 1);
  const y = layer.operations.find(([name]) => name === 'moveTo')[2];
  assert.ok(
    Math.abs(y - previousY - ((245 * (25 - 1000 / 60)) / 1000) * 1.5) < 0.001,
  );
  layer.operations.length = 0;
  layer.update({ ...defaultRainOptions, intensity: 25, brightness: 25 });
  f.step(42);
  assert.equal(
    layer.operations.filter(([name]) => name === 'lineTo').length,
    22,
  );
  assert.equal(layer.context.globalAlpha, 1 / 6);
});

for (const coarse of [false, true]) {
  await test(`maximum intensity keeps ${coarse ? 'mobile' : 'desktop'} particle and bitmap budgets bounded`, (t) => {
    const f = fixture(t, { coarse }),
      layer = f.layer('site', 3840, 2160),
      dock = f.layer('dock', 1000, 1000);
    layer.update({ ...defaultRainOptions, fps: 120, intensity: 10000 });
    dock.update({ ...defaultRainOptions, intensity: 10000 });
    f.step(0);
    assert.equal(
      layer.operations.filter(([name]) => name === 'lineTo').length,
      coarse ? 80 : 180,
    );
    assert.equal(
      dock.operations.filter(([name]) => name === 'lineTo').length,
      48,
    );
    assert.ok(layer.canvas.width * layer.canvas.height <= 1_202_500);
  });
}

await test('player text updates do not rescan protected content; resize and new posts still refresh masks', (t) => {
  const f = fixture(t),
    layer = f.layer();
  f.step(0);
  const reads = f.reads(),
    queries = f.queries();
  const text = { nodeType: 1, parentElement: f.safeElement };
  for (let i = 1; i <= 120; i++) {
    f.observers[1].callback([{ type: 'childList', target: text }]);
    f.observers[1].callback([{ type: 'attributes', target: text }]);
    f.step((i * 1000) / 60);
  }
  assert.equal(f.reads(), reads);
  assert.equal(f.queries(), queries);
  f.safeBox.height = 100;
  f.observers[0].callback([{ target: f.safeElement }]);
  f.step(2020);
  assert.equal(f.queries(), queries, 'Resize reuses tracked elements');
  assert.ok(
    layer.operations.some(
      (op) =>
        JSON.stringify(op) === JSON.stringify(['clearRect', 92, 73, 216, 114]),
    ),
  );
  f.observers[1].callback([{ type: 'childList', target: f.document.body }]);
  f.step(2040);
  assert.equal(f.queries(), queries + 1);
});

await test('one worker animates both surfaces while the main-thread frame clock is stopped', async (t) => {
  const f = fixture(t, { worker: true }),
    site = f.layer(),
    dock = f.layer('dock', 320, 800);
  assert.equal(f.workers.length, 1);
  f.step(0);
  await f.workers[0].deliver();
  const worker = f.workers[0];
  assert.equal(site.transferred(), true);
  assert.equal(dock.transferred(), true);
  assert.equal(
    f.frames.size,
    0,
    'No continuous main-thread animation callback',
  );
  assert.equal(worker.frames.size, 1, 'One independent worker clock');
  const reads = f.reads(),
    messages = worker.messages.length;
  worker.step(0);
  site.operations.length = dock.operations.length = 0;
  // The main clock deliberately receives no ticks, simulating a busy UI.
  for (let i = 1; i <= 60; i++) worker.step((i * 1000) / 60);
  assert.equal(site.strokes(), 180);
  assert.equal(dock.strokes(), 180);
  assert.equal(f.reads(), reads);
  assert.equal(
    worker.messages.length,
    messages,
    'No per-frame message traffic',
  );
  site.update({ ...defaultRainOptions, fps: 120, intensity: 200 });
  site.operations.length = 0;
  for (let i = 1; i <= 120; i++) worker.step(1000 + (i * 1000) / 120);
  assert.equal(site.strokes(), 360);
  f.safeBox.top = 120;
  f.document.emit('scroll');
  f.step(2001);
  assert.equal(f.frames.size, 0);
  worker.step(2010);
  assert.ok(
    site.operations.some(
      (op) =>
        JSON.stringify(op) === JSON.stringify(['clearRect', 92, 113, 216, 74]),
    ),
  );
});

await test('worker surfaces pause for full player, hidden tabs and reduced motion, then release the worker', async (t) => {
  const f = fixture(t, { worker: true }),
    site = f.layer();
  f.step(0);
  await f.workers[0].deliver();
  const worker = f.workers[0];
  worker.step(0);
  const full = f.layer('full');
  await Promise.resolve();
  f.step(20);
  const before = site.strokes();
  worker.step(20);
  worker.step(40);
  assert.equal(site.strokes(), before);
  assert.ok(full.strokes() > 0);
  full.dispose();
  worker.step(60);
  assert.ok(site.strokes() > before);
  f.document.hidden = true;
  f.document.emit('visibilitychange');
  assert.equal(worker.frames.size, 0);
  assert.equal(f.frames.size, 0);
  f.document.hidden = false;
  f.document.emit('visibilitychange');
  f.step(80);
  assert.equal(worker.frames.size, 1);
  f.motion.matches = true;
  f.motion.emit('change');
  assert.equal(worker.frames.size, 0);
  site.dispose();
  assert.equal(worker.terminated, true);
  assert.equal(f.timers.size, 0);
});

await test('unsupported worker falls back before transferring the canvas', async (t) => {
  const f = fixture(t, { worker: true, workerSupported: false }),
    layer = f.layer();
  f.step(0);
  await f.workers[0].deliver();
  assert.equal(layer.transferred(), false);
  assert.equal(f.workers[0].terminated, true);
  f.step(20);
  assert.ok(layer.strokes() > 0);
});

await test('startup timeout and disposal before worker readiness do not leave a blank or leaked renderer', async (t) => {
  const f = fixture(t, { worker: true }),
    layer = f.layer();
  f.step(0);
  f.flush(); // worker handshake never arrived
  f.step(20);
  assert.equal(layer.transferred(), false);
  assert.ok(layer.strokes() > 0);
  layer.dispose();
  const pending = f.layer();
  const worker = f.workers.at(-1);
  pending.dispose();
  await worker.deliver();
  assert.equal(pending.transferred(), false);
  assert.equal(worker.terminated, true);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
});

await test('failure after transfer requests a fresh canvas and recovers with the same preferences', async (t) => {
  const f = fixture(t, { worker: true }),
    layer = f.layer();
  f.step(0);
  await f.workers[0].deliver();
  f.workers[0].onerror();
  assert.equal(layer.failures(), 1);
  layer.dispose();
  const replacement = f.layer('site', 1440, 900, {
    forceMain: true,
    failed: () => assert.fail('Fallback failed'),
  });
  replacement.update({ ...defaultRainOptions, fps: 120, intensity: 25 });
  f.step(100);
  assert.equal(
    f.workers.length,
    1,
    'Recovery must not enter a worker restart loop',
  );
  assert.equal(
    replacement.operations.filter(([name]) => name === 'lineTo').length,
    22,
  );
});

await test('a development refresh recovers instead of reusing an already transferred canvas', async (t) => {
  const f = fixture(t, { worker: true }),
    first = f.layer();
  f.step(0);
  await f.workers[0].deliver();
  first.dispose();
  let replacements = 0;
  const refreshed = attachRain(first.canvas, 'site', {
    forceMain: false,
    failed: () => {
      replacements++;
    },
  });
  try {
    await f.workers.at(-1).deliver();
    assert.equal(
      replacements,
      1,
      'A fresh React canvas is requested after a transferred-canvas error',
    );
  } finally {
    refreshed();
  }
});

await test('device preferences persist and unsupported canvas does not break the page', (t) => {
  const f = fixture(t, { reduced: true });
  saveRainPreference({
    mode: 'player',
    player: 'full',
    fps: 120,
    intensity: 175,
    speed: 80,
    brightness: 125,
  });
  assert.deepEqual(JSON.parse(f.storage.get('noctgram:rain')), {
    mode: 'player',
    player: 'full',
    fps: 120,
    intensity: 175,
    speed: 80,
    brightness: 125,
  });
  saveRainPreference({ mode: 'off' });
  saveRainPreference({ mode: 'player' });
  assert.equal(
    JSON.parse(f.storage.get('noctgram:rain')).fps,
    120,
    'Off/on retains tuning',
  );
  saveRainPreference(defaultRainOptions);
  assert.deepEqual(
    JSON.parse(f.storage.get('noctgram:rain')),
    {
      ...defaultRainOptions,
      mode: 'player',
      player: 'full',
    },
    'Reset restores tuning without changing the selected surfaces',
  );
  globalThis.localStorage.setItem = () => {
    throw new Error('Storage blocked');
  };
  assert.doesNotThrow(() => saveRainPreference({ mode: 'off' }));
  assert.doesNotThrow(() => attachRain({ getContext: () => null }, 'site')());
  f.layer();
  f.flush();
  assert.equal(f.frames.size, 0);
});
