import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const sql = new DatabaseSync(':memory:');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const { tag } of journal.entries)
  sql.exec(await readFile('drizzle/' + tag + '.sql', 'utf8'));
for (const id of ['alice', 'bob', 'carol', 'dave', 'legacy']) {
  sql.prepare('INSERT INTO users(id,name,created) VALUES(?,?,1)').run(id, id);
  sql
    .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
    .run(id, id);
}

const capacityReads = [];
globalThis.__channelLimitDB = {
  prepare(query) {
    return {
      query,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        const row = sql.prepare(query).get(...this.args) || null;
        if (query.startsWith('SELECT COUNT(*) AS count FROM users'))
          capacityReads.push({ owner: this.args[0], count: row.count });
        return row;
      },
      async all() {
        return { results: sql.prepare(query).all(...this.args) };
      },
      async run() {
        return {
          meta: {
            changes: Number(sql.prepare(query).run(...this.args).changes),
          },
        };
      },
    };
  },
  // D1 batches commit as serialized transactions. No await between statements.
  async batch(statements) {
    sql.exec('BEGIN');
    try {
      const results = statements.map((s) => ({
        meta: { changes: Number(sql.prepare(s.query).run(...s.args).changes) },
      }));
      sql.exec('COMMIT');
      return results;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};

const { outputFiles } = await build({
  stdin: {
    contents:
      "export * from './lib/social-features'; export {POST} from './app/api/social/route';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'channel-limit-fixture',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(cloudflare:workers|next\/headers|next\/server|next\/navigation|(\.\/|@\/lib\/)storage)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'cloudflare:workers'
              ? 'export const env={NOCT_AUTH_MODE:"hybrid"};'
              : path === 'next/server'
                ? 'export const after=()=>{};'
                : path === 'next/headers'
                  ? 'export const headers=async()=>globalThis.__channelLimitHeaders || new Headers(); export const cookies=async()=>({get:()=>undefined,set:()=>{}});'
                  : path === 'next/navigation'
                    ? 'export const redirect=()=>{throw Error("Unexpected redirect")};'
                    : 'export const db=()=>globalThis.__channelLimitDB; export const bucket=()=>({});',
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const create = async (owner, handle, extra = {}) => {
  const response = await api.featurePost(
    'createChannel',
    { name: 'Channel ' + handle, handle, ...extra },
    owner,
  );
  assert.equal(response.status, 200);
  return response.json();
};
const count = (owner) =>
  sql
    .prepare(
      "SELECT COUNT(*) AS n FROM users WHERE kind='channel' AND ownerId=? AND deletedAt=0",
    )
    .get(owner).n;
const atLimit = (e) =>
  e.status === 409 &&
  e.code === 'CHANNEL_LIMIT' &&
  /двумя каналами/.test(e.message);

const first = await create('alice', 'alice_first');
await create('alice', 'alice_second');
assert.equal(count('alice'), 2);
await assert.rejects(
  create('alice', 'alice_third', { ownerId: 'bob' }),
  atLimit,
);
assert.equal(count('alice'), 2);
assert.equal(
  sql
    .prepare("SELECT COUNT(*) AS n FROM handles WHERE handle='alice_third'")
    .get().n,
  0,
);

// Editing someone else's channel does not consume ownership capacity.
sql
  .prepare(
    "INSERT INTO channel_members(channelId,userId,role,created) VALUES(?,?,'admin',1)",
  )
  .run(first.id, 'bob');
await assert.rejects(
  create('bob', 'alice_first'),
  (e) => e.status === 409 && /юзернейм уже занят/.test(e.message),
);
assert.equal(
  count('bob'),
  0,
  'A conflicting handle must roll back the inserted channel',
);
await create('bob', 'bob_first');
await create('bob', 'bob_second');
assert.equal(count('bob'), 2);

const editHandles = async (owner, id, mainHandle, extraHandles, extra = {}) => {
  const result = await api.featurePost(
    'profile',
    {
      id,
      name: 'Updated profile',
      bio: 'Description',
      avatar: '',
      cover: '',
      mainHandle,
      extraHandles,
      ...extra,
    },
    owner,
  );
  return result.json();
};
const handles = (id) =>
  sql
    .prepare(
      'SELECT handle,main FROM handles WHERE userId=? ORDER BY main DESC,handle',
    )
    .all(id);
const tooManyHandles = (e) =>
  e.status === 400 && /максимум 3 юзернейма/.test(e.message);
await editHandles('alice', first.id, 'alice_first', [
  'channel_one',
  'channel_two',
]);
const saved = handles(first.id);
assert.equal(saved.length, 3);
await assert.rejects(
  editHandles(
    'alice',
    first.id,
    'alice_first',
    ['channel_one', 'channel_two', 'channel_three'],
    { kind: 'person' },
  ),
  tooManyHandles,
);
assert.deepEqual(
  handles(first.id),
  saved,
  'Rejected updates must retain the main handle and aliases',
);
await editHandles('alice', first.id, 'alice_first', [
  'channel_one',
  'channel_two',
  '',
  '',
]);
assert.deepEqual(
  handles(first.id),
  saved,
  'Blank fields from an older client do not count as aliases',
);
await editHandles('alice', 'alice', 'alice', [
  'personal_one',
  'personal_two',
  'personal_three',
  'personal_four',
]);
assert.equal(
  handles('alice').length,
  5,
  'Personal account limits are unchanged',
);

// The older single-handle endpoint cannot bypass the channel cap either.
globalThis.__channelLimitHeaders = new Headers({
  'oai-authenticated-user-id': first.id,
  'oai-authenticated-user-email': first.id + '@example.test',
});
const single = await api.POST(
  new Request('http://localhost/api/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'handle', handle: 'channel_four' }),
  }),
);
assert.equal(single.status, 400);
assert.match((await single.json()).error, /максимум 3 юзернейма/);
assert.deepEqual(handles(first.id), saved);
delete globalThis.__channelLimitHeaders;

// Both preflight checks see one channel; only one atomic insert may claim the last slot.
await create('carol', 'carol_first');
capacityReads.length = 0;
const race = await Promise.allSettled([
  create('carol', 'carol_second'),
  create('carol', 'carol_third'),
]);
assert.equal(
  capacityReads.filter((r) => r.owner === 'carol' && r.count === 1).length,
  2,
);
assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
assert.ok(atLimit(race.find((r) => r.status === 'rejected').reason));
assert.equal(count('carol'), 2);
assert.equal(
  sql
    .prepare(
      "SELECT COUNT(*) AS n FROM handles WHERE handle IN('carol_second','carol_third')",
    )
    .get().n,
  1,
);

// A deleted channel releases capacity; an unpublished channel still belongs to its owner.
const deleted = await create('dave', 'dave_deleted');
sql.prepare('UPDATE users SET deletedAt=1 WHERE id=?').run(deleted.id);
await create('dave', 'dave_first');
await create('dave', 'dave_second');
await assert.rejects(create('dave', 'dave_third'), atLimit);
sql.prepare('UPDATE users SET onboardingComplete=0 WHERE id=?').run(first.id);
await assert.rejects(create('alice', 'alice_hidden'), atLimit);

// Existing owners over the new cap keep their data but cannot add a channel.
for (let i = 0; i < 4; i++)
  sql
    .prepare(
      "INSERT INTO users(id,name,kind,ownerId,created) VALUES(?,?,'channel','legacy',1)",
    )
    .run('legacy_' + i, 'Legacy ' + i);
await assert.rejects(create('legacy', 'legacy_new'), atLimit);
assert.equal(count('legacy'), 4);
for (let i = 0; i < 5; i++)
  sql
    .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,?)')
    .run('legacy_handle_' + i, 'legacy_0', i === 0 ? 1 : 0);
const legacyAliases = [
  'legacy_handle_1',
  'legacy_handle_2',
  'legacy_handle_3',
  'legacy_handle_4',
];
await editHandles('legacy', 'legacy_0', 'legacy_handle_0', legacyAliases);
assert.equal(
  handles('legacy_0').length,
  5,
  'Unrelated edits keep existing addresses until the owner changes the set',
);
await assert.rejects(
  editHandles('legacy', 'legacy_0', 'legacy_handle_0', [
    ...legacyAliases.slice(0, 3),
    'legacy_new_alias',
  ]),
  tooManyHandles,
);
await editHandles(
  'legacy',
  'legacy_0',
  'legacy_handle_0',
  legacyAliases.slice(0, 2),
);
assert.equal(handles('legacy_0').length, 3);
sql.close();
delete globalThis.__channelLimitDB;
console.log(
  'Channel ownership limit: capacity, concurrent creation, rollback, membership, deletion and existing channels passed',
);
