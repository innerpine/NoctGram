import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/chat-row-swipe.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { ROW_ACTIONS, rowOffset, rowOpens, createRowSwipe } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

class Node {
  constructor(parent = null, actions = false) {
    this.parent = parent;
    this.actions = actions;
  }
  closest() {
    for (let current = this; current; current = current.parent)
      if (current.actions) return current;
    return null;
  }
}

function fixture(t) {
  const saved = ['Element', 'window'].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  const listeners = new Set();
  Object.defineProperty(globalThis, 'Element', {
    configurable: true,
    value: Node,
  });
  // Reduced motion settles at once, so no frames are needed here.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { matchMedia: () => ({ matches: true }) },
  });
  t.after(() => {
    for (const [name, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
  });
  const document = {
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const row = () => {
    const root = new Node();
    const content = new Node(root);
    const button = new Node(new Node(root, true));
    let reveals = 0;
    Object.assign(root, {
      properties: new Map(),
      ownerDocument: document,
      style: { setProperty: (key, value) => root.properties.set(key, value) },
      contains(node) {
        for (let current = node; current; current = current.parent)
          if (current === root) return true;
        return false;
      },
      setPointerCapture(id) {
        root.captured = id;
      },
    });
    const swipe = createRowSwipe(() => reveals++);
    t.after(() => swipe.dispose());
    const call = (name, extra = {}) =>
      swipe[name]({
        target: content,
        currentTarget: root,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: 300,
        clientY: 40,
        timeStamp: now,
        ...extra,
      });
    const click = (target = content) => {
      let swallowed = false;
      swipe.onClickCapture({
        target,
        preventDefault: () => (swallowed = true),
        stopPropagation() {},
      });
      return swallowed;
    };
    return {
      swipe,
      root,
      content,
      button,
      call,
      click,
      get shift() {
        return parseFloat(root.properties.get('--row-shift') ?? '0');
      },
      get reveals() {
        return reveals;
      },
      open() {
        call('onPointerDown');
        call('onPointerMove', { clientX: 290 });
        now += 100;
        call('onPointerMove', { clientX: 200 });
        call('onPointerUp', { clientX: 200 });
      },
    };
  };
  return {
    row,
    listeners,
    advance: (ms) => (now += ms),
    outside: (target = new Node()) => {
      for (const fn of listeners) fn({ target });
    },
  };
}

void test('rows follow 1:1 over the actions, resist past them and never open right', () => {
  assert.equal(rowOffset(30), 0);
  assert.equal(rowOffset(-60), -60);
  assert.ok(rowOffset(-260) < -ROW_ACTIONS && rowOffset(-260) > -260);
  assert.ok(rowOffset(-10000) > -2 * ROW_ACTIONS);
  assert.equal(rowOpens(-30, -800), true, 'A flick left opens');
  assert.equal(rowOpens(-140, 800), false, 'A flick right closes');
  assert.equal(rowOpens(-80, 0), true);
  assert.equal(rowOpens(-70, 0), false);
});

void test('a left swipe opens one row at a time; a tap or touch elsewhere closes it', (t) => {
  const f = fixture(t);
  const a = f.row();
  a.call('onPointerDown');
  a.call('onPointerMove', { clientX: 290 });
  assert.equal(a.reveals, 1);
  assert.equal(a.root.captured, 1);
  assert.equal(a.shift, 0, 'Taking the gesture does not jump');
  f.advance(100);
  a.call('onPointerMove', { clientX: 200 });
  assert.equal(a.shift, -90);
  a.call('onPointerUp', { clientX: 200 });
  assert.equal(a.shift, -ROW_ACTIONS);
  assert.equal(a.click(), true, 'The swipe does not also open the chat');

  const b = f.row();
  f.outside(b.content);
  assert.equal(a.shift, 0, 'Touching another row closes the open one');
  b.open();
  assert.equal(b.shift, -ROW_ACTIONS);
  f.advance(600);

  b.call('onPointerDown', { target: b.button });
  b.call('onPointerUp', { target: b.button });
  assert.equal(b.shift, -ROW_ACTIONS, 'Its actions stay tappable');
  assert.equal(b.click(b.button), false);

  b.call('onPointerDown');
  b.call('onPointerUp');
  assert.equal(b.shift, 0, 'Tapping the open row closes it');
  assert.equal(b.click(), true, '…without opening the chat');
  assert.equal(b.click(), false);
  assert.equal(f.listeners.size, 0);

  b.open();
  f.outside();
  assert.equal(b.shift, 0, 'A touch anywhere else closes it');
});

void test('vertical scrolling, right swipes on closed rows and mouse input stay native', (t) => {
  const f = fixture(t);
  const r = f.row();
  r.call('onPointerDown');
  r.call('onPointerMove', { clientX: 296, clientY: 60 });
  r.call('onPointerMove', { clientX: 200, clientY: 60 });
  assert.equal(r.reveals, 0);
  r.call('onPointerDown');
  r.call('onPointerMove', { clientX: 330 });
  assert.equal(r.reveals, 0);
  r.call('onPointerDown', { pointerType: 'mouse' });
  r.call('onPointerMove', { pointerType: 'mouse', clientX: 200 });
  assert.equal(r.reveals, 0);
  assert.equal(r.shift, 0);
  assert.equal(r.click(), false);

  r.open();
  f.advance(600);
  r.call('onPointerDown');
  r.call('onPointerMove', { clientX: 300, clientY: 80 });
  assert.equal(r.shift, 0, 'Scrolling from an open row closes it');
});

void test('an open row drags closed to the right', (t) => {
  const f = fixture(t);
  const r = f.row();
  r.open();
  f.advance(600);
  r.call('onPointerDown');
  r.call('onPointerMove', { clientX: 312 });
  f.advance(100);
  r.call('onPointerMove', { clientX: 400 });
  assert.equal(r.shift, -ROW_ACTIONS + 88);
  r.call('onPointerUp', { clientX: 400 });
  assert.equal(r.shift, 0);
});
