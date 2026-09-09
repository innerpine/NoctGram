import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ephemeral = new Set([
  'auth_sessions',
  'auth_challenges',
  'account_challenges',
  'recovery_codes',
]);
const ident = (value) => '"' + value.replaceAll('"', '""') + '"';
function literal(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint')
    return String(value);
  if (value instanceof Uint8Array)
    return `X'${Buffer.from(value).toString('hex')}'`;
  if (value.includes('\0'))
    return `CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT)`;
  return "'" + value.replaceAll("'", "''") + "'";
}
export function rowDigest(db, table) {
  const rows = db.prepare(`SELECT * FROM ${ident(table)}`).all();
  const canonical = rows
    .map((row) =>
      JSON.stringify(row, (_key, value) =>
        typeof value === 'bigint'
          ? `${value}n`
          : value instanceof Uint8Array
            ? { blob: Buffer.from(value).toString('base64') }
            : value,
      ),
    )
    .sort();
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
export async function preparePreviewImport(directory) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8'),
  );
  const bytes = await readFile(path.join(directory, 'database.sqlite'));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    manifest.databaseSha256,
    'Backup checksum changed',
  );
  for (const object of manifest.objects) {
    const file = await readFile(path.join(directory, object.file));
    assert.equal(file.length, object.bytes);
    assert.equal(
      createHash('sha256').update(file).digest('hex'),
      object.sha256,
    );
  }
  const db = new DatabaseSync(path.join(directory, 'database.sqlite'), {
    readOnly: true,
  });
  const check = new DatabaseSync(':memory:');
  try {
    const schema = db
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '_mf_%' ORDER BY rowid",
      )
      .all();
    const tables = schema.filter((o) => o.type === 'table');
    assert.ok(
      !tables.some((o) => /CREATE VIRTUAL/i.test(o.sql)),
      'Virtual tables require a dedicated exporter',
    );
    const definitions = [
      ...tables,
      ...schema.filter((o) => o.type === 'index'),
    ].map((o) => o.sql + ';');
    const statements = [...definitions];
    check.exec('PRAGMA foreign_keys=ON');
    check.exec(definitions.join('\n'));
    const pending = [];
    let maxStatementBytes = 0;
    const expected = {};
    for (const table of tables) {
      if (ephemeral.has(table.name)) {
        expected[table.name] = { count: 0 };
        continue;
      }
      const columns = db
        .prepare(`PRAGMA table_info(${ident(table.name)})`)
        .all()
        .map((c) => c.name);
      for (const row of db
        .prepare(`SELECT * FROM ${ident(table.name)}`)
        .all()) {
        const sql = `INSERT INTO ${ident(table.name)} (${columns.map(ident).join(',')}) VALUES (${columns.map((c) => literal(row[c])).join(',')});`;
        maxStatementBytes = Math.max(maxStatementBytes, Buffer.byteLength(sql));
        pending.push({ sql, table: table.name });
      }
      expected[table.name] = {
        count: manifest.counts[table.name],
        sha256: rowDigest(db, table.name),
      };
    }
    // D1 can commit between import chunks. Order individual rows by their real
    // dependencies, including self-references, instead of relying on a PRAGMA
    // remaining enabled across the entire imported file.
    while (pending.length) {
      let progress = 0;
      for (let i = 0; i < pending.length;) {
        const item = pending[i];
        try {
          check.exec(item.sql);
        } catch (error) {
          if (!error.message.includes('FOREIGN KEY constraint failed'))
            throw error;
          i++;
          continue;
        }
        statements.push(item.sql);
        pending.splice(i, 1);
        progress++;
      }
      assert.ok(
        progress,
        `Cyclic or missing foreign keys in: ${[...new Set(pending.map((p) => p.table))].join(',')}`,
      );
    }
    // Populate before enabling application triggers, which only apply to new writes.
    const remaining = schema
      .filter((o) => o.type !== 'table' && o.type !== 'index')
      .map((o) => o.sql + ';');
    statements.push(...remaining);
    check.exec(remaining.join('\n'));
    assert.ok(
      maxStatementBytes < 100000,
      'A row exceeds the D1 statement limit',
    );
    const sql = statements.join('\n');
    assert.equal(check.prepare('PRAGMA foreign_key_check').all().length, 0);
    for (const [name, expectedTable] of Object.entries(expected)) {
      assert.equal(
        check.prepare(`SELECT COUNT(*) AS n FROM ${ident(name)}`).get().n,
        expectedTable.count,
      );
      if (expectedTable.sha256)
        assert.equal(
          rowDigest(check, name),
          expectedTable.sha256,
          `Changed data in ${name}`,
        );
    }
    await writeFile(path.join(directory, 'import.sql'), sql, { flag: 'wx' });
    await writeFile(
      path.join(directory, 'expected-tables.json'),
      JSON.stringify(expected, null, 2),
      { flag: 'wx' },
    );
    return {
      tables: tables.length,
      maxStatementBytes,
      sqlBytes: Buffer.byteLength(sql),
      ephemeralSessionsExcluded: true,
    };
  } finally {
    db.close();
    check.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (!process.argv[2]) throw new Error('Provide a private backup directory');
  console.log(
    JSON.stringify(await preparePreviewImport(path.resolve(process.argv[2]))),
  );
}
