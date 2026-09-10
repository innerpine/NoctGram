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
globalThis.__backgroundDB = {
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
globalThis.__backgroundHeaders = new Headers();
const { outputFiles } = await build({
  entryPoints: ['app/api/social/route.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'background-fixture',
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
                ? 'export const headers=async()=>globalThis.__backgroundHeaders; export const cookies=async()=>({get:()=>undefined,set:()=>{}});'
                : path === 'next/navigation'
                  ? 'export const redirect=()=>{throw new Error("Unexpected redirect")};'
                  : 'export const db=()=>globalThis.__backgroundDB; export const bucket=()=>({});',
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
  globalThis.__backgroundHeaders = new Headers(
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

const defaults = {
  mode: 'theme',
  first: '#aa66cc',
  second: '#3366aa',
  intensity: 30,
};
const design = {
  theme: 'ember',
  nameGradient: true,
  ringText: '',
  chromeFlow: false,
  chromeTempo: 11,
  avatarMotion: '',
  poster: '',
  background: defaults,
};
sql.exec(
  `INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) VALUES('alice',1,9999999999999,'test',1);`,
);
assert.equal(
  (await call('bob', 'appearance', design)).status,
  403,
  'Premium is enforced on the server',
);
assert.equal(
  (await call(null, 'appearance', design)).status,
  401,
  'Authentication required',
);
const saved = await ok('alice', 'appearance', design);
assert.deepEqual(JSON.parse(saved.profileBackground), defaults);
assert.deepEqual(
  JSON.parse(
    (await ok('bob', 'profile', undefined, '&id=alice')).profileBackground,
  ),
  defaults,
  'Visitors see the saved background',
);
for (const bad of [
  { ...defaults, first: 'url(https://invalid)' },
  { ...defaults, mode: 'unsafe' },
  { ...defaults, intensity: 90 },
  { ...defaults, second: '#fff' },
  { ...defaults, intensity: 30.5 },
  null,
]) {
  assert.equal(
    (await call('alice', 'appearance', { ...design, background: bad })).status,
    400,
  );
}
assert.deepEqual(
  JSON.parse((await ok('alice', 'profile')).profileBackground),
  defaults,
  'Invalid saves do not change the profile',
);
const oldClient = { ...design };
delete oldClient.background;
await ok('alice', 'appearance', oldClient);
assert.deepEqual(
  JSON.parse((await ok('alice', 'profile')).profileBackground),
  defaults,
  'Older clients retain the background',
);
assert.notEqual(
  (await call('bob', 'appearance', { ...design, id: 'alice' })).status,
  200,
  'Other users cannot modify this profile',
);
sql.exec(`UPDATE premium_entitlements SET revokedAt=1 WHERE userId='alice'`);
assert.equal(
  (await ok('bob', 'profile', undefined, '&id=alice')).profileBackground,
  '',
  'Inactive Premium hides the background',
);
assert.equal(
  (
    await call('alice', 'appearance', {
      ...design,
      background: { ...defaults, mode: 'custom' },
    })
  ).status,
  403,
);
assert.deepEqual(
  JSON.parse(
    sql
      .prepare("SELECT background FROM profile_appearance WHERE userId='alice'")
      .get().background,
  ),
  defaults,
  'Entitlement loss preserves saved colours',
);
sql.exec(`UPDATE premium_entitlements SET revokedAt=0 WHERE userId='alice'`);
for (const mode of ['cover', 'custom', 'none']) {
  const b = { ...defaults, mode };
  const result = await ok('alice', 'appearance', { ...design, background: b });
  assert.deepEqual(JSON.parse(result.profileBackground), b);
}
console.log(
  'Profile background API: auth, Premium, validation, persistence, visitors, old clients and entitlement loss passed',
);
sql.close();
