import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Built-in stickers and custom emoji: every file is the pinned Telegram Web K
// asset recorded in sources.json, passes the upload rules and has a poster.
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './lib/sticker-catalog';
      export { premiumEmoji, premiumEmojiPacks, emojiParts, emojiFallback, hasPremiumEmoji } from './lib/premium-emoji';
      export { inspectLottie } from './lib/tgs-validate';
      export { largeEmojiCount } from './lib/chat-emoji';
      export { normalizeSearch } from './lib/search-text';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const sources = JSON.parse(
  readFileSync('public/assets/stickers/sources.json', 'utf8'),
);
const catalog = JSON.parse(readFileSync('lib/sticker-catalog.json', 'utf8'));
assert.equal(sources.revision, '8125029807ad94a6c35492229113d4386c3a8f52');
assert.equal(catalog.revision, sources.revision);
assert.match(sources.license, /GPL-3\.0/);
assert.match(sources.license, /no tweb code/);
const recorded = new Map(sources.files.map((row) => [row.file, row]));
const paths = new Set(
  catalog.packs.flatMap((pack) => pack.items.map((item) => item.path)),
);
for (const path of paths) {
  const file = path.replace('/assets/stickers/', '');
  const row = recorded.get(file);
  assert.ok(row, 'Provenance recorded for ' + file);
  const bytes = readFileSync('public' + path);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    row.sha256,
    'Byte-identical to the recorded source: ' + file,
  );
  assert.equal(bytes.length, row.bytes);
  assert.ok(
    row.url.startsWith(
      `https://raw.githubusercontent.com/morethanwords/tweb/${sources.revision}/public/assets/tgs/`,
    ),
  );
  const data = JSON.parse(bytes.toString('utf8'));
  assert.equal(
    api.inspectLottie(data, { maxSize: 512, maxSeconds: 10 }),
    null,
    'Passes the Lottie rules: ' + file,
  );
  assert.ok(
    existsSync('public' + api.posterFor(path)),
    'Static poster exists for ' + file,
  );
}
assert.equal(recorded.size, paths.size, 'No stale provenance entries');

// Refs resolve only to real catalog items; custom emoji are not stickers.
const first = catalog.packs.find((pack) => pack.type === 'stickers');
const ref = `b:${first.id}:${first.items[0].slug}`;
assert.equal(api.builtinSticker(ref).item.path, first.items[0].path);
assert.equal(api.builtinSticker('b:tgweb:star_gold'), null);
assert.equal(api.builtinItem('b:tgweb:star_gold').pack.type, 'emoji');
assert.equal(api.builtinItem('b:utya:missing'), null);
assert.equal(api.builtinItem('b:../x:y'), null);
const info = api.builtinInfo(first, first.items[0]);
assert.deepEqual(
  {
    ref: info.ref,
    packRef: info.packRef,
    format: info.format,
    available: info.available,
  },
  { ref, packRef: 'b:' + first.id, format: 'lottie', available: true },
);
assert.equal(api.builtinPackInfo(first).stickers.length, first.items.length);

// The Telegram Web emoji set is generated from the catalog and keeps unique
// token names next to the original nine.
const tgweb = catalog.packs.find((pack) => pack.id === 'tgweb');
assert.equal(tgweb.type, 'emoji');
const names = api.premiumEmoji.map((emoji) => emoji.name);
assert.equal(new Set(names).size, names.length, 'Emoji token names are unique');
for (const item of tgweb.items) {
  const emoji = api.premiumEmoji.find((entry) => entry.name === item.slug);
  assert.ok(emoji, 'Premium emoji for ' + item.slug);
  assert.equal(emoji.asset, item.path);
  assert.equal(emoji.fallback, item.emoji);
  assert.equal(emoji.pack, 'tgweb');
}
assert.ok(api.premiumEmojiPacks.some((pack) => pack.title === 'Telegram Web'));
assert.equal(
  api.premiumEmoji.filter((emoji) => !emoji.asset).length,
  9,
  'The original set is unchanged',
);

// Custom emoji tokens: parsing, plain-text fallback, search and big emoji.
const custom = ':ce_0f8b7a4e-2c3d-4e5f-8a9b-0c1d2e3f4a5b:';
const parts = api.emojiParts('Привет :noct_star_gold: и ' + custom);
assert.equal(parts.find((part) => part.emoji)?.emoji.name, 'star_gold');
assert.equal(
  parts.find((part) => part.custom)?.custom,
  '0f8b7a4e-2c3d-4e5f-8a9b-0c1d2e3f4a5b',
);
assert.equal(
  api.emojiFallback('Привет :noct_star_gold: и ' + custom),
  'Привет ⭐ и ✨',
);
assert.equal(api.hasPremiumEmoji(custom), true);
assert.equal(api.hasPremiumEmoji(':ce_nope:'), false);
assert.equal(api.normalizeSearch('Ёлка ' + custom + ' :noct_moon:'), 'елка');
assert.equal(api.largeEmojiCount(':noct_star_gold:'), 1);
assert.equal(api.largeEmojiCount(custom + ' 😀 :noct_moon:'), 3);
assert.equal(api.largeEmojiCount('текст ' + custom), 0);
assert.equal(api.largeEmojiCount(':noct_unknown:'), 0);
console.log(
  `Sticker catalog: ${paths.size} pinned files verified, refs, generated emoji and custom tokens passed.`,
);
