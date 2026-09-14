import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/mobile-navigation.ts'],
  bundle: true,
  write: false,
  format: 'esm',
});
const { createNavSpring, createMobileNavigation, isAppleTouchDevice } =
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );

function clock() {
  let id = 0,
    time = 100;
  const frames = new Map();
  return {
    requestAnimationFrame(fn) {
      frames.set(++id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    step(ms = 1000 / 60) {
      time += ms;
      const pending = [...frames.values()];
      frames.clear();
      for (const fn of pending) fn(time);
      assert.ok(frames.size <= 1, 'there is at most one animation loop');
    },
    get pending() {
      return frames.size;
    },
    settle(ms = 1000 / 60) {
      for (let i = 0; i < 240 && frames.size; i++) this.step(ms);
      assert.equal(frames.size, 0, 'idle navigation stops requesting frames');
    },
  };
}

void test('iPhone spring overshoots gently and settles exactly at 30, 60 and 120 Hz', () => {
  for (const hz of [30, 60, 120]) {
    const host = clock(),
      positions = [];
    const spring = createNavSpring(host, (x) => positions.push(x), true);
    spring.move(6, false);
    assert.equal(
      host.pending,
      0,
      'initial route never animates from another button',
    );
    spring.move(131, true);
    host.settle(1000 / hz);
    assert.equal(positions.at(-1), 131);
    assert.ok(Math.max(...positions) > 139);
    assert.ok(Math.max(...positions) < 156);
  }
});

void test('rapid retargeting keeps its current position and momentum without duplicate loops', () => {
  const host = clock(),
    positions = [];
  const spring = createNavSpring(host, (x) => positions.push(x), true);
  spring.move(6, false);
  spring.move(300, true);
  host.step();
  host.step();
  host.step();
  const previous = positions.at(-1),
    count = positions.length;
  spring.move(6, true);
  assert.equal(positions.length, count, 'retarget does not teleport the pill');
  host.step();
  assert.ok(
    positions.at(-1) > previous,
    'existing forward velocity decelerates before reversing',
  );
  spring.move(170, true);
  spring.move(240, true);
  host.step(4000);
  assert.ok(
    Number.isFinite(positions.at(-1)) && Math.abs(positions.at(-1)) < 400,
  );
  host.settle();
  assert.equal(positions.at(-1), 240);
});

void test('Android movement reaches the same destination without elastic overshoot', () => {
  const host = clock(),
    positions = [];
  const spring = createNavSpring(host, (x) => positions.push(x), false);
  spring.move(6, false);
  spring.move(240, true);
  host.settle();
  assert.equal(positions.at(-1), 240);
  assert.ok(
    positions.every((x, i) => x <= 240 && (!i || x >= positions[i - 1])),
  );
  spring.dispose();
  spring.move(80, true);
  assert.equal(host.pending, 0);
});

function fixture({ apple = true, mobile = true } = {}) {
  const host = clock();
  const mobileQuery = Object.assign(new EventTarget(), { matches: mobile });
  const reduced = Object.assign(new EventTarget(), { matches: false });
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const animations = [];
  const animate = () => {
    const animation = {
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
    };
    animations.push(animation);
    return animation;
  };
  const pill = { style: {} },
    shape = { animate };
  // DOM order is the desktop order; offsetLeft reflects the actual mobile grid.
  const links = [
    'feed',
    'search',
    'messages',
    'channels',
    'music',
    'profile',
  ].map((id) => ({
    dataset: { nav: id },
    offsetLeft:
      6 + ['feed', 'channels', 'messages', 'music', 'profile'].indexOf(id) * 70,
    offsetWidth: id === 'search' ? 0 : 70,
    querySelector: () => ({ animate }),
  }));
  const nav = Object.assign(new EventTarget(), {
    dataset: {},
    querySelector: (selector) =>
      selector === '.mobile-nav-pill' ? pill : shape,
    querySelectorAll: () => links,
  });
  let resize;
  Object.assign(host, {
    document: doc,
    navigator: {
      userAgent: apple ? 'iPhone' : 'Android',
      platform: '',
      maxTouchPoints: 5,
    },
    matchMedia: (query) => (query.includes('reduced') ? reduced : mobileQuery),
    ResizeObserver: class {
      constructor(callback) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        resize = undefined;
      }
    },
  });
  const controller = createMobileNavigation(nav, host);
  const change = (query, value) => {
    query.matches = value;
    query.dispatchEvent(new Event('change'));
  };
  return {
    host,
    controller,
    nav,
    pill,
    links,
    animations,
    doc,
    mobileQuery,
    reduced,
    change,
    resize() {
      resize?.();
    },
    get observing() {
      return !!resize;
    },
  };
}

void test('restored routes and mobile reorder use real button bounds, including resize', () => {
  const f = fixture();
  f.controller.select('messages');
  assert.equal(f.pill.style.transform, 'translate3d(146px, 0, 0)');
  assert.equal(f.pill.style.width, '70px');
  assert.equal(f.host.pending, 0);
  f.controller.select('channels');
  f.host.settle();
  assert.equal(f.pill.style.transform, 'translate3d(76px, 0, 0)');
  f.links.find((x) => x.dataset.nav === 'channels').offsetLeft = 84;
  f.resize();
  assert.equal(f.pill.style.transform, 'translate3d(84px, 0, 0)');
  assert.equal(f.host.pending, 0);
});

void test('Android never creates glass or icon deformation animations', () => {
  const f = fixture({ apple: false });
  f.controller.select('feed');
  f.controller.select('profile');
  f.host.settle();
  assert.equal(f.nav.dataset.navSurface, 'matte');
  assert.equal(f.animations.length, 0);
  assert.equal(f.pill.style.transform, 'translate3d(286px, 0, 0)');
});

void test('reduced motion cancels in-flight effects and follows route changes instantly', () => {
  const f = fixture();
  f.controller.select('feed');
  f.controller.select('profile');
  f.host.step();
  assert.equal(f.animations.length, 2);
  f.change(f.reduced, true);
  assert.equal(f.host.pending, 0);
  assert.ok(f.animations.every((x) => x.cancelled));
  f.controller.select('music');
  assert.equal(f.pill.style.transform, 'translate3d(216px, 0, 0)');
  assert.equal(f.animations.length, 2);
});

void test('backgrounding, leaving mobile layout, and unmount clean up all active work', () => {
  const f = fixture();
  f.controller.select('feed');
  f.controller.select('music');
  f.doc.hidden = true;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.host.pending, 0);
  assert.ok(f.animations.every((x) => x.cancelled));
  f.doc.hidden = false;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  f.controller.select('channels');
  f.change(f.mobileQuery, false);
  assert.equal(f.host.pending, 0);
  assert.equal(f.nav.dataset.navEnhanced, undefined);
  f.change(f.mobileQuery, true);
  assert.equal(f.pill.style.transform, 'translate3d(76px, 0, 0)');
  f.controller.select('profile');
  f.controller.dispose();
  assert.equal(f.host.pending, 0);
  assert.equal(f.observing, false);
  assert.ok(f.animations.every((x) => x.cancelled));
  f.change(f.mobileQuery, false);
  f.change(f.mobileQuery, true);
  f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.nav.dataset.navEnhanced, undefined);
});

void test('pages absent from the bottom bar clear the shared pill, then re-enter without a false slide', () => {
  const f = fixture();
  f.controller.select('feed');
  f.controller.select('search');
  assert.equal(f.nav.dataset.navEnhanced, undefined);
  f.controller.select('profile');
  assert.equal(f.host.pending, 0);
  assert.equal(f.pill.style.transform, 'translate3d(286px, 0, 0)');
});

void test('desktop has no mobile animation and Apple detection does not classify Macs or Android as iPhone', () => {
  const f = fixture({ mobile: false });
  f.controller.select('feed');
  f.controller.select('profile');
  assert.equal(f.host.pending, 0);
  assert.equal(f.animations.length, 0);
  assert.equal(f.nav.dataset.navEnhanced, undefined);
  for (const [device, expected] of [
    [{ userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 }, true],
    [{ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }, true],
    [
      { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 },
      false,
    ],
    [{ userAgent: 'Android', platform: 'Linux', maxTouchPoints: 5 }, false],
  ])
    assert.equal(isAppleTouchDevice(device), expected);
});
