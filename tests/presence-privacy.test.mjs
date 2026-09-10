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
sql.exec(`INSERT INTO users(id,name,created,lastSeen) VALUES('alice','Alice',1,1789000000000),('bob','Bob',1,1789000000001),('carol','Carol',1,1789000000002),('channel','Channel',1,0);
 UPDATE users SET kind='channel' WHERE id='channel';
 INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bob','bob',1),('carol','carol',1);
 INSERT INTO messages(id,sender,recipient,text,created) VALUES('ab','alice','bob','Fixture',1),('ac','alice','carol','Fixture',2);`);
let failCommit = false;
globalThis.__presenceDB = {
  prepare(query) {
    return {
      query,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        return sql.prepare(query).get(...this.args) || null;
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
  async batch(statements) {
    sql.exec('BEGIN');
    try {
      const results = [];
      for (const s of statements) {
        if (
          failCommit &&
          s.query.startsWith('INSERT INTO user_presence_exceptions')
        ) {
          failCommit = false;
          throw Error('Fixture write failure');
        }
        const q = sql.prepare(s.query);
        const rows = q.columns().length
          ? q.all(...s.args)
          : (q.run(...s.args), []);
        results.push({
          results: rows,
          meta: { changes: Number(sql.prepare('SELECT changes() n').get().n) },
        });
      }
      sql.exec('COMMIT');
      return results;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
globalThis.__presenceHeaders = new Headers();
const { outputFiles } = await build({
  entryPoints: ['app/api/social/route.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'presence-fixture',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(cloudflare:workers|next\/headers|next\/navigation|(\.\/|@\/lib\/)storage)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'cloudflare:workers'
              ? 'export const env={};'
              : path === 'next/headers'
                ? 'export const headers=async()=>globalThis.__presenceHeaders; export const cookies=async()=>({get:()=>undefined,set:()=>{}});'
                : path === 'next/navigation'
                  ? 'export const redirect=()=>{throw new Error("Unexpected redirect")};'
                  : 'export const db=()=>globalThis.__presenceDB; export const bucket=()=>({});',
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
async function call(viewer, action, body, extra = '') {
  globalThis.__presenceHeaders = new Headers(
    viewer
      ? {
          'oai-authenticated-user-id': viewer,
          'oai-authenticated-user-email': viewer + '@example.test',
        }
      : {},
  );
  const req = new Request(
    'http://localhost/api/social?action=' + action + extra,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...body }),
        }
      : {},
  );
  const response = await api[body ? 'POST' : 'GET'](req);
  return { status: response.status, data: await response.json() };
}
async function ok(viewer, action, body, extra) {
  const result = await call(viewer, action, body, extra);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
const save = (viewer, policy, hiddenIds = [], visibleIds = []) =>
  ok(viewer, 'presencePrivacy', { policy, hiddenIds, visibleIds });
async function visible(viewer, owner, show) {
  const profile = await ok(viewer, 'profile', undefined, '&id=' + owner);
  assert.equal(
    profile.visibleLastSeen,
    undefined,
    'Internal projection must not escape',
  );
  assert.equal(profile.lastSeen !== null, show, viewer + ' profile ' + owner);
  if (show) assert.ok(profile.lastSeen > 0);
  if (viewer !== owner) {
    const thread = (await ok(viewer, 'threads')).find((p) => p.id === owner);
    assert.ok(thread);
    assert.equal(thread.lastSeen !== null, show, viewer + ' thread ' + owner);
  }
}
assert.deepEqual(await ok('alice', 'presencePrivacy'), {
  policy: 'everyone',
  hidden: [],
  visible: [],
});
await visible('bob', 'alice', true);
await visible('carol', 'alice', true);
await save('alice', 'everyone', ['bob']);
await visible('bob', 'alice', false);
await visible('carol', 'alice', true);
await visible('alice', 'alice', true);
await save('alice', 'nobody', ['bob'], ['carol']);
await visible('bob', 'alice', false);
await visible('carol', 'alice', true);
await save('alice', 'nobody', ['carol'], ['bob']);
await visible('bob', 'alice', true);
await visible('carol', 'alice', false);
await save('bob', 'nobody');
await visible('bob', 'alice', true); // No reciprocal or Premium rule.
const lists = await ok('alice', 'presencePrivacy');
assert.deepEqual(
  lists.hidden.map((p) => p.id),
  ['carol'],
);
assert.deepEqual(
  lists.visible.map((p) => p.id),
  ['bob'],
);
await save('alice', 'everyone', ['carol'], ['bob']);
await visible('bob', 'alice', true);
await visible('carol', 'alice', false);
await save('alice', 'nobody', ['carol'], ['bob']);
for (const body of [
  { policy: 'contacts', hiddenIds: [], visibleIds: [] },
  { policy: ['everyone'], hiddenIds: [], visibleIds: [] },
  { policy: 'everyone', hiddenIds: ['bob', 'bob'], visibleIds: [] },
  { policy: 'everyone', hiddenIds: ['alice'], visibleIds: [] },
  { policy: 'everyone', hiddenIds: ['channel'], visibleIds: [] },
  { policy: 'everyone', hiddenIds: ['missing'], visibleIds: [] },
  { policy: 'everyone', hiddenIds: [null], visibleIds: [] },
  { policy: 'everyone', hiddenIds: [], visibleIds: null },
  {
    policy: 'everyone',
    hiddenIds: Array.from({ length: 101 }, (_, i) => 'p' + i),
    visibleIds: [],
  },
])
  assert.equal((await call('alice', 'presencePrivacy', body)).status, 400);
assert.deepEqual(
  await ok('alice', 'presencePrivacy'),
  lists,
  'Invalid saves must not partly change settings',
);
await ok('bob', 'presencePrivacy', {
  policy: 'everyone',
  hiddenIds: [],
  visibleIds: [],
  userId: 'alice',
  id: 'alice',
});
assert.equal(
  (await ok('bob', 'presencePrivacy', undefined, '&id=alice')).policy,
  'everyone',
);
assert.equal((await ok('alice', 'presencePrivacy')).policy, 'nobody');
assert.equal((await call(null, 'presencePrivacy')).status, 401);
assert.equal(
  (
    await call(null, 'presencePrivacy', {
      policy: 'everyone',
      hiddenIds: [],
      visibleIds: [],
    })
  ).status,
  401,
);
const oldError = console.error;
console.error = () => {};
try {
  failCommit = true;
  assert.equal(
    (
      await call('alice', 'presencePrivacy', {
        policy: 'everyone',
        hiddenIds: [],
        visibleIds: [],
      })
    ).status,
    500,
  );
} finally {
  console.error = oldError;
}
assert.deepEqual(
  await ok('alice', 'presencePrivacy'),
  lists,
  'A failed transaction preserves policy and both lists',
);
await ok('alice', 'blockUser', { id: 'bob', value: true });
await visible('bob', 'alice', false);
await visible('alice', 'bob', false);
await ok('alice', 'blockUser', { id: 'bob', value: false });
await visible('bob', 'alice', true);
await save('alice', 'everyone');
await visible('bob', 'alice', true);
await visible('carol', 'alice', true);
await ok('alice', 'privacy', { hideAdult: true, messagePolicy: 'nobody' });
assert.equal(
  (await ok('alice', 'presencePrivacy')).policy,
  'everyone',
  'Existing privacy updates do not overwrite presence settings',
);
console.log(
  'Presence API: everyone/nobody, both exception lists, profile and thread redaction, no reciprocity/Premium requirement, block priority, authentication, validation and atomic rollback passed.',
);
