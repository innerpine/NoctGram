import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const sqlite = new DatabaseSync(':memory:');
for (const { tag } of JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
).entries)
  sqlite.exec(await readFile(`drizzle/${tag}.sql`, 'utf8'));
sqlite
  .prepare(
    'INSERT INTO users(id,name,created,lastSeen,onboardingComplete) VALUES(?,?,?,?,1)',
  )
  .run('perf-user', 'Performance fixture', 1, Date.now());
let writes = 0,
  batches = 0,
  fail = false;
const statement = (sql) => {
  let values = [];
  return {
    bind(...params) {
      values = params;
      return this;
    },
    async first() {
      return sqlite.prepare(sql).get(...values) || null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async run() {
      writes++;
      return sqlite.prepare(sql).run(...values);
    },
  };
};
const database = () => ({
  prepare: statement,
  async batch(items) {
    batches++;
    if (fail) {
      fail = false;
      throw new Error('Storage unavailable');
    }
    return Promise.all(items.map((item) => item.run()));
  },
});
globalThis.__perfServer = {
  database: database(),
  user: { userId: 'perf-user', source: 'email' },
};
try {
  const compiled = await build({
    entryPoints: ['lib/server.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'isolated-server',
        setup(build) {
          build.onResolve(
            { filter: /^\.\/(storage|auth-session)$/ },
            ({ path }) => ({ path, namespace: 'fixture' }),
          );
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === './storage'
                ? 'export const db=()=>globalThis.__perfServer.database; export const bucket=()=>({});'
                : 'export const identity=async()=>globalThis.__perfServer.user;',
          }));
        },
      },
    ],
  });
  const api = await import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );
  await Promise.all(Array.from({ length: 20 }, () => api.seed()));
  assert.equal(batches, 1, 'Concurrent polling initializes a database once');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 2);
  const afterSeed = writes;
  for (let i = 0; i < 20; i++) assert.equal(await api.viewer(), 'perf-user');
  assert.equal(
    writes,
    afterSeed,
    'Fresh presence does not issue 20 no-op write requests',
  );
  sqlite.prepare('UPDATE users SET lastSeen=1 WHERE id=?').run('perf-user');
  await api.viewer();
  assert.equal(writes, afterSeed + 1, 'Expired presence still refreshes');
  sqlite
    .prepare('UPDATE users SET onboardingComplete=0 WHERE id=?')
    .run('perf-user');
  await assert.rejects(api.viewer(), (error) => error.status === 428);
  globalThis.__perfServer.user = null;
  await assert.rejects(api.viewer(), (error) => error.status === 401);
  globalThis.__perfServer.database = database();
  fail = true;
  await assert.rejects(api.seed(), /Storage unavailable/);
  await api.seed();
  assert.equal(
    batches,
    3,
    'Different bindings initialize separately; failures can retry',
  );
  console.log(
    'Server polling: one seed batch for 20 requests, no redundant fresh-presence writes, timestamp refresh/auth checks and initialization retries passed.',
  );
} finally {
  sqlite.close();
  delete globalThis.__perfServer;
}
