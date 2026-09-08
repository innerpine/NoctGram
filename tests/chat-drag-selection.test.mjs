import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['lib/chat-drag-selection.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { createChatDragSelection, chatDragSpeed } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

function fixture(t, initial = []) {
  let now = 0,
    serial = 0,
    selected = initial,
    starts = 0,
    limits = 0,
    textCleared = 0;
  const frames = new Map(),
    timers = new Map(),
    originals = new Map();
  class Element extends EventTarget {
    constructor(blocked = false) {
      super();
      this.blocked = blocked;
    }
    closest() {
      return this.blocked ? this : null;
    }
  }
  for (const [name, value] of Object.entries({
    Element,
    performance: { now: () => now },
    requestAnimationFrame: (callback) => {
      frames.set(++serial, callback);
      return serial;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const host = Object.assign(new EventTarget(), {
    setTimeout: (callback) => {
      timers.set(++serial, callback);
      return serial;
    },
    clearTimeout: (id) => timers.delete(id),
    scrollTo: () => assert.fail('The page must not scroll'),
  });
  const doc = Object.assign(new EventTarget(), {
    defaultView: host,
    hidden: false,
    getSelection: () => ({
      removeAllRanges() {
        textCleared++;
      },
    }),
  });
  const list = Object.assign(new Element(), {
    ownerDocument: doc,
    scrollTop: 0,
    scrollHeight: 4000,
    clientHeight: 400,
    clientWidth: 584,
    clientTop: 0,
    clientLeft: 0,
    captured: null,
    attributes: new Set(),
    contains: (target) => target === list || target.parent === list,
    getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 50 }),
    scrollTo({ top, behavior }) {
      assert.equal(behavior, 'instant');
      this.scrollTop = top;
    },
    setPointerCapture(id) {
      this.captured = id;
    },
    hasPointerCapture(id) {
      return this.captured === id;
    },
    releasePointerCapture() {
      this.captured = null;
    },
    setAttribute(name) {
      this.attributes.add(name);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
  });
  const rows = Array.from({ length: 50 }, (_, i) =>
    Object.assign(new Element(), {
      parent: list,
      dataset: { chatMessageId: 'm' + i },
      getBoundingClientRect: () => ({
        top: 100 + i * 80 - list.scrollTop,
        bottom: 170 + i * 80 - list.scrollTop,
      }),
    }),
  );
  list.querySelectorAll = () => rows;
  const drag = createChatDragSelection(list, {
    selected: () => selected,
    select: (ids) => {
      selected = ids;
    },
    start: () => starts++,
    limit: () => limits++,
  });
  t.after(() => {
    drag.dispose();
    assert.equal(frames.size, 0);
    assert.equal(timers.size, 0);
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    }
  });
  return {
    list,
    rows,
    doc,
    host,
    drag,
    frames,
    get selected() {
      return selected;
    },
    get starts() {
      return starts;
    },
    get limits() {
      return limits;
    },
    get textCleared() {
      return textCleared;
    },
    blocked() {
      return Object.assign(new Element(true), { parent: list });
    },
    pointer(type, y, extra = {}) {
      const event = new Event(type, { cancelable: true });
      for (const [key, value] of Object.entries({
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: 70,
        clientY: y,
        ...extra,
      }))
        Object.defineProperty(event, key, { value });
      (['pointermove', 'pointerup', 'pointercancel'].includes(type)
        ? host
        : list
      ).dispatchEvent(event);
      return event;
    },
    advance(ms = 16) {
      now += ms;
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((callback) => callback(now));
    },
  };
}
test('dragging a gutter selects a vertical range; reversing shrinks it and a final click cannot toggle it', (t) => {
  const f = fixture(t);
  assert.equal(f.pointer('pointerdown', 280).defaultPrevented, true);
  assert.equal(
    f.list.captured,
    null,
    'Capture must wait until this becomes a drag',
  );
  f.pointer('pointermove', 415);
  assert.equal(f.list.captured, 1);
  f.advance();
  assert.deepEqual(f.selected, ['m2', 'm3']);
  assert.equal(f.starts, 1);
  assert.equal(
    f.frames.size,
    0,
    'Stationary selection away from edges has no animation loop',
  );
  f.pointer('pointermove', 290);
  f.advance();
  assert.deepEqual(f.selected, ['m2']);
  f.pointer('pointerup', 290);
  const click = new Event('click', { cancelable: true });
  f.list.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(f.list.captured, null);
});

test('a stationary row click keeps its original target so the whole row can toggle selection', (t) => {
  const f = fixture(t, ['m2']);
  f.pointer('pointerdown', 280, { target: f.rows[2] });
  f.pointer('pointermove', 282);
  assert.equal(f.list.captured, null);
  f.pointer('pointerup', 282);
  const click = new Event('click', { cancelable: true });
  f.list.dispatchEvent(click);
  assert.equal(
    click.defaultPrevented,
    false,
    'Do not swallow a normal click after pointerup',
  );
  assert.equal(f.starts, 0);
  assert.equal(f.textCleared, 0);
  assert.deepEqual(
    f.selected,
    ['m2'],
    'Only the row click handler should toggle, once',
  );
});
test('text/media drags, touch, right button and native scrollbars remain untouched', (t) => {
  const f = fixture(t);
  for (const extra of [
    { target: f.blocked() },
    { pointerType: 'touch' },
    { button: 2 },
    { clientX: 640 },
  ]) {
    assert.equal(f.pointer('pointerdown', 280, extra).defaultPrevented, false);
    f.pointer('pointermove', 495);
    f.advance();
    assert.equal(f.list.captured, null);
    assert.equal(f.list.scrollTop, 0);
  }
  assert.equal(f.starts, 0);
  assert.equal(f.textCleared, 0);
  assert.deepEqual(f.selected, []);
});
test('holding at either edge scrolls only the chat, extends selection and enforces the shared 20-message limit', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown', 280);
  f.pointer('pointermove', 550);
  for (let i = 0; i < 90; i++) f.advance(32);
  assert.ok(f.list.scrollTop > 2000);
  assert.equal(f.selected.length, 20);
  assert.equal(f.limits, 1);
  const before = f.list.scrollTop;
  f.pointer('pointermove', 80);
  for (let i = 0; i < 20; i++) f.advance(32);
  assert.ok(f.list.scrollTop < before);
  f.pointer('pointerup', 80);
  const ended = f.list.scrollTop;
  f.advance(500);
  assert.equal(f.list.scrollTop, ended);
});
test('Ctrl adds to the current selection and Escape restores the pre-gesture selection', (t) => {
  const f = fixture(t, ['m0']);
  f.pointer('pointerdown', 280, { ctrlKey: true });
  f.pointer('pointermove', 415);
  f.advance();
  assert.deepEqual(f.selected, ['m0', 'm2', 'm3']);
  const escape = new Event('keydown', { cancelable: true });
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  f.host.dispatchEvent(escape);
  assert.deepEqual(f.selected, ['m0']);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.list.captured, null);
});
test('wheel scrolling with the mouse button held in the gutter extends the range without blocking native scrolling', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown', 280);
  const wheel = new Event('wheel', { cancelable: true });
  Object.defineProperty(wheel, 'deltaY', { value: 160 });
  f.list.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, false);
  f.list.scrollTop = 160;
  f.list.dispatchEvent(new Event('scroll'));
  f.advance();
  assert.deepEqual(f.selected, ['m2', 'm3', 'm4']);
  f.pointer('pointerup', 280);
});
test('blur, pointer cancellation, capture loss, hidden document and disposal stop edge scrolling', (t) => {
  const f = fixture(t);
  for (const stop of [
    () => f.host.dispatchEvent(new Event('blur')),
    () => f.host.dispatchEvent(new Event('pointercancel')),
    () => f.list.dispatchEvent(new Event('lostpointercapture')),
    () => {
      f.doc.hidden = true;
      f.doc.dispatchEvent(new Event('visibilitychange'));
    },
    () => f.drag.dispose(),
  ]) {
    f.pointer('pointerdown', 280);
    f.pointer('pointermove', 550);
    f.advance();
    stop();
    const before = f.list.scrollTop;
    f.advance(500);
    assert.equal(f.list.scrollTop, before);
    assert.equal(f.drag.dragging, false);
    assert.equal(f.list.attributes.size, 0);
  }
});
test('edge speed is bounded, directional and inactive in the centre', () => {
  assert.equal(chatDragSpeed(300, 100, 500), 0);
  assert.equal(chatDragSpeed(-1000, 100, 500), -900);
  assert.equal(chatDragSpeed(2000, 100, 500), 900);
  assert.equal(chatDragSpeed(300, 300, 300), 0);
});
