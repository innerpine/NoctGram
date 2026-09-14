import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centerLyric } from '../lib/lyric-scroll.ts';

function fixture() {
  let now = 0,
    sequence = 0;
  const frames = new Map();
  const container = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 };
  const host = {
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      frames.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  return {
    container,
    host,
    pending: () => frames.size,
    tick(ms) {
      now += ms;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(now);
    },
  };
}

await test('lyrics reach the same center at 60 and 120 Hz without overshooting', () => {
  for (const interval of [1000 / 60, 1000 / 120]) {
    const f = fixture();
    centerLyric(
      f.container,
      { offsetTop: 660, offsetHeight: 80 },
      true,
      f.host,
    );
    let previous = 0;
    for (let elapsed = 0; elapsed <= 500; elapsed += interval) {
      f.tick(interval);
      assert.ok(f.container.scrollTop >= previous);
      assert.ok(f.container.scrollTop <= 500);
      previous = f.container.scrollTop;
    }
    assert.equal(f.container.scrollTop, 500);
    assert.equal(f.pending(), 0, 'No animation runs between lyric changes');
  }
});

await test('touch/wheel cancellation gives scrolling back immediately', () => {
  const f = fixture();
  const cancel = centerLyric(
    f.container,
    { offsetTop: 660, offsetHeight: 80 },
    true,
    f.host,
  );
  f.tick(120);
  cancel();
  f.container.scrollTop = 75;
  f.tick(1000);
  assert.equal(f.container.scrollTop, 75);
  assert.equal(f.pending(), 0);
});

await test('a new lyric starts from the current position, including after a seek backwards', () => {
  const f = fixture();
  const cancel = centerLyric(
    f.container,
    { offsetTop: 1160, offsetHeight: 80 },
    true,
    f.host,
  );
  f.tick(160);
  const interrupted = f.container.scrollTop;
  cancel();
  centerLyric(f.container, { offsetTop: 260, offsetHeight: 80 }, true, f.host);
  assert.equal(f.container.scrollTop, interrupted, 'No jump when retargeting');
  f.tick(120);
  assert.ok(f.container.scrollTop < interrupted);
  assert.ok(f.container.scrollTop > 100);
  f.tick(600);
  assert.equal(f.container.scrollTop, 100);
  assert.equal(f.pending(), 0);
});

await test('reduced motion centers immediately and first/last lines stay within scroll bounds', () => {
  const f = fixture();
  centerLyric(f.container, { offsetTop: 0, offsetHeight: 80 }, false, f.host);
  assert.equal(f.container.scrollTop, 0);
  centerLyric(
    f.container,
    { offsetTop: 1960, offsetHeight: 40 },
    false,
    f.host,
  );
  assert.equal(f.container.scrollTop, 1600);
  assert.equal(f.pending(), 0);
});

await test('returning after a dropped frame finishes instead of replaying missed frames', () => {
  const f = fixture();
  centerLyric(f.container, { offsetTop: 680, offsetHeight: 40 }, true, f.host);
  f.tick(16);
  f.tick(5000);
  assert.equal(f.container.scrollTop, 500);
  assert.equal(f.pending(), 0);
});
