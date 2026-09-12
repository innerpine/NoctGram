// Import the reviewed Telegram attribute snapshot and self-contained artwork.
// No external requests are needed by Noctgram to display an upgraded gift.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const source = JSON.parse(
  await readFile(new URL('scripts/data/gift-upgrades.json', root), 'utf8'),
);
const native = JSON.parse(
  await readFile(new URL('scripts/data/gift-native-lottie.json', root), 'utf8'),
);
const folder = new URL('public/assets/gifts/', root);
const provenanceFile = new URL('collectible-sources.json', folder);
await mkdir(folder, { recursive: true });
const hashes = new Map();
try {
  const old = JSON.parse(await readFile(provenanceFile, 'utf8'));
  for (const file of old.files) hashes.set(file.file, file);
} catch {
  /* First import. */
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const files = [];
const failures = [];

async function download(url) {
  if (
    !['https://api.changes.tg', 'https://cdn.changes.tg'].includes(
      new URL(url).origin,
    )
  )
    throw Error('Unreviewed asset origin');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error(`Asset HTTP ${response.status}: ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 2_000_000) throw Error('Oversized gift asset');
      return bytes;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1200));
    }
  }
}
function inspectAnimation(bytes, job) {
  const decoded = gunzipSync(bytes, { maxOutputLength: 4_000_000 });
  const data = JSON.parse(decoded.toString('utf8'));
  const reviewed = native.files.find((entry) => entry.file === job.file);
  if (reviewed) {
    if (
      reviewed.sourceUrl !== job.url ||
      hash(bytes) !== reviewed.originalCompressedSha256 ||
      hash(decoded) !== reviewed.originalDecompressedSha256
    )
      throw Error('Reviewed native animation changed');
    // Telegram rlottie ignores these exact expression strings and plays stored a/k values.
    // Never evaluate expressions or resolve references; preserve all baked properties.
    for (const removal of reviewed.remove) {
      const parent = removal.path
        .slice(0, -1)
        .reduce((value, key) => value?.[key], data);
      const key = removal.path.at(-1);
      if (key !== 'x' || parent?.[key] !== removal.expectedExpression)
        throw Error('Native animation path changed');
      delete parent[key];
    }
  }
  if (
    !data.layers?.length ||
    !Number.isFinite(data.fr) ||
    data.fr <= 0 ||
    data.op <= data.ip
  )
    throw Error('Invalid gift animation');
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.x === 'string' || typeof value.p === 'string')
      throw Error('External asset or expression in animation');
    Object.values(value).forEach(inspect);
  }
  inspect(data);
  return reviewed ? gzipSync(JSON.stringify(data), { level: 9 }) : bytes;
}
async function importFile(job) {
  const previous = hashes.get(job.file);
  if (previous?.source === job.url) {
    try {
      const bytes = await readFile(new URL(job.file, folder));
      if (hash(bytes) === previous.sha256) {
        files.push(previous);
        return;
      }
    } catch {
      /* Missing or changed asset: fetch again. */
    }
  }
  let bytes = await download(job.url);
  const originalSha256 = hash(bytes);
  if (job.file.endsWith('.tgs')) bytes = inspectAnimation(bytes, job);
  else {
    const metadata = await sharp(bytes, {
      limitInputPixels: 1024 * 1024,
    }).metadata();
    if (
      metadata.format !== 'png' ||
      !metadata.width ||
      metadata.width > 512 ||
      metadata.height > 512
    )
      throw Error('Invalid gift poster');
    bytes = await sharp(bytes).webp({ lossless: true }).toBuffer();
  }
  const destination = new URL(job.file, folder);
  await writeFile(new URL(job.file + '.part', folder), bytes);
  await rename(new URL(job.file + '.part', folder), destination);
  const entry = {
    file: job.file,
    source: job.url,
    sha256: hash(bytes),
    bytes: bytes.length,
    ...(native.files.some((file) => file.file === job.file)
      ? { originalSha256, nativeSanitization: 1 }
      : {}),
  };
  hashes.set(job.file, entry);
  files.push(entry);
}

const jobs = source.assets;
let next = 0;
let completed = 0;
async function checkpoint() {
  await writeFile(
    provenanceFile,
    JSON.stringify(
      {
        source: source.source,
        fetchedAt: source.fetchedAt,
        files: [...hashes.values()],
      },
      null,
      2,
    ) + '\n',
  );
}
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await importFile(job);
      } catch (error) {
        failures.push(`${job.file}: ${error.message}`);
      }
      if (++completed % 100 === 0)
        console.log(
          `Imported ${completed}/${jobs.length}; failed ${failures.length}`,
        );
    }
  }),
);
await checkpoint();
if (failures.length) {
  console.error(failures.join('\n'));
  throw Error(
    `${failures.length} gift assets were not imported; catalog unchanged`,
  );
}
for (const collection of source.collections) {
  for (const key of ['models', 'symbols', 'backdrops']) {
    const rows = collection[key];
    if (
      !rows.length ||
      rows.some(
        (row) =>
          !Number.isSafeInteger(row.rarityPermille) || row.rarityPermille <= 0,
      ) ||
      rows.reduce((sum, row) => sum + row.rarityPermille, 0) !== 1000
    )
      throw Error(`${collection.id}: incomplete ${key}; catalog unchanged`);
  }
}
await writeFile(
  new URL('lib/gift-upgrade-data.json', root),
  JSON.stringify(source.collections) + '\n',
);
console.log(
  `Complete: ${source.collections.length} collections, ${files.length} local assets.`,
);
