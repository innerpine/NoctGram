// Run with the project's installed sharp dependency: node scripts/optimize-brand-assets.mjs.
// Full-resolution originals stay outside public/, so they are never downloaded by visitors.
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = new URL('../assets/brand/', import.meta.url);
const output = new URL('../public/assets/', import.meta.url);
await mkdir(output, { recursive: true });
const png = { compressionLevel: 9, palette: true, quality: 100, effort: 10 };
for (const name of ['noctgram-logo', 'noct-premium', 'noct-stars']) {
  const input = fileURLToPath(new URL(name + '.png', source));
  await sharp(input)
    .resize({ width: 256 })
    .png(png)
    .toFile(fileURLToPath(new URL(name + '.png', output)));
  for (const width of name === 'noctgram-logo'
    ? [48, 96, 192, 512]
    : [48, 96, 192]) {
    await sharp(input)
      .resize({ width })
      .webp({ quality: 90, alphaQuality: 100, effort: 6 })
      .toFile(fileURLToPath(new URL(`${name}-${width}.webp`, output)));
  }
}
const logo = fileURLToPath(new URL('noctgram-logo.png', source));
for (const size of [16, 32, 48]) {
  await sharp(logo)
    .resize(size, size)
    .png(png)
    .toFile(
      fileURLToPath(new URL(`../public/favicon-${size}.png`, import.meta.url)),
    );
}
for (const size of [192, 512]) {
  await sharp(logo)
    .resize(size, size)
    .png(png)
    .toFile(
      fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url)),
    );
}
await sharp(logo)
  .resize(180, 180)
  .flatten({ background: '#0b0b0d' })
  .png(png)
  .toFile(
    fileURLToPath(new URL('../public/apple-touch-icon.png', import.meta.url)),
  );

// ICO with 16/32/48px 32-bit DIB entries, including an AND transparency mask.
const entries = [];
for (const size of [16, 32, 48]) {
  const rgba = await sharp(logo)
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer();
  const maskStride = Math.ceil(size / 32) * 4;
  const bitmap = Buffer.alloc(40 + size * size * 4 + maskStride * size);
  bitmap.writeUInt32LE(40, 0);
  bitmap.writeInt32LE(size, 4);
  bitmap.writeInt32LE(size * 2, 8);
  bitmap.writeUInt16LE(1, 12);
  bitmap.writeUInt16LE(32, 14);
  bitmap.writeUInt32LE(size * size * 4 + maskStride * size, 20);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const from = ((size - 1 - y) * size + x) * 4;
      const to = 40 + (y * size + x) * 4;
      bitmap[to] = rgba[from + 2];
      bitmap[to + 1] = rgba[from + 1];
      bitmap[to + 2] = rgba[from];
      bitmap[to + 3] = rgba[from + 3];
      if (rgba[from + 3] === 0)
        bitmap[40 + size * size * 4 + y * maskStride + (x >> 3)] |=
          0x80 >> (x % 8);
    }
  entries.push({ size, bitmap });
}
const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(({ size, bitmap }, i) => {
  const at = 6 + i * 16;
  header[at] = size;
  header[at + 1] = size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(bitmap.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += bitmap.length;
});
await writeFile(
  new URL('../public/favicon.ico', import.meta.url),
  Buffer.concat([header, ...entries.map((x) => x.bitmap)]),
);
