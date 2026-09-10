import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const { outputFiles } = await build({
  entryPoints: ['lib/image-palette.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { paletteFromPixels } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
await test('cover palette ignores transparent margins and black/white lettering', () => {
  const pixels = new Uint8ClampedArray([
    ...Array(100).fill([255, 255, 255, 255]).flat(),
    ...Array(100).fill([0, 0, 0, 255]).flat(),
    ...Array(100).fill([0, 255, 0, 0]).flat(),
    ...Array(20).fill([205, 74, 104, 255]).flat(),
    ...Array(8).fill([67, 91, 221, 255]).flat(),
  ]);
  assert.deepEqual(paletteFromPixels(pixels), ['#cd4a68', '#435bdd']);
});
await test('empty covers use fallback; a monochrome cover keeps its own colour', () => {
  assert.equal(
    paletteFromPixels(new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255])),
    null,
  );
  assert.deepEqual(
    paletteFromPixels(new Uint8ClampedArray([40, 100, 180, 255])),
    ['#2864b4', '#2864b4'],
  );
});
