import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

// Sticker files are checked before they reach storage: TGS unpacking is
// bounded, Lottie may not load anything or run code, and image headers give
// the real size.
const { outputFiles } = await build({
  entryPoints: ['lib/tgs-validate.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const {
  inflateTgs,
  inspectLottie,
  imageSize,
  StickerFileError,
  TGS_LIMIT,
  LOTTIE_NODE_LIMIT,
} = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const lottie = (patch = {}) => ({
  v: '5.5.2',
  fr: 60,
  ip: 0,
  op: 180,
  w: 512,
  h: 512,
  layers: [{ ty: 4, ks: { o: { a: 0, k: 100 } }, shapes: [] }],
  ...patch,
});
assert.equal(inspectLottie(lottie()), null, 'A plain 3-second sticker passes');
assert.equal(inspectLottie(lottie(), { exactSize: 512 }), null);
assert.match(inspectLottie(lottie({ w: 256 }), { exactSize: 512 }), /512×512/);
assert.match(inspectLottie(lottie({ w: 600 })), /до 512×512/);
assert.match(inspectLottie(lottie({ fr: 0 })), /Частота/);
assert.match(inspectLottie(lottie({ fr: 120 })), /Частота/);
assert.match(inspectLottie(lottie({ op: 0 })), /длительность/);
assert.match(inspectLottie(lottie({ op: 190 })), /длиннее 3/);
assert.equal(inspectLottie(lottie({ op: 590 }), { maxSeconds: 10 }), null);
assert.match(inspectLottie([]), /не анимация/);
assert.match(
  inspectLottie(
    lottie({
      layers: [{ ty: 4, ks: { o: { a: 0, k: 100, x: 'var $bm_rt = 0;' } } }],
    }),
  ),
  /Выражения/,
);
assert.match(
  inspectLottie(lottie({ assets: [{ id: 'i', u: '', p: 'https://x/y.png' }] })),
  /Картинки/,
);
assert.match(inspectLottie(lottie({ layers: [{ ty: 5 }] })), /Текстовые/);
assert.match(
  inspectLottie(lottie({ assets: [{ id: 'c', layers: [{ ty: 5 }] }] })),
  /Текстовые/,
  'Text layers inside precompositions are found too',
);
assert.equal(
  inspectLottie(lottie({ layers: [{ ty: 4, ef: [{ ty: 5, nm: 'Slider' }] }] })),
  null,
  'An effect of type 5 is not a text layer',
);
assert.match(inspectLottie(lottie({ fonts: { list: [] } })), /Шрифты/);
assert.match(inspectLottie(lottie({ chars: [] })), /Шрифты/);
assert.match(
  inspectLottie(
    lottie({
      layers: [
        {
          ty: 4,
          shapes: Array.from({ length: LOTTIE_NODE_LIMIT }, () => ({})),
        },
      ],
    }),
  ),
  /сложная/,
);

const tgs = (data) => new Uint8Array(gzipSync(JSON.stringify(data)));
assert.deepEqual(JSON.parse(await inflateTgs(tgs(lottie()))), lottie());
await assert.rejects(
  inflateTgs(new TextEncoder().encode('{"not":"gzip"}')),
  (error) => error instanceof StickerFileError && /gzip/.test(error.message),
);
await assert.rejects(
  inflateTgs(new Uint8Array(TGS_LIMIT + 1).fill(0x1f)),
  /64 КБ/,
);
await assert.rejects(
  inflateTgs(new Uint8Array(gzipSync(' '.repeat(2 * 1024 * 1024)))),
  /после распаковки/,
  'A small archive cannot expand past the limit',
);
const broken = tgs(lottie());
broken.fill(0, 12, 40);
await assert.rejects(inflateTgs(broken), StickerFileError);

// Headers: PNG IHDR and the three WebP variants.
const png = new Uint8Array(33);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
png.set(new TextEncoder().encode('IHDR'), 12);
new DataView(png.buffer).setUint32(16, 512);
new DataView(png.buffer).setUint32(20, 300);
assert.deepEqual(imageSize(png, 'image/png'), { width: 512, height: 300 });
const riff = (chunk, body) => {
  const bytes = new Uint8Array(20 + body.length);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  bytes.set(new TextEncoder().encode(chunk), 12);
  bytes.set(body, 20);
  return bytes;
};
const vp8x = new Uint8Array(12);
vp8x.set([0x10, 0, 0, 0, 0xff, 0x01, 0, 0x7f, 0, 0]);
assert.deepEqual(imageSize(riff('VP8X', vp8x), 'image/webp'), {
  width: 512,
  height: 128,
});
const vp8l = new Uint8Array(12);
vp8l[0] = 0x2f;
new DataView(vp8l.buffer).setUint32(1, 99 | (199 << 14), true);
assert.deepEqual(imageSize(riff('VP8L', vp8l), 'image/webp'), {
  width: 100,
  height: 200,
});
const vp8 = new Uint8Array(12);
vp8.set([0, 0, 0, 0x9d, 0x01, 0x2a]);
new DataView(vp8.buffer).setUint16(6, 320, true);
new DataView(vp8.buffer).setUint16(8, 240, true);
assert.deepEqual(imageSize(riff('VP8 ', vp8), 'image/webp'), {
  width: 320,
  height: 240,
});
assert.equal(imageSize(riff('VP8 ', new Uint8Array(12)), 'image/webp'), null);
assert.equal(imageSize(png.slice(0, 20), 'image/png'), null);
assert.equal(imageSize(png, 'image/gif'), null);
console.log('TGS and sticker image validation passed.');
