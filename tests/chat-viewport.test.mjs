import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/chat-viewport.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { watchChatTail, revealChat } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

function fixture(t) {
  let observer,
    busy = false,
    writes = 0;
  const old = new Map();
  for (const [name, value] of Object.entries({
    ResizeObserver: class {
      targets = [];
      constructor(callback) {
        this.callback = callback;
        observer = this;
      }
      observe(target) {
        this.targets.push(target);
      }
      disconnect() {
        this.targets = [];
      }
    },
    Element: class extends EventTarget {
      closest() {
        return null;
      }
    },
  })) {
    old.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true });
  }
  t.after(() => {
    for (const [name, descriptor] of old) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const list = Object.assign(new Element(), {
    scrollTop: 1000,
    scrollHeight: 1400,
    clientHeight: 400,
    clientWidth: 600,
    clientLeft: 0,
    getBoundingClientRect: () => ({ left: 0 }),
  });
  const content = {},
    following = { current: true };
  const stop = watchChatTail(list, content, {
    following,
    busy: () => busy,
    bottom: () => {
      writes++;
      list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    },
  });
  t.after(stop);
  const event = (type, data = {}) =>
    list.dispatchEvent(Object.assign(new Event(type), data));
  return {
    list,
    content,
    following,
    observer,
    stop,
    event,
    busy: (value) => (busy = value),
    writes: () => writes,
  };
}

await test('tail follows late content and composer changes despite layout scroll events', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.observer.targets, [f.list, f.content]);
  f.list.scrollHeight += 215;
  f.event('scroll');
  assert.equal(f.following.current, true);
  f.observer.callback();
  assert.equal(f.list.scrollHeight - f.list.clientHeight - f.list.scrollTop, 0);
  f.list.clientHeight -= 70;
  f.event('scroll');
  f.observer.callback();
  assert.equal(f.list.scrollHeight - f.list.clientHeight - f.list.scrollTop, 0);
});

await test('wheel reading wins over late layout; reaching the end restores following', (t) => {
  const f = fixture(t);
  f.event('wheel', { deltaY: -200 });
  f.list.scrollTop -= 200;
  f.event('scroll');
  f.list.scrollHeight += 200;
  f.observer.callback();
  assert.equal(f.list.scrollTop, 800);
  assert.equal(f.writes(), 0);
  f.list.scrollTop = f.list.scrollHeight - f.list.clientHeight;
  f.event('scroll');
  assert.equal(f.following.current, true);
  f.list.scrollHeight += 100;
  f.observer.callback();
  assert.equal(f.writes(), 1);
});

await test('touch, keyboard and scrollbar reading detach, text clicks do not', (t) => {
  const f = fixture(t);
  f.event('pointerdown', { clientX: 50 });
  assert.equal(f.following.current, true);
  for (const [name, data] of [
    ['touchmove', {}],
    ['keydown', { key: 'PageUp' }],
    ['pointerdown', { clientX: 605 }],
  ]) {
    f.following.current = true;
    f.event(name, data);
    f.observer.callback();
    assert.equal(f.following.current, false);
  }
  assert.equal(f.writes(), 0);
});

await test('resize cannot interrupt reply navigation or drag selection; disposal removes listeners', (t) => {
  const f = fixture(t);
  f.busy(true);
  f.observer.callback();
  assert.equal(f.writes(), 0);
  f.following.current = false;
  f.event('scroll');
  assert.equal(f.following.current, false);
  f.stop();
  assert.deepEqual(f.observer.targets, []);
  f.following.current = true;
  f.event('wheel', { deltaY: -1 });
  assert.equal(f.following.current, true);
});

await test('ready entrance animates the chat pane only and supports cleanup and reduced motion', (t) => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let reduced = false,
    canceled = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { matchMedia: () => ({ matches: reduced }) },
  });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, 'window', old);
    else delete globalThis.window;
  });
  const animations = [];
  const panel = {
    animate: (frames, options) => {
      animations.push({ frames, options });
      return { cancel: () => (canceled = true) };
    },
  };
  const list = {
    closest: (selector) => {
      assert.equal(selector, '.chat-panel');
      return panel;
    },
  };
  const stop = revealChat(list);
  assert.equal(animations.length, 1);
  assert.equal(animations[0].options.duration, 360);
  assert.equal(animations[0].frames[0].opacity, 0);
  stop();
  assert.equal(canceled, true);
  reduced = true;
  revealChat(list)();
  assert.equal(animations.length, 2, 'reduced motion still fades in');
  assert.equal(animations[1].options.duration, 150);
  assert.ok(animations[1].frames.every((frame) => !('translate' in frame)));
});
