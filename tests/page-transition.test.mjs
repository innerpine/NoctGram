import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['lib/page-transition.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { createPageTransition } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture() {
  const transitions = [],
    animations = [],
    contentAnimations = [],
    updates = [];
  const attributes = new Map();
  const state = { reduced: false, hidden: false, failedCapture: false };
  const host = {
    matchMedia: () => ({ matches: state.reduced }),
    document: {
      get hidden() {
        return state.hidden;
      },
      documentElement: {
        setAttribute: (k, v) => attributes.set(k, v),
        removeAttribute: (k) => attributes.delete(k),
      },
      querySelector: () => ({
        getAnimations: () => contentAnimations,
        animate: (frames, options) => {
          const animation = {
            frames,
            options,
            cancelled: false,
            cancel() {
              this.cancelled = true;
            },
          };
          animations.push(animation);
          return animation;
        },
      }),
      startViewTransition(update) {
        const done = deferred(),
          finished = deferred();
        const transition = {
          ready: state.failedCapture
            ? Promise.reject(new Error('capture rejected'))
            : Promise.resolve(),
          updateCallbackDone: done.promise,
          finished: finished.promise,
          skipped: false,
          skipTransition() {
            this.skipped = true;
          },
          apply() {
            update();
            done.resolve();
          },
          finish() {
            finished.resolve();
          },
        };
        transitions.push(transition);
        return transition;
      },
    },
  };
  const controller = createPageTransition(host, (update) => update());
  return {
    controller,
    host,
    transitions,
    animations,
    contentAnimations,
    attributes,
    state,
    updates,
    run: (from, to, enabled) =>
      controller.run(from, to, () => updates.push(to), enabled),
  };
}
void test('music transitions snapshot before committing and clean up after the animation', async () => {
  const f = fixture();
  const pending = f.run('feed', 'music');
  assert.deepEqual(f.updates, []);
  assert.equal(f.attributes.get('data-page-transition'), 'out');
  f.transitions[0].apply();
  await pending;
  assert.deepEqual(f.updates, ['music']);
  assert.equal(f.attributes.get('data-page-transition'), 'in');
  assert.equal(f.attributes.size, 1);
  f.transitions[0].finish();
  await new Promise(setImmediate);
  assert.equal(f.attributes.size, 0);
  const back = f.run('music', 'messages');
  f.transitions[1].apply();
  await back;
  assert.deepEqual(f.updates, ['music', 'messages']);
});
void test('a skipped transition cannot commit an obsolete destination or clear the newer animation', async () => {
  const f = fixture();
  const first = f.run('feed', 'music');
  const second = f.run('feed', 'music-services');
  assert.equal(f.transitions[0].skipped, true);
  f.transitions[0].apply();
  f.transitions[0].finish();
  await first;
  await new Promise(setImmediate);
  assert.deepEqual(f.updates, []);
  assert.equal(f.attributes.size, 1);
  f.transitions[1].apply();
  await second;
  assert.deepEqual(f.updates, ['music-services']);
});
void test('cancellation on account change prevents queued updates after unmount', async () => {
  const f = fixture();
  const pending = f.run('feed', 'music');
  f.controller.cancel();
  f.transitions[0].apply();
  await pending;
  assert.deepEqual(f.updates, []);
  assert.equal(f.attributes.size, 0);
});
void test('reduced motion swaps the rising entrance for a short fade', async () => {
  const f = fixture();
  f.state.reduced = true;
  delete f.host.document.startViewTransition;
  await f.run('feed', 'music');
  assert.deepEqual(f.updates, ['music']);
  assert.equal(f.animations.length, 1);
  assert.equal(f.animations[0].options.duration, 150);
  assert.deepEqual(f.animations[0].frames, [{ opacity: 0 }, { opacity: 1 }]);
});
void test('same section, initial load, nonmusic navigation and hidden pages commit immediately', async () => {
  for (const [from, to, enabled, flag] of [
    ['music', 'music'],
    ['feed', 'music', false],
    ['messages', 'profile'],
    ['music', 'feed', true, 'hidden'],
  ]) {
    const f = fixture();
    if (flag) f.state[flag] = true;
    await f.run(from, to, enabled);
    assert.deepEqual(f.updates, [to]);
    assert.equal(f.transitions.length, 0);
    assert.equal(f.animations.length, 0);
  }
});
void test('older browsers animate the incoming content and cancel it on rapid navigation', async () => {
  const f = fixture();
  delete f.host.document.startViewTransition;
  await f.run('feed', 'music');
  assert.deepEqual(f.updates, ['music']);
  assert.equal(f.animations.length, 1);
  await f.run('music', 'feed');
  assert.equal(f.animations[0].cancelled, true);
  assert.equal(f.animations.length, 2);
  assert.equal(f.attributes.size, 0);
});
void test('a snapshot setup failure cannot prevent navigation', async () => {
  const f = fixture();
  f.host.document.startViewTransition = () => {
    throw new Error('unsupported capture');
  };
  await f.run('feed', 'music');
  assert.deepEqual(f.updates, ['music']);
  assert.equal(f.attributes.size, 0);
  assert.equal(f.animations.length, 1);
});
void test('phone page changes keep the navbar live instead of freezing its spring in a snapshot', async () => {
  const f = fixture();
  f.host.matchMedia = (query) => ({ matches: query === '(max-width: 500px)' });
  await f.run('feed', 'music');
  assert.deepEqual(f.updates, ['music']);
  assert.equal(f.transitions.length, 0);
  assert.equal(f.animations.length, 1, 'the page still animates');
  assert.equal(f.attributes.size, 0);
});
void test('destination cards finish their entrance before capture, while looping media keeps animating', async () => {
  const f = fixture(),
    finished = [];
  for (const endTime of [280, 380, Infinity])
    f.contentAnimations.push({
      effect: { getComputedTiming: () => ({ endTime }) },
      finish: () => finished.push(endTime),
    });
  const pending = f.run('music', 'profile');
  assert.deepEqual(finished, []);
  f.transitions[0].apply();
  await pending;
  assert.deepEqual(finished, [280, 380]);
  await f.run('profile', 'messages');
  assert.deepEqual(
    finished,
    [280, 380],
    'ordinary sections keep their existing animations',
  );
});
void test('a browser capture rejection still animates the committed page', async () => {
  const f = fixture();
  f.state.failedCapture = true;
  const pending = f.run('music', 'messages');
  f.transitions[0].apply();
  await pending;
  await new Promise(setImmediate);
  assert.deepEqual(f.updates, ['messages']);
  assert.equal(f.animations.length, 1);
  assert.equal(f.animations[0].options.duration, 360);
  assert.equal(f.attributes.size, 0);
});
