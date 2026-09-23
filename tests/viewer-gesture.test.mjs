import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/viewer-gesture.ts'],
  bundle: true,
  write: false,
  format: 'esm',
});
const {
  shouldDismiss,
  zoomAbout,
  panLimit,
  bandInto,
  originTransform,
  sheetPosition,
  sheetTarget,
  attachViewerGesture,
} = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

void test('dismissal: a flick decides by direction, otherwise the (projected) share of the height', () => {
  const player = { share: 0.3, speed: 300, momentum: true },
    story = { share: 0.25, speed: 500 };
  assert.equal(shouldDismiss(20, 400, 800, player), true);
  assert.equal(shouldDismiss(200, 250, 800, player), true, 'momentum counts');
  assert.equal(shouldDismiss(200, 0, 800, player), false);
  assert.equal(shouldDismiss(150, 400, 800, story), false);
  assert.equal(shouldDismiss(210, 0, 800, story), true);
  assert.equal(shouldDismiss(600, -900, 800, story), false, 'flicked back');
});

void test('zoom keeps the pinched point still and pans only within the picture', () => {
  const pan = { x: 30, y: -10 },
    point = { x: 120, y: 80 };
  const next = zoomAbout(pan, 1.5, 3, point);
  // The content under the point (pan + scale * content) stays under it.
  for (const axis of ['x', 'y']) {
    const content = (point[axis] - pan[axis]) / 1.5;
    assert.ok(Math.abs(next[axis] + 3 * content - point[axis]) < 1e-9);
  }
  assert.equal(panLimit(400, 400, 1), 0);
  assert.equal(panLimit(400, 400, 2.5), 300);
  assert.equal(panLimit(200, 400, 1.5), 0, 'a narrow picture stays centred');
  assert.equal(bandInto(50, -100, 100, 400), 50);
  assert.ok(bandInto(160, -100, 100, 400) < 160);
  assert.ok(bandInto(160, -100, 100, 400) > 100);
  assert.ok(bandInto(-160, -100, 100, 400) > -160);
  assert.equal(
    originTransform(
      { x: 200, y: 400, width: 400 },
      { left: 10, top: 700, width: 40, height: 40 },
    ),
    'translate(-170px, 320px) scale(0.1)',
  );
  assert.equal(originTransform({ x: 0, y: 0, width: 0 }, { width: 10 }), '');
});

void test('mini player sheet: 1:1 between the states, rubber band past them, velocity or nearest rest decides', () => {
  assert.deepEqual(sheetPosition(40, 80), { progress: 0.5, overshoot: 0 });
  const above = sheetPosition(-60, 80),
    below = sheetPosition(140, 80);
  assert.equal(above.progress, 0);
  assert.ok(above.overshoot < 0 && above.overshoot > -60);
  assert.equal(below.progress, 1);
  assert.ok(below.overshoot > 0 && below.overshoot < 60);
  assert.deepEqual(sheetTarget(10, 450, 80), { collapsed: true, flick: true });
  assert.deepEqual(sheetTarget(70, -450, 80), {
    collapsed: false,
    flick: true,
  });
  assert.deepEqual(sheetTarget(35, 150, 80), {
    collapsed: true,
    flick: false,
  });
  assert.deepEqual(sheetTarget(45, -150, 80), {
    collapsed: false,
    flick: false,
  });
});

function fixture({ zoom, ...hooks } = {}) {
  let now = 0,
    frameId = 0;
  const frames = new Map(),
    timers = new Map();
  const host = {
    requestAnimationFrame(fn) {
      frames.set(++frameId, fn);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout(fn, ms) {
      timers.set(++frameId, { fn, at: now + ms });
      return frameId;
    },
    clearTimeout: (id) => timers.delete(id),
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ overflowY: 'visible' }),
  };
  globalThis.Element ??= class Element extends EventTarget {};
  const sheet = new Element();
  const props = new Map(),
    attributes = new Set();
  Object.assign(sheet, {
    props,
    attributes,
    ownerDocument: { defaultView: host },
    parentElement: null,
    offsetHeight: 800,
    style: {
      setProperty: (name, value) => props.set(name, value),
      removeProperty: (name) => props.delete(name),
    },
    setAttribute: (name) => attributes.add(name),
    removeAttribute: (name) => attributes.delete(name),
    toggleAttribute: (name, on) =>
      on ? attributes.add(name) : attributes.delete(name),
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
  });
  const backdrop = { style: {} };
  const calls = { dismiss: 0, taps: [] };
  performance.now = () => now;
  const gesture = attachViewerGesture(sheet, {
    accepts: () => true,
    dismiss: { share: 0.25, speed: 500 },
    onDismiss: () => calls.dismiss++,
    backdrop: () => backdrop,
    zoom: zoom ? () => zoom : undefined,
    onTap: (x, width) => calls.taps.push([x, width]),
    ...hooks,
  });
  const pointer = (type, id, x, y) =>
    sheet.dispatchEvent(
      Object.assign(new Event(type), {
        pointerId: id,
        pointerType: 'touch',
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
  return {
    sheet,
    props,
    attributes,
    backdrop,
    calls,
    gesture,
    pointer,
    advance(ms) {
      now += ms;
      for (const [id, timer] of timers)
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn(now));
    },
    settle() {
      for (let i = 0; i < 400 && frames.size; i++) this.advance(1000 / 60);
    },
    restore() {
      gesture.dispose();
      delete performance.now;
    },
  };
}

void test('drag to close: 10 px slop, 1:1 tracking, flick or quarter height closes, otherwise springs back', () => {
  const f = fixture();
  // A slow drag of 150 px (under a quarter) springs back.
  f.pointer('pointerdown', 1, 200, 100);
  f.pointer('pointermove', 1, 200, 106);
  f.advance(16);
  assert.equal(f.props.get('--drag-y'), undefined, 'inside the slop');
  for (let y = 120; y <= 260; y += 10) {
    f.advance(60);
    f.pointer('pointermove', 1, 200, y);
  }
  f.advance(16);
  assert.equal(f.props.get('--drag-y'), '140px', '1:1 after the slop');
  assert.ok(f.attributes.has('data-dragging'));
  assert.ok(Number(f.backdrop.style.opacity) < 1);
  f.advance(200);
  f.pointer('pointerup', 1, 200, 260);
  assert.equal(f.calls.dismiss, 0);
  f.settle();
  assert.equal(f.props.get('--drag-y'), undefined);
  assert.equal(f.attributes.has('data-dragging'), false);
  assert.equal(f.backdrop.style.opacity, '');
  assert.deepEqual(f.calls.taps, [], 'a drag is not a tap');
  // A quick 60 px flick closes.
  f.pointer('pointerdown', 2, 200, 100);
  for (let y = 115; y <= 175; y += 15) {
    f.advance(15);
    f.pointer('pointermove', 2, 200, y);
  }
  f.pointer('pointerup', 2, 200, 175);
  assert.equal(f.calls.dismiss, 1);
  assert.equal(f.backdrop.style.opacity, '0');
  f.gesture.reset();
  // Upward is rubber-banded, never 1:1.
  f.pointer('pointerdown', 3, 200, 400);
  f.pointer('pointermove', 3, 200, 385);
  f.advance(40);
  f.pointer('pointermove', 3, 200, 200);
  f.advance(16);
  const up = parseFloat(f.props.get('--drag-y'));
  assert.ok(up < 0 && up > -185);
  f.pointer('pointercancel', 3, 200, 200);
  f.settle();
  assert.equal(f.calls.dismiss, 1, 'a cancelled drag springs back');
  f.restore();
});

void test('taps, holds and a grab mid-spring', () => {
  const holds = [];
  const f = fixture({ onHold: (held) => holds.push(held) });
  f.pointer('pointerdown', 1, 100, 300);
  f.advance(50);
  f.pointer('pointerup', 1, 102, 303);
  assert.deepEqual(f.calls.taps, [[102, 400]]);
  f.pointer('pointerdown', 2, 300, 300);
  f.advance(250);
  assert.deepEqual(holds, [true]);
  f.pointer('pointerup', 2, 300, 300);
  assert.deepEqual(holds, [true, false]);
  assert.equal(f.calls.taps.length, 1, 'releasing a hold is not a tap');
  // Release mid-drag, then catch it while it springs back.
  f.pointer('pointerdown', 3, 200, 100);
  f.pointer('pointermove', 3, 200, 120);
  f.advance(100);
  f.pointer('pointermove', 3, 200, 220);
  f.advance(300);
  f.pointer('pointerup', 3, 200, 220);
  f.advance(16);
  f.advance(16);
  const flying = parseFloat(f.props.get('--drag-y'));
  assert.ok(flying > 0 && flying < 100);
  f.pointer('pointerdown', 4, 200, 500);
  f.advance(16);
  f.advance(16);
  assert.equal(parseFloat(f.props.get('--drag-y')), flying, 'held in place');
  f.pointer('pointermove', 4, 200, 520);
  f.advance(16);
  assert.ok(Math.abs(parseFloat(f.props.get('--drag-y')) - flying - 20) < 1e-9);
  f.restore();
});

void test('double tap zooms 2.5x at the tapped point and again resets', () => {
  const zoom = Object.assign(new EventTarget(), {
    style: {},
    offsetWidth: 400,
    offsetHeight: 300,
    naturalWidth: 800,
    naturalHeight: 600,
    getBoundingClientRect: () => ({
      left: 0,
      top: 100,
      width: 400,
      height: 300,
    }),
  });
  const f = fixture({ zoom, reduced: () => true });
  const tap = (id) => {
    f.pointer('pointerdown', id, 300, 250);
    f.pointer('pointerup', id, 300, 250);
  };
  tap(1);
  tap(2);
  assert.equal(zoom.style.transform, 'translate3d(-150px, 0px, 0) scale(2.5)');
  assert.ok(f.attributes.has('data-zoomed'));
  assert.deepEqual(f.calls.taps, [[300, 400]], 'the first tap still counts');
  tap(3);
  tap(4);
  assert.equal(zoom.style.transform, '');
  assert.equal(f.attributes.has('data-zoomed'), false);
  f.restore();
});
