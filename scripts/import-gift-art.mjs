import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { GIFT_CATALOG, RETIRED_GIFTS } from '../lib/gift-catalog.ts';

const revision = '2cafb0e3d2be5336ae4741f75900afe499c6a5ac';
const base = `https://raw.githubusercontent.com/ssamy2/TelegramGiftsAssests/${revision}`;
const names = [...GIFT_CATALOG, ...RETIRED_GIFTS].map((gift) => gift.id);
const folder = new URL('../public/assets/gifts/', import.meta.url);
await mkdir(folder, { recursive: true });
const provenance = [];
async function importGift(name) {
  const paths = [`tgs/by_name/${name}.tgs`, `webp/by_name/${name}.webp`];
  for (const path of paths) {
    const response = await fetch(`${base}/${path}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2_000_000)
      throw new Error('Unexpectedly large gift asset');
    let output = bytes;
    if (
      path.endsWith('.webp') &&
      (bytes.toString('ascii', 0, 4) !== 'RIFF' ||
        bytes.toString('ascii', 8, 12) !== 'WEBP')
    )
      throw new Error(`${name}: Invalid WebP poster`);
    if (path.endsWith('.tgs')) {
      const data = JSON.parse(
        gunzipSync(bytes, { maxOutputLength: 4_000_000 }).toString('utf8'),
      );
      if (!data.layers?.length || !data.fr || data.op <= data.ip)
        throw new Error('Invalid animation');
      // Only self-contained vector artwork. Never load remote media or expressions.
      const inspect = (value) => {
        if (!value || typeof value !== 'object') return;
        if (
          typeof value.x === 'string' ||
          (value.p && typeof value.p === 'string')
        )
          throw new Error(`${name}: External asset or expression`);
        Object.values(value).forEach(inspect);
      };
      inspect(data);
      output = Buffer.from(JSON.stringify(data));
    }
    const file = `${name}.${path.endsWith('.tgs') ? 'json' : 'webp'}`;
    await writeFile(new URL(file, folder), output);
    provenance.push({
      file,
      source: `${base}/${path}`,
      sha256: createHash('sha256').update(output).digest('hex'),
    });
    console.log(`${file}: ${output.length} bytes`);
  }
}
// Bound downloads; a partial import must not replace the complete manifest.
let next = 0;
const failures = [];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < names.length) {
      const name = names[next++];
      try {
        await importGift(name);
      } catch (error) {
        failures.push(error);
      }
    }
  }),
);
if (failures.length) throw new AggregateError(failures, 'Gift import failed');
provenance.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(
  new URL('sources.json', folder),
  JSON.stringify({ revision, assets: provenance }, null, 2) + '\n',
);
