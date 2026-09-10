import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = process.env.ROOMS_TEST_SOURCE_ROOT || root;
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const sqlite = new DatabaseSync(':memory:');
for (const { tag } of JSON.parse(
  readFileSync(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'),
).entries)
  sqlite.exec(readFileSync(path.join(root, 'drizzle', tag + '.sql'), 'utf8'));
if (
  !sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='chat_rooms'").get()
)
  sqlite.exec(
    readFileSync(
      path.join(sourceRoot, 'tests/fixtures/rooms-schema.sql'),
      'utf8',
    ),
  );
sqlite.exec(
  "INSERT INTO users(id,name,avatar,created) VALUES('alice','Alice','/alice.png',1),('bob','Bob','/bob.png',1),('carol','Carol','/carol.png',1),('dave','Dave','/dave.png',1)",
);
function statement(sql) {
  let values = [];
  return {
    bind(...args) {
      values = args;
      return this;
    },
    async first() {
      return sqlite.prepare(sql).get(...values) || null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    runSync() {
      return {
        meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
      };
    },
    async run() {
      return this.runSync();
    },
  };
}
globalThis.__createRetryDb = {
  prepare: statement,
  async batch(statements) {
    // One synchronous transaction models D1 atomicity: concurrent reads cannot
    // see a newly inserted room before its owner/member INSERTs have committed.
    sqlite.exec('BEGIN');
    try {
      const results = statements.map((item) => item.runSync());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};
const result = await build({
  entryPoints: [path.join(sourceRoot, 'lib/rooms.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  nodePaths: [path.join(root, 'node_modules')],
  plugins: [
    {
      name: 'retry-sqlite',
      setup(build) {
        build.onResolve({ filter: /^\.\/auth-session$/ }, () => ({
          path: 'auth',
          namespace: 'fixture-settings',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture-settings' }, () => ({
          contents: "export const setting=()=> '1';",
        }));
        build.onResolve({ filter: /^\.\/storage$/ }, () => ({
          path: 'storage',
          namespace: 'test',
        }));
        build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export const db = () => globalThis.__createRetryDb;',
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64')
);
const create = (who, payload) =>
  api.changeRoom(who, { action: 'create', ...payload });
const key = crypto.randomUUID();
const body = {
  key,
  kind: 'group',
  name: 'Retry once',
  description: 'Same payload',
  memberIds: ['bob'],
};
const original = await create('alice', body);
const retry = await create('alice', body);
assert.equal(
  retry.id,
  original.id,
  'A timeout retry returns the already committed room',
);
assert.equal(
  sqlite
    .prepare('SELECT COUNT(*) n FROM chat_rooms WHERE id=?')
    .get(original.id).n,
  1,
);
assert.equal(
  (await create('alice', { ...body, key: key.toUpperCase() })).id,
  original.id,
  'UUID letter case cannot make a second creation',
);
await assert.rejects(
  create('alice', { ...body, name: 'Changed payload' }),
  (e) => e.status === 409,
);
await assert.rejects(
  create('alice', { ...body, memberIds: ['bob', 'carol'] }),
  (e) => e.status === 409,
);
await assert.rejects(
  create('alice', { key, kind: 'secret', peerId: 'bob' }),
  (e) => e.status === 409,
);
assert.deepEqual(
  (await api.readRoom('alice', original.id)).members
    .map((m) => m.userId)
    .sort(),
  ['alice', 'bob'],
);

const otherOwner = await create('carol', { ...body, memberIds: ['dave'] });
assert.notEqual(
  otherOwner.id,
  original.id,
  'Creation keys are scoped to the authenticated actor',
);
await assert.rejects(
  api.readRoom('alice', otherOwner.id),
  (e) => e.status === 404,
);
assert.deepEqual(
  (await api.readRoom('carol', otherOwner.id)).members
    .map((m) => m.userId)
    .sort(),
  ['carol', 'dave'],
);

const raceKey = crypto.randomUUID();
const racePayload = {
  key: raceKey,
  kind: 'group',
  name: 'Concurrent identical create',
  visibility: 'public',
  username: 'concurrent_create',
  memberIds: ['bob'],
};
const sameRace = await Promise.all([
  create('alice', racePayload),
  create('alice', racePayload),
]);
assert.equal(
  sameRace[0].id,
  sameRace[1].id,
  'Identical concurrent creates return one committed room',
);
assert.equal(
  sqlite
    .prepare(
      "SELECT COUNT(*) n FROM chat_rooms WHERE username='concurrent_create'",
    )
    .get().n,
  1,
);
assert.equal((await api.readRoom('alice', sameRace[0].id)).members.length, 2);

const conflictKey = crypto.randomUUID();
const attempts = [
  { key: conflictKey, name: 'Conflicting retry', memberIds: ['bob'] },
  { key: conflictKey, name: 'Conflicting retry', memberIds: ['carol'] },
];
const conflicting = await Promise.allSettled(
  attempts.map((payload) => create('alice', payload)),
);
const winnerIndex = conflicting.findIndex(
  (result) => result.status === 'fulfilled',
);
assert.notEqual(winnerIndex, -1);
assert.equal(
  conflicting.filter((result) => result.status === 'fulfilled').length,
  1,
);
assert.equal(
  conflicting.find((result) => result.status === 'rejected').reason.status,
  409,
);
const winner = conflicting[winnerIndex].value;
assert.deepEqual(
  (await api.readRoom('alice', winner.id)).members.map((m) => m.userId).sort(),
  ['alice', ...attempts[winnerIndex].memberIds].sort(),
  'The losing batch cannot inject its selected members',
);

await api.changeRoom('alice', {
  action: 'role',
  id: original.id,
  userId: 'bob',
  role: 'owner',
});
await assert.rejects(
  create('alice', body),
  (e) => e.status === 409,
  'Retries never regain transferred ownership',
);
const closedBody = {
  key: crypto.randomUUID(),
  name: 'Close and never recreate',
};
const closed = await create('alice', closedBody);
await api.changeRoom('alice', { action: 'leave', id: closed.id });
await assert.rejects(
  create('alice', closedBody),
  (e) => e.status === 409,
  'Closed creation keys stay consumed',
);
assert.ok(
  sqlite.prepare('SELECT deletedAt FROM chat_rooms WHERE id=?').get(closed.id)
    .deletedAt,
);

const secretPayload = {
  key: crypto.randomUUID(),
  kind: 'secret',
  peerId: 'bob',
};
const secret = await create('alice', secretPayload);
assert.equal(secret.name, 'Bob');
assert.equal(secret.avatar, '/bob.png');
assert.equal(secret.kind, 'secret');
assert.equal(secret.label, 'Секретный чат');
assert.equal((await create('alice', secretPayload)).id, secret.id);
const bobView = await api.readRoom('bob', secret.id);
assert.equal(bobView.name, 'Alice');
assert.equal(bobView.avatar, '/alice.png');
assert.equal(
  (await api.listRooms('alice')).rooms.find((r) => r.id === secret.id).name,
  'Bob',
);
assert.equal(
  (await api.listRooms('bob')).rooms.find((r) => r.id === secret.id).name,
  'Alice',
);
sqlite
  .prepare("UPDATE users SET name='Bobby',avatar='/bobby.png' WHERE id='bob'")
  .run();
const refreshed = (await api.listRooms('alice')).rooms.find(
  (r) => r.id === secret.id,
);
assert.equal(refreshed.name, 'Bobby');
assert.equal(refreshed.avatar, '/bobby.png');
assert.equal(
  sqlite.prepare('SELECT name FROM chat_rooms WHERE id=?').get(secret.id).name,
  'Секретный чат',
  'Stored secret metadata remains generic',
);
assert.equal(
  (await api.searchRooms('carol', 'Bobby')).rooms.length,
  0,
  'Peer projection does not make secret rooms discoverable',
);
await api.changeRoom('bob', { action: 'leave', id: secret.id });
await assert.rejects(create('alice', secretPayload), (e) => e.status === 409);
console.log('Creation retry and secret peer projection checks passed.');
sqlite.close();
delete globalThis.__createRetryDb;
