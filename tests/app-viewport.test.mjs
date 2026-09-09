import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/app-viewport.ts'],
  bundle: true,
  write: false,
  format: 'esm',
});
const { observeAppViewport } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

function fixture() {
  const styles = new Map();
  const root = {
    clientHeight: 844,
    dataset: {},
    style: {
      setProperty: (key, value) => styles.set(key, value),
      removeProperty: (key) => styles.delete(key),
    },
  };
  const viewport = Object.assign(new EventTarget(), {
    width: 390,
    height: 844,
    scale: 1,
    offsetTop: 0,
  });
  const doc = Object.assign(new EventTarget(), {
    documentElement: root,
    activeElement: null,
  });
  let id = 0;
  const frames = new Map();
  const host = Object.assign(new EventTarget(), {
    innerHeight: 844,
    matchMedia: () => ({ matches: true }),
    visualViewport: viewport,
    document: doc,
    requestAnimationFrame: (fn) => {
      frames.set(++id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  return {
    root,
    viewport,
    doc,
    host,
    styles,
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn());
    },
    get pending() {
      return frames.size;
    },
  };
}

await test('Safari keyboard resizes the chat without waiting for the layout viewport', () => {
  const f = fixture();
  const stop = observeAppViewport(f.host);
  f.doc.activeElement = { matches: () => true };
  Object.assign(f.viewport, { height: 430, offsetTop: 24 });
  f.viewport.dispatchEvent(new Event('resize'));
  f.viewport.dispatchEvent(new Event('scroll'));
  assert.equal(f.pending, 1);
  f.flush();
  assert.equal(f.styles.get('--app-viewport-height'), '430px');
  assert.equal(f.styles.get('--app-viewport-top'), '24px');
  assert.equal(f.root.dataset.keyboardOpen, 'true');
  f.doc.activeElement = null;
  Object.assign(f.viewport, { height: 844, offsetTop: 0 });
  f.doc.dispatchEvent(new Event('focusout'));
  f.viewport.dispatchEvent(new Event('resize'));
  f.flush();
  assert.equal(f.styles.get('--app-viewport-height'), '844px');
  assert.equal(f.root.dataset.keyboardOpen, 'false');
  stop();
});

await test('pinch zoom stays native and is not mistaken for a keyboard', () => {
  const f = fixture();
  const stop = observeAppViewport(f.host);
  f.doc.activeElement = { matches: () => true };
  Object.assign(f.viewport, { scale: 2, height: 422, width: 195 });
  f.viewport.dispatchEvent(new Event('resize'));
  f.flush();
  assert.equal(f.styles.size, 0);
  assert.equal(f.root.dataset.keyboardOpen, undefined);
  Object.assign(f.viewport, { scale: 1, height: 390, width: 844 });
  f.host.innerHeight = f.root.clientHeight = 390;
  f.viewport.dispatchEvent(new Event('resize'));
  f.flush();
  assert.equal(f.styles.get('--app-viewport-width'), '844px');
  assert.equal(f.root.dataset.keyboardOpen, 'false');
  stop();
});

await test('unmount removes listeners, pending updates and viewport overrides', () => {
  const f = fixture();
  const stop = observeAppViewport(f.host);
  f.viewport.dispatchEvent(new Event('resize'));
  stop();
  f.viewport.dispatchEvent(new Event('scroll'));
  f.doc.dispatchEvent(new Event('focusin'));
  f.host.dispatchEvent(new Event('resize'));
  f.host.dispatchEvent(new Event('scroll'));
  f.host.dispatchEvent(new Event('pageshow'));
  f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.pending, 0);
  assert.equal(f.styles.size, 0);
  assert.equal(f.root.dataset.keyboardOpen, undefined);
});

await test('browsers without VisualViewport keep the CSS viewport fallback', () => {
  const f = fixture();
  f.host.visualViewport = null;
  const stop = observeAppViewport(f.host);
  assert.equal(f.styles.size, 0);
  stop();
});

await test('keyboard inset follows opening and closing frames without a 120px jump', () => {
  const f = fixture();
  const stop = observeAppViewport(f.host);
  f.doc.activeElement = { matches: () => true };
  f.doc.dispatchEvent(new Event('focusin'));
  f.flush();
  assert.equal(f.styles.get('--app-keyboard-inset'), '0px');
  for (const covered of [20, 60, 119, 121, 250, 400]) {
    f.viewport.height = 844 - covered;
    f.viewport.dispatchEvent(new Event('resize'));
    f.flush();
    assert.equal(f.styles.get('--app-keyboard-inset'), `${covered}px`);
    assert.equal(f.root.dataset.keyboardOpen, 'true');
  }
  f.doc.activeElement = null;
  f.doc.dispatchEvent(new Event('focusout'));
  f.flush();
  assert.equal(f.styles.get('--app-keyboard-inset'), '400px');
  for (const covered of [250, 121, 119, 60, 20, 0]) {
    f.viewport.height = 844 - covered;
    f.viewport.dispatchEvent(new Event('resize'));
    f.flush();
    assert.equal(f.styles.get('--app-keyboard-inset'), `${covered}px`);
  }
  assert.equal(f.root.dataset.keyboardOpen, 'false');
  stop();
});

await test('Android keeps the pre-keyboard height when both viewports shrink', () => {
  const f = fixture();
  const stop = observeAppViewport(f.host);
  f.doc.activeElement = { matches: () => true };
  f.doc.dispatchEvent(new Event('focusin'));
  f.flush();
  f.host.innerHeight = f.root.clientHeight = f.viewport.height = 444;
  f.viewport.width = 389.9999;
  f.viewport.dispatchEvent(new Event('resize'));
  f.flush();
  assert.equal(f.styles.get('--app-keyboard-inset'), '400px');
  f.doc.activeElement = null;
  f.doc.dispatchEvent(new Event('focusout'));
  f.flush();
  assert.equal(f.root.dataset.keyboardOpen, 'true');
  f.host.innerHeight = f.root.clientHeight = f.viewport.height = 844;
  f.viewport.dispatchEvent(new Event('resize'));
  f.flush();
  assert.equal(f.styles.get('--app-keyboard-inset'), '0px');
  assert.equal(f.root.dataset.keyboardOpen, 'false');
  stop();
});

await test('desktop window resizing does not act like a software keyboard', () => {
  const f = fixture();
  f.host.matchMedia = () => ({ matches: false });
  const stop = observeAppViewport(f.host);
  f.doc.activeElement = { matches: () => true };
  f.host.innerHeight = f.root.clientHeight = f.viewport.height = 444;
  f.viewport.dispatchEvent(new Event('resize'));
  f.flush();
  assert.equal(f.styles.get('--app-keyboard-inset'), '0px');
  assert.equal(f.root.dataset.keyboardOpen, 'false');
  stop();
});

await test('Safari toolbar scrolling follows the visible area while layout height stays stale', () => {
  const f = fixture();
  f.host.innerHeight = f.root.clientHeight = f.viewport.height = 659;
  const stop = observeAppViewport(f.host);
  for (const height of [690, 730, 790, 730, 659]) {
    f.viewport.height = height;
    f.host.dispatchEvent(new Event('scroll'));
    f.host.dispatchEvent(new Event('scroll'));
    assert.equal(f.pending, 1, 'Scroll updates are coalesced into one frame');
    f.flush();
    assert.equal(f.styles.get('--app-viewport-height'), `${height}px`);
    assert.equal(f.styles.get('--app-keyboard-inset'), '0px');
    assert.equal(f.root.dataset.keyboardOpen, 'false');
  }
  f.viewport.offsetTop = 26;
  f.host.dispatchEvent(new Event('scroll'));
  f.flush();
  assert.equal(f.styles.get('--app-viewport-top'), '26px');
  stop();
});

await test('returning to a cached or background Safari page refreshes viewport controls', () => {
  const f = fixture();
  const stop = observeAppViewport(f.host);
  f.viewport.height = 700;
  f.host.dispatchEvent(new Event('pageshow'));
  f.flush();
  assert.equal(f.styles.get('--app-viewport-height'), '700px');
  f.viewport.height = 844;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  f.flush();
  assert.equal(f.styles.get('--app-viewport-height'), '844px');
  stop();
});
