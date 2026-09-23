import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/fluid-motion.ts'],
  bundle: true,
  write: false,
  format: 'esm',
});
const { project, rubberband, createVelocityTracker, animateSpring } =
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );

function clock() {
  let id = 0,
    time = 0;
  const frames = new Map();
  return {
    requestAnimationFrame(fn) {
      frames.set(++id, fn);
      return id;
    },
    cancelAnimationFrame(frame) {
      frames.delete(frame);
    },
    step(ms = 1000 / 60) {
      time += ms;
      const pending = [...frames.values()];
      frames.clear();
      for (const fn of pending) fn(time);
    },
    get pending() {
      return frames.size;
    },
  };
}

void test('projection follows the WWDC sample and rubber-banding never passes its dimension', () => {
  assert.ok(Math.abs(project(1000) - 499) < 1e-9);
  assert.equal(project(0), 0);
  assert.ok(project(-800) < 0);
  assert.ok(rubberband(20, 100) < 20);
  assert.ok(rubberband(10000, 100) < 100);
  assert.equal(Math.sign(rubberband(-30, 100)), -1);
});

void test('velocity uses only the recent samples', () => {
  const tracker = createVelocityTracker(100);
  tracker.add(0, 0, 0);
  tracker.add(500, 0, 400);
  tracker.add(510, 0, 450);
  tracker.add(530, 20, 500);
  const v = tracker.velocity();
  assert.ok(Math.abs(v.x - 300) < 1e-9);
  assert.ok(Math.abs(v.y - 200) < 1e-9);
  tracker.reset();
  assert.deepEqual(tracker.velocity(), { x: 0, y: 0 });
});

void test('critically damped springs never overshoot; 0.8 overshoots a little; both settle exactly', () => {
  for (const [damping, limit] of [
    [1, 100.05],
    [0.8, 104],
  ]) {
    const host = clock(),
      values = [];
    let done = false;
    animateSpring(0, 100, {
      damping,
      response: 0.35,
      host,
      onUpdate: (x) => values.push(x),
      onComplete: () => (done = true),
    });
    for (let i = 0; i < 300 && host.pending; i++) host.step();
    assert.ok(done);
    assert.equal(values.at(-1), 100);
    assert.ok(Math.max(...values) <= limit, `damping ${damping}`);
    if (damping < 1) assert.ok(Math.max(...values) > 100.5);
  }
});

void test('a spring keeps its live value and velocity when interrupted or retargeted', () => {
  const host = clock(),
    values = [];
  const spring = animateSpring(0, 100, {
    velocity: 400,
    host,
    onUpdate: (x) => values.push(x),
  });
  for (let i = 0; i < 6; i++) host.step();
  const live = spring.stop();
  assert.equal(host.pending, 0);
  assert.equal(live.value, values.at(-1));
  assert.ok(live.velocity > 0);
  const next = animateSpring(live.value, 0, {
    velocity: live.velocity,
    host,
    onUpdate: (x) => values.push(x),
  });
  host.step();
  assert.ok(values.at(-1) > live.value, 'the carried velocity continues first');
  next.retarget(50);
  for (let i = 0; i < 300 && host.pending; i++) host.step();
  assert.equal(values.at(-1), 50);
});
