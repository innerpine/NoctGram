import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/layout-flip.ts'],
  bundle: true,
  write: false,
  format: 'esm',
});
const { flip, flipFrames } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const box = (left, top, width, height) => ({ left, top, width, height });

void test('frames start at the previous box and end in the layout box', () => {
  assert.deepEqual(
    flipFrames(box(0, 40, 300, 60), box(0, 110, 300, 60), 'move'),
    [{ translate: '0px -70px' }, { translate: '0 0' }],
  );
  assert.deepEqual(
    flipFrames(box(10, 10, 100, 100), box(0, 0, 200, 200), 'scale'),
    [
      { translate: '-40px -40px', scale: '0.5 0.5' },
      { translate: '0 0', scale: '1 1' },
    ],
  );
  assert.deepEqual(
    flipFrames(box(0, 0, 300, 120), box(0, 0, 300, 480), 'height'),
    [{ maxHeight: '120px' }, { maxHeight: '480px' }],
  );
});

void test('unchanged or undrawn boxes have nothing to animate', () => {
  const same = box(5, 5, 50, 50);
  for (const mode of ['move', 'scale', 'height'])
    assert.equal(flipFrames(same, { ...same, top: 5.2 }, mode), null);
  assert.equal(flipFrames(box(0, 0, 0, 0), same, 'move'), null);
  assert.equal(flipFrames(same, box(0, 0, 0, 0), 'scale'), null);
});

void test('an interrupted slide continues from where it is drawn and reduced motion snaps', () => {
  let reduced = false;
  globalThis.matchMedia = () => ({ matches: reduced });
  const animations = [];
  const element = {
    isConnected: true,
    getBoundingClientRect: () => box(0, 100, 200, 50),
    animate(frames) {
      const animation = {
        frames,
        cancelled: false,
        cancel: () => (animation.cancelled = true),
      };
      animations.push(animation);
      return animation;
    },
  };
  flip(element, box(0, 20, 200, 50));
  // Measured mid-flight, e.g. 30 px short of the target.
  flip(element, box(0, 70, 200, 50));
  assert.equal(animations[0].cancelled, true);
  assert.deepEqual(animations[1].frames[0], { translate: '0px -30px' });
  reduced = true;
  flip(element, box(0, 0, 200, 50));
  assert.equal(animations[1].cancelled, true);
  assert.equal(animations.length, 2);
  delete globalThis.matchMedia;
});
