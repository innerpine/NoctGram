import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { giftRenderer } from '../lib/gift-renderer.ts';

const gradient = (stops, ty = 'gf') => ({
  layers: [{ shapes: [{ ty, g: { p: 2, k: { k: stops } } }] }],
});
const colors = [0, 1, 0, 0, 1, 0, 0, 1];
assert.equal(
  giftRenderer(gradient(colors)),
  'canvas',
  'Opaque gradients stay on the fast renderer',
);
assert.equal(
  giftRenderer(gradient([...colors, 0, 1, 1, 0])),
  'canvas',
  'Aligned transparency stops are supported',
);
assert.equal(
  giftRenderer(gradient([...colors, 0.25, 1, 1, 0])),
  'svg',
  'Independent opacity positions require a mask',
);
assert.equal(
  giftRenderer(gradient([...colors, 0, 1, 0.5, 0.5, 1, 0], 'gs')),
  'svg',
  'Gradient strokes can also need opacity masks',
);
assert.equal(
  giftRenderer({
    assets: [
      {
        layers: [
          gradient([
            { s: [...colors, 0, 1, 1, 0], e: [...colors, 0.5, 1, 1, 0] },
          ]),
        ],
      },
    ],
  }),
  'svg',
  'Inspect nested precompositions and animated end values',
);
const rose = JSON.parse(
  await readFile('public/assets/gifts/eternal_rose.json', 'utf8'),
);
assert.equal(
  giftRenderer(rose),
  'svg',
  'The original rose must retain its glass opacity masks',
);
const bear = JSON.parse(
  await readFile('public/assets/gifts/toy_bear.json', 'utf8'),
);
assert.equal(
  giftRenderer(bear),
  'canvas',
  'Compatible gifts retain Canvas optimization',
);
console.log(
  'Gift rendering: real rose glass uses SVG; compatible art, opacity alignment/counts, gradient strokes and animated masks checked.',
);
