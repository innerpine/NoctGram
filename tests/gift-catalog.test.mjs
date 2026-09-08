import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GIFT_CATALOG, RETIRED_GIFTS } from '../lib/gift-catalog.ts';

const gifts = [...GIFT_CATALOG, ...RETIRED_GIFTS];
assert.equal(
  new Set(gifts.map((gift) => gift.id)).size,
  gifts.length,
  'Gift IDs must be unique across active and retired catalogs',
);
assert.ok(!GIFT_CATALOG.some((gift) => gift.id === 'diamond_ring'));
const folder = new URL('../public/assets/gifts/', import.meta.url);
const sources = JSON.parse(
  await readFile(new URL('sources.json', folder), 'utf8'),
);
const manifest = new Map(sources.assets.map((asset) => [asset.file, asset]));
assert.equal(
  manifest.size,
  gifts.length * 2,
  'Every gift has one poster and one animation',
);
function inspect(value) {
  if (!value || typeof value !== 'object') return;
  assert.notEqual(
    typeof value.x,
    'string',
    'No executable animation expressions',
  );
  assert.notEqual(
    typeof value.p,
    'string',
    'No external or embedded bitmap resources',
  );
  Object.values(value).forEach(inspect);
}
let bytes = 0;
for (const gift of gifts) {
  assert.match(gift.id, /^[a-z0-9_]+$/);
  assert.ok(
    gift.name.trim() && Number.isSafeInteger(gift.price) && gift.price > 0,
  );
  assert.match(gift.color, /^#[a-f0-9]{6}$/);
  for (const ext of ['json', 'webp']) {
    const file = `${gift.id}.${ext}`;
    const data = await readFile(new URL(file, folder));
    bytes += data.length;
    assert.equal(
      createHash('sha256').update(data).digest('hex'),
      manifest.get(file)?.sha256,
      `${file}: expected imported asset`,
    );
    assert.equal(
      manifest.get(file)?.source,
      `https://raw.githubusercontent.com/ssamy2/TelegramGiftsAssests/${sources.revision}/${ext === 'json' ? 'tgs' : ext}/by_name/${gift.id}.${ext === 'json' ? 'tgs' : ext}`,
    );
    if (ext === 'json') {
      const animation = JSON.parse(data);
      assert.ok(
        animation.layers?.length &&
          animation.fr > 0 &&
          animation.op > animation.ip,
        `${file}: playable animation`,
      );
      inspect(animation);
    } else {
      assert.equal(data.toString('ascii', 0, 4), 'RIFF', file);
      assert.equal(data.toString('ascii', 8, 12), 'WEBP', file);
    }
  }
}
console.log(
  `Gift catalog: ${GIFT_CATALOG.length} available, ${RETIRED_GIFTS.length} retired; all local posters, animations and source hashes verified (${(bytes / 1024 / 1024).toFixed(1)} MB).`,
);
