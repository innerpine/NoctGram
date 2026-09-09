import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { Miniflare } from 'miniflare';

// This is a private transfer bundle, never a seed migration or a public asset.
export async function exportLocalPreview({ source, database, destination }) {
  source = path.resolve(source);
  database = path.resolve(database);
  destination = path.resolve(destination);
  const relative = path.relative(source, database);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('The database must be inside the source checkout');
  // Refuse reuse, so an earlier backup can never be overwritten.
  await mkdir(destination, { recursive: false });
  const original = new DatabaseSync(database, { readOnly: true });
  const copy = path.join(destination, 'database.sqlite');
  try {
    await backup(original, copy);
  } finally {
    original.close();
  }
  const snapshot = new DatabaseSync(copy, { readOnly: true });
  let manifest;
  try {
    const check = snapshot.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || Object.values(check[0])[0] !== 'ok')
      throw new Error('Database integrity check failed');
    if (snapshot.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Database foreign key check failed');
    const tables = snapshot
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
      )
      .all();
    const counts = Object.fromEntries(
      tables.map(({ name }) => [
        name,
        snapshot
          .prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`)
          .get().n,
      ]),
    );
    manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      counts,
      objects: [],
    };
    const referenced = [
      ...snapshot
        .prepare("SELECT id AS key FROM uploads WHERE state<>'deleting'")
        .all(),
      ...snapshot.prepare('SELECT objectKey AS key FROM music_audio').all(),
    ];
    // Work on a copy of the emulator's object store, leaving the running app alone.
    await cp(
      path.join(source, '.wrangler/state/v3/r2'),
      path.join(destination, 'r2-state'),
      { recursive: true },
    );
    const mf = new Miniflare({
      modules: true,
      script: 'export default {fetch(){return new Response("backup")}}',
      compatibilityDate: '2026-05-15',
      r2Buckets: { FILES: 'site-creator-r2' },
      r2Persist: path.join(destination, 'r2-state'),
    });
    try {
      const bucket = await mf.getR2Bucket('FILES');
      await mkdir(path.join(destination, 'objects'));
      let cursor;
      do {
        const page = await bucket.list({
          cursor,
          include: ['httpMetadata', 'customMetadata'],
        });
        for (const meta of page.objects) {
          const object = await bucket.get(meta.key);
          if (!object) throw new Error('An object disappeared during backup');
          const bytes = Buffer.from(await object.arrayBuffer());
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          // Object keys are data, not local paths.
          const filename = createHash('sha256').update(meta.key).digest('hex');
          await writeFile(path.join(destination, 'objects', filename), bytes, {
            flag: 'wx',
          });
          manifest.objects.push({
            key: meta.key,
            file: `objects/${filename}`,
            bytes: bytes.length,
            sha256,
            httpMetadata: object.httpMetadata,
            customMetadata: object.customMetadata,
          });
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      const keys = new Set(manifest.objects.map((o) => o.key));
      if (referenced.some((r) => !keys.has(r.key)))
        throw new Error(
          'Referenced files are missing; migration must not proceed',
        );
    } finally {
      await mf.dispose();
    }
  } finally {
    snapshot.close();
  }
  manifest.databaseSha256 = createHash('sha256')
    .update(await readFile(copy))
    .digest('hex');
  await writeFile(
    path.join(destination, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    { flag: 'wx' },
  );
  return {
    profiles: manifest.counts.users,
    messages: manifest.counts.messages,
    objects: manifest.objects.length,
    bytes: manifest.objects.reduce((n, o) => n + o.bytes, 0),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [source, database, destination] = process.argv.slice(2);
  if (!source || !database || !destination)
    throw new Error(
      'Usage: node scripts/export-local-preview.mjs <source checkout> <database sqlite> <new private backup folder>',
    );
  console.log(
    JSON.stringify(await exportLocalPreview({ source, database, destination })),
  );
}
