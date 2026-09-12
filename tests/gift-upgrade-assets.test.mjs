import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const json = async (path) =>
  JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8'));
const source = await json('scripts/data/gift-upgrades.json');
const catalog = await json('lib/gift-upgrade-data.json');
const eligible = await json('lib/gift-upgrade-eligibility.json');
const provenance = await json('public/assets/gifts/collectible-sources.json');
assert.deepEqual(catalog, source.collections);
assert.equal(catalog.length, 29);
assert.deepEqual(new Set(catalog.map((c) => c.id)), new Set(eligible));
assert(!eligible.includes('chill_flame'));
const assets = new Map(provenance.files.map((file) => [file.file, file]));
assert.equal(assets.size, 4195);
for (const collection of catalog) {
  for (const key of ['models', 'backdrops', 'symbols']) {
    assert.equal(
      collection[key].reduce((sum, a) => sum + a.rarityPermille, 0),
      1000,
    );
    assert.equal(
      new Set(collection[key].map((a) => a.id)).size,
      collection[key].length,
    );
  }
  for (const a of collection.models) {
    assert(assets.has(a.asset + '.tgs'));
    assert(assets.has(a.asset + '.webp'));
  }
  for (const a of collection.symbols) assert(assets.has(a.asset + '.webp'));
}
function inspect(value) {
  if (!value || typeof value !== 'object') return;
  assert.notEqual(typeof value.x, 'string', 'Expression must not ship');
  assert.notEqual(typeof value.p, 'string', 'External asset must not ship');
  Object.values(value).forEach(inspect);
}
let sanitized = 0;
for (const job of source.assets) {
  const bytes = await readFile(
    new URL('../public/assets/gifts/' + job.file, import.meta.url),
  );
  const entry = assets.get(job.file);
  assert.equal(entry.source, job.url);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  if (job.file.endsWith('.tgs'))
    inspect(JSON.parse(gunzipSync(bytes, { maxOutputLength: 4000000 })));
  else assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  if (entry.nativeSanitization) sanitized++;
}
assert.equal(sanitized, 6);
assert.equal(
  catalog
    .find((c) => c.id === 'perfume_bottle')
    .symbols.find((s) => s.name === 'Sparks').rarityPermille,
  5,
);
console.log(
  '29 complete distributions, 4195 local files and hashes, vector-only safe animations: PASS',
);
