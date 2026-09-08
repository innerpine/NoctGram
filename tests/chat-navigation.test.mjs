import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/chat-navigation.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { createChatNavigator } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

function fixture(t, reduced = false) {
  let time = 0,
    serial = 0;
  const frames = new Map();
  const originals = new Map();
  for (const [name, value] of Object.entries({
    window: {
      matchMedia: () => ({ matches: reduced }),
      scrollTo: () => assert.fail('The page must not scroll'),
    },
    performance: { now: () => time },
    requestAnimationFrame: (callback) => {
      frames.set(++serial, callback);
      return serial;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    getComputedStyle: () => ({ getPropertyValue: () => '#ceb4df' }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const list = Object.assign(new EventTarget(), {
    scrollTop: 500,
    clientTop: 2,
    clientHeight: 400,
    scrollHeight: 3000,
    contains: (target) => target.parent === list,
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTo({ top, behavior }) {
      assert.equal(behavior, 'instant');
      this.scrollTop = top;
    },
    scrollIntoView: () => assert.fail('Do not scroll ancestor surfaces'),
  });
  const target = (top, height = 60) => ({
    parent: list,
    attributes: new Map(),
    focuses: [],
    animations: [],
    querySelector: () => null,
    getBoundingClientRect: () => ({
      top: 100 + list.clientTop + top - list.scrollTop,
      height,
    }),
    focus(options) {
      this.focuses.push(options);
    },
    scrollIntoView: () => assert.fail('Do not scroll ancestor surfaces'),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    animate(keyframes, options) {
      const animation = {
        keyframes,
        options,
        onfinish: null,
        canceled: false,
        cancel() {
          this.canceled = true;
        },
      };
      this.animations.push(animation);
      return animation;
    },
  });
  const navigation = createChatNavigator(list);
  t.after(() => {
    navigation.dispose();
    assert.equal(
      frames.size,
      0,
      'No animation frames survive conversation teardown',
    );
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    list,
    target,
    navigation,
    frames,
    advance(ms) {
      time += ms;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(time));
    },
  };
}

void test('message jumps move only the chat, ease in bounded time and clear the arrival highlight', (t) => {
  const f = fixture(t),
    message = f.target(1600);
  assert.equal(f.navigation.jump(message), true);
  assert.equal(f.list.scrollTop, 500);
  assert.deepEqual(message.focuses, [{ preventScroll: true }]);
  f.advance(120);
  assert.ok(f.list.scrollTop > 500 && f.list.scrollTop < 1430);
  assert.equal(message.animations.length, 0, 'Highlight waits until arrival');
  f.advance(300);
  assert.equal(f.list.scrollTop, 1430);
  assert.equal(f.navigation.scrolling, false);
  assert.equal(message.attributes.has('data-chat-arrival'), true);
  assert.ok(message.animations[0].keyframes[1].boxShadow.includes('#ceb4df'));
  message.animations[0].onfinish();
  assert.equal(message.attributes.size, 0);
});

void test('gift arrivals illuminate the rounded card rather than the event wrapper', (t) => {
  const f = fixture(t),
    gift = f.target(1600),
    card = f.target(1600);
  gift.querySelector = () => card;
  f.navigation.jump(gift);
  f.advance(420);
  assert.equal(gift.attributes.size, 0);
  assert.equal(gift.animations.length, 0);
  assert.equal(card.attributes.has('data-chat-arrival'), true);
  assert.equal(card.animations.length, 1);
  f.navigation.dispose();
  assert.equal(card.attributes.size, 0);
});

void test('a second jump replaces the first and never focuses or highlights a stale destination later', (t) => {
  const f = fixture(t),
    old = f.target(1900),
    recent = f.target(2800);
  f.navigation.jump(old);
  f.advance(80);
  f.navigation.jump(recent);
  assert.equal(f.frames.size, 1);
  f.advance(420);
  assert.equal(f.list.scrollTop, 2600);
  assert.equal(old.animations.length, 0);
  assert.equal(old.focuses.length, 1);
  assert.equal(recent.animations.length, 1);
  f.navigation.dispose();
  assert.equal(recent.attributes.size, 0);
  assert.equal(recent.animations[0].canceled, true);
});

void test('manual wheel, touch, pointer and keyboard interaction interrupt automated scrolling', (t) => {
  const f = fixture(t);
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    const message = f.target(1800);
    f.list.scrollTop = 0;
    f.navigation.jump(message);
    f.advance(70);
    const position = f.list.scrollTop;
    f.list.dispatchEvent(new Event(event));
    f.advance(600);
    assert.equal(f.list.scrollTop, position, event);
    assert.equal(f.navigation.scrolling, false);
    assert.equal(message.animations.length, 0);
  }
});

void test('reduced motion navigates immediately with a static, temporary marker', (t) => {
  const f = fixture(t, true),
    message = f.target(1600);
  f.navigation.jump(message);
  assert.equal(f.list.scrollTop, 1430);
  assert.equal(f.frames.size, 0);
  assert.equal(message.animations.length, 0);
  assert.equal(message.attributes.has('data-chat-arrival'), true);
  f.navigation.dispose();
  assert.equal(message.attributes.size, 0);
});

void test('foreign targets are ignored; tall messages and short histories stay inside list bounds', (t) => {
  const f = fixture(t, true),
    foreign = f.target(1900);
  foreign.parent = null;
  assert.equal(f.navigation.jump(foreign), false);
  assert.equal(foreign.focuses.length, 0);
  assert.equal(f.list.scrollTop, 500);
  f.navigation.jump(f.target(600, 900));
  assert.equal(f.list.scrollTop, 600, 'Start of tall media remains visible');
  f.list.scrollHeight = 250;
  f.navigation.jump(f.target(50));
  assert.equal(f.list.scrollTop, 0);
  f.navigation.bottom(true);
  assert.equal(f.list.scrollTop, 0);
});

void test('following the tail adapts to a changing composer height and still finishes within 420 ms', (t) => {
  const f = fixture(t);
  f.list.scrollHeight = 50000;
  f.navigation.bottom(true);
  f.advance(120);
  f.list.clientHeight = 310;
  f.list.scrollHeight += 200;
  f.advance(299);
  assert.equal(f.navigation.scrolling, true);
  f.advance(1);
  assert.equal(f.list.scrollTop, 49890);
  assert.equal(f.navigation.scrolling, false);
});
