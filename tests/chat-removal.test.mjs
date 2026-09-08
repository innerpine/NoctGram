import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['lib/chat-removal.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { createChatRemoval } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const messages = Array.from({ length: 4 }, (_, index) => ({
  id: 'm' + index,
  created: index * 100,
  text: 'text ' + index,
  sender: 'a',
  recipient: 'b',
}));

function fixture(t, { reduced = false, hidden = false, animate = true } = {}) {
  const timers = new Map();
  let serial = 0,
    updates = 0;
  const host = {
    matchMedia: () => ({ matches: reduced }),
    getComputedStyle: () => ({ rowGap: '10px' }),
    setTimeout(fn) {
      timers.set(++serial, fn);
      return serial;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const rows = messages.map((message) => ({
    dataset: { chatMessageId: message.id },
    style: {},
    animations: [],
    getBoundingClientRect: () => ({ height: message.id === 'm1' ? 390 : 72 }),
    ...(animate
      ? {
          animate(frames, options) {
            const animation = {
              frames,
              options,
              canceled: false,
              cancel() {
                this.canceled = true;
                this.oncancel?.();
              },
            };
            this.animations.push(animation);
            return animation;
          },
        }
      : {}),
  }));
  const list = {
    ownerDocument: { defaultView: host, hidden },
    querySelectorAll: () => rows,
  };
  const removal = createChatRemoval(list, () => updates++);
  t.after(() => {
    removal.dispose();
    assert.equal(timers.size, 0);
  });
  return {
    removal,
    rows,
    timers,
    get updates() {
      return updates;
    },
  };
}
const ids = (rows) => rows.map((row) => row.id);

void test('confirmed deletion fades then collapses the measured row, retaining it across an immediate refresh', (t) => {
  const f = fixture(t);
  f.removal.remove([messages[1]]);
  const animation = f.rows[1].animations[0];
  assert.equal(
    animation.frames[0].height,
    '390px',
    'Media and gift rows use their actual height',
  );
  assert.equal(animation.frames.at(-1).height, '0px');
  assert.equal(animation.frames.at(-1).marginBottom, '-10px');
  assert.ok(animation.options.delay + animation.options.duration <= 360);
  assert.deepEqual(
    ids(f.removal.visible(messages.filter((row) => row.id !== 'm1'))),
    ['m0', 'm1', 'm2', 'm3'],
  );
  animation.onfinish();
  assert.deepEqual(
    ids(f.removal.visible(messages)),
    ['m0', 'm2', 'm3'],
    'A stale refresh cannot resurrect a confirmed deletion',
  );
  assert.equal(
    f.rows[1].style.opacity,
    '0',
    'No flash between animation completion and the React removal commit',
  );
  assert.equal(animation.canceled, true);
  assert.equal(f.timers.size, 0);
});

void test('batch deletions finish independently without duplicating rows or restarting repeated IDs', (t) => {
  const f = fixture(t);
  f.removal.remove([messages[1], messages[2]]);
  f.removal.remove([messages[1]]);
  assert.equal(f.rows[1].animations.length, 1);
  assert.deepEqual(ids(f.removal.visible(messages)), ['m0', 'm1', 'm2', 'm3']);
  f.rows[1].animations[0].onfinish();
  const next = [
    ...messages.filter((row) => !['m1', 'm2'].includes(row.id)),
    { ...messages[3], id: 'new', created: 400 },
  ];
  assert.deepEqual(ids(f.removal.visible(next)), ['m0', 'm2', 'm3', 'new']);
  f.rows[2].animations[0].onfinish();
  assert.deepEqual(ids(f.removal.visible(next)), ['m0', 'm3', 'new']);
});

void test('reduced motion, hidden pages and missing animation support remove immediately', (t) => {
  for (const options of [
    { reduced: true },
    { hidden: true },
    { animate: false },
  ]) {
    const f = fixture(t, options);
    f.removal.remove([messages[1]]);
    assert.deepEqual(ids(f.removal.visible(messages)), ['m0', 'm2', 'm3']);
    assert.equal(f.rows[1].animations.length, 0);
    assert.equal(f.timers.size, 0);
  }
});

void test('animation cancellation, fallback timeout, and unmount clean up without lingering copies', (t) => {
  const f = fixture(t);
  f.removal.remove([messages[1]]);
  f.rows[1].animations[0].cancel();
  assert.equal(
    f.removal.visible(messages).some((row) => row.id === 'm1'),
    false,
  );
  f.removal.remove([messages[2]]);
  [...f.timers.values()][0]();
  assert.equal(
    f.removal.visible(messages).some((row) => row.id === 'm2'),
    false,
  );
  f.removal.remove([messages[3]]);
  const animation = f.rows[3].animations[0],
    count = f.updates;
  f.removal.dispose();
  assert.equal(animation.canceled, true);
  assert.equal(f.timers.size, 0);
  f.removal.remove([messages[0]]);
  assert.equal(f.updates, count);
});

void test('ordinary snapshots and pagination do not animate or hide messages without a confirmed deletion', (t) => {
  const f = fixture(t);
  assert.equal(f.removal.visible(messages), messages);
  const page = messages.slice(2);
  assert.equal(f.removal.visible(page), page);
  assert.equal(f.updates, 0);
  assert.equal(f.rows.flatMap((row) => row.animations).length, 0);
});
