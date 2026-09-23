import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/chat-swipe-back.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { backSwipeIntent, commitsBack, createChatSwipeBack } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

class Node {
  constructor(parent = null, name = '') {
    this.parent = parent;
    this.name = name;
    this.attrs = new Set();
    this.events = [];
    this.isConnected = true;
    this.style = {
      removeProperty(key) {
        delete this[key];
      },
    };
  }
  contains(node) {
    for (let current = node; current; current = current.parent)
      if (current === this) return true;
    return false;
  }
  closest(selector) {
    for (let current = this; current; current = current.parent)
      if (selector === current.name) return current;
    return null;
  }
  setAttribute(name) {
    this.attrs.add(name);
  }
  removeAttribute(name) {
    this.attrs.delete(name);
  }
  dispatchEvent(event) {
    this.events.push(event.type);
  }
}

function fixture(
  t,
  { standalone = true, reduced = false, stacked = true } = {},
) {
  const saved = ['Element', 'PointerEvent'].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  Object.defineProperty(globalThis, 'Element', {
    configurable: true,
    value: Node,
  });
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: class {
      constructor(type, init) {
        Object.assign(this, init, { type });
      }
    },
  });
  t.after(() => {
    for (const [name, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
  });
  let frame = 0,
    time = 0,
    closed = 0;
  const frames = new Map(),
    listeners = new Map();
  const main = new Node(null, 'main');
  const messenger = new Node(main);
  const list = new Node(messenger);
  const panel = new Node(messenger);
  const message = new Node(panel);
  const outside = new Node(null);
  Object.assign(panel, {
    offsetWidth: 400,
    getBoundingClientRect: () => ({ left: 5, top: 0, bottom: 800 }),
    getAnimations: () => [],
    setPointerCapture(id) {
      panel.captured = id;
    },
  });
  const host = {
    navigator: {},
    matchMedia: (query) => ({
      matches: query.includes('standalone') ? standalone : reduced,
    }),
    getComputedStyle: (node) => ({
      display: node === list && stacked ? 'none' : 'block',
    }),
    setTimeout: () => 0,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    requestAnimationFrame(fn) {
      frames.set(++frame, fn);
      return frame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  Object.assign(messenger, {
    ownerDocument: { defaultView: host },
    classList: { contains: (name) => name === 'peer-open' },
    querySelector: (selector) =>
      selector.includes('chat-panel') ? panel : list,
  });
  const swipe = createChatSwipeBack(messenger, () => closed++);
  t.after(() => swipe.dispose());
  const pointer = (type, extra = {}) => {
    let stopped = false;
    listeners.get(type)?.({
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      isTrusted: true,
      button: 0,
      clientX: 5,
      clientY: 300,
      timeStamp: time,
      target: message,
      stopPropagation: () => (stopped = true),
      ...extra,
    });
    return stopped;
  };
  return {
    swipe,
    panel,
    list,
    message,
    outside,
    pointer,
    advance(ms) {
      time += ms;
    },
    step() {
      time += 1000 / 60;
      const pending = [...frames.values()];
      frames.clear();
      for (const fn of pending) fn(time);
    },
    settle() {
      for (let i = 0; i < 400 && frames.size; i++) this.step();
    },
    get closed() {
      return closed;
    },
    get x() {
      return parseFloat(panel.style.translate ?? '0');
    },
  };
}

void test('a touch becomes a back swipe only after 10 px of mostly rightward travel', () => {
  assert.equal(backSwipeIntent(9, 0), 'wait');
  assert.equal(backSwipeIntent(12, 3), 'take');
  assert.equal(backSwipeIntent(12, 9), 'skip', 'Too diagonal');
  assert.equal(backSwipeIntent(-12, 0), 'skip');
  assert.equal(backSwipeIntent(0, 12), 'skip', 'Scrolling stays native');
});

void test('a clear flick decides by direction, otherwise the projected rest point', () => {
  assert.equal(commitsBack(40, 900, 400), true);
  assert.equal(commitsBack(360, -900, 400), false);
  assert.equal(commitsBack(210, 0, 400), true);
  assert.equal(commitsBack(190, 0, 400), false);
  assert.equal(commitsBack(120, 250, 400), true, '250 px/s carries ~125 px');
});

void test('an edge swipe follows the finger and a fast release closes the chat', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown');
  f.advance(8);
  f.pointer('pointermove', { clientX: 17, clientY: 302 });
  assert.equal(f.panel.attrs.has('data-chat-swipe'), true);
  assert.equal(f.x, 0, 'Taking the gesture does not jump by the threshold');
  assert.equal(f.panel.captured, 1);
  assert.deepEqual(f.message.events, ['pointercancel']);
  assert.equal(f.list.style.translate, '-30% 0');
  f.advance(100);
  f.pointer('pointermove', { clientX: 117 });
  assert.equal(f.x, 100);
  assert.equal(f.list.style.translate, '-22.5% 0');
  f.pointer('pointerup', { clientX: 117 });
  assert.equal(f.closed, 0, 'The chat is cleared once it is off-screen');
  f.settle();
  assert.equal(f.closed, 1);
  assert.equal(f.x, 400, 'The chat stays off-screen until it is replaced');
  assert.equal(f.list.style.translate, undefined);
  assert.equal(f.list.style.opacity, undefined);
});

void test('a slow short swipe springs back from where it was released', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown');
  f.pointer('pointermove', { clientX: 17 });
  f.advance(300);
  f.pointer('pointermove', { clientX: 97 });
  f.advance(300);
  f.pointer('pointerup', { clientX: 97 });
  f.step();
  assert.ok(f.x > 0 && f.x < 80, 'Returns from where it was released');
  f.settle();
  assert.equal(f.closed, 0);
  assert.equal(f.panel.attrs.has('data-chat-swipe'), false);
  assert.equal(f.panel.style.translate, undefined);
});

void test('the back arrow slides the chat away and a tap elsewhere finishes it at once', (t) => {
  const f = fixture(t, { standalone: false });
  f.pointer('pointerdown');
  f.pointer('pointermove', { clientX: 120 });
  assert.equal(
    f.panel.attrs.has('data-chat-swipe'),
    false,
    'Safari owns the edge outside the installed app',
  );
  f.pointer('pointerup', { clientX: 120 });
  f.swipe.exit();
  assert.equal(f.closed, 0);
  assert.equal(f.panel.attrs.has('data-chat-swipe'), true);
  f.pointer('pointerdown', { target: f.outside, clientX: 200 });
  assert.equal(f.closed, 1, 'A tap on the revealed list is not lost');
  f.settle();
  assert.equal(f.closed, 1);
});

void test('a moving chat can be caught: a tap only holds it, a drag decides again', (t) => {
  const f = fixture(t);
  f.swipe.exit();
  for (let i = 0; i < 4; i++) f.step();
  const live = f.x;
  const stopped = f.pointer('pointerdown', { clientX: 200 });
  assert.equal(stopped, true, 'The content below does not see the catch');
  f.step();
  assert.equal(f.x, live, 'Held under the finger');
  f.pointer('pointerup', { clientX: 202 });
  f.settle();
  assert.equal(f.closed, 1, 'A double tap on back still goes back');
  const g = fixture(t);
  g.swipe.exit();
  for (let i = 0; i < 4; i++) g.step();
  g.pointer('pointerdown', { clientX: 200 });
  g.advance(200);
  g.pointer('pointermove', { clientX: 200 - g.x });
  assert.equal(g.x, 0, 'Follows the finger from the live position');
  g.advance(200);
  g.pointer('pointerup', { clientX: 200 - 400 });
  g.settle();
  assert.equal(g.closed, 0, 'Dragged back, the chat stays');
  assert.equal(g.panel.attrs.has('data-chat-swipe'), false);
});

void test('reduced motion and the two-pane layout close without a slide', (t) => {
  const reduced = fixture(t, { reduced: true });
  reduced.swipe.exit();
  assert.equal(reduced.closed, 1);
  assert.equal(reduced.panel.attrs.has('data-chat-swipe'), false);
  const wide = fixture(t, { stacked: false });
  wide.pointer('pointerdown');
  wide.pointer('pointermove', { clientX: 60 });
  assert.equal(wide.panel.attrs.has('data-chat-swipe'), false);
  wide.swipe.exit();
  assert.equal(wide.closed, 1);
});

void test('touches away from the edge or moving vertically are left alone', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown', { clientX: 60 });
  f.pointer('pointermove', { clientX: 160 });
  assert.equal(f.panel.attrs.has('data-chat-swipe'), false);
  f.pointer('pointerup', { clientX: 160 });
  f.pointer('pointerdown');
  f.pointer('pointermove', { clientX: 8, clientY: 330 });
  f.pointer('pointermove', { clientX: 100, clientY: 330 });
  assert.equal(f.panel.attrs.has('data-chat-swipe'), false);
  assert.deepEqual(f.message.events, []);
});
