import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import ts from 'typescript';
import test from 'node:test';

const source = readFileSync('lib/account-access.ts', 'utf8');
const ast = ts.createSourceFile(
  'access.ts',
  source,
  ts.ScriptTarget.Latest,
  true,
);
const visible = ast.statements
  .find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'visibleAccount')
  .getText(ast);
const { outputFiles } = await build({
  stdin: {
    contents:
      "export * from './lib/chat-notifications'; export {GET,POST} from './app/api/chat-notifications/route';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'isolated-chat-settings',
      setup(builder) {
        builder.onResolve(
          { filter: /^(\.\/storage|\.\/account-access|@\/lib\/server)$/ },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          loader: 'ts',
          resolveDir: process.cwd(),
          contents:
            path === './storage'
              ? 'export const db=()=>globalThis.__chatPreferences.db;'
              : path === './account-access'
                ? `import {ApiError} from './lib/api-error'; ${visible}
        export async function assertReadable(me){if(globalThis.__chatPreferences.blocked===me)throw new ApiError(403,'Blocked');}`
                : `import {ApiError,failure} from './lib/api-error'; export {ApiError,failure};
        export async function viewer(){const actor=globalThis.__chatPreferences.actor;if(!actor)throw new ApiError(401,'Signed out');return actor;}`,
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const migrations = JSON.parse(
  readFileSync('drizzle/meta/_journal.json', 'utf8'),
).entries.map((e) => readFileSync('drizzle/' + e.tag + '.sql', 'utf8'));
function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  for (const migration of migrations) sql.exec(migration);
  sql.exec(
    "PRAGMA foreign_keys=ON; INSERT INTO users(id,name,created) VALUES('alice','A',1),('bob','B',1),('carol','C',1); INSERT INTO users(id,name,kind,ownerId,created) VALUES('channel','Channel','channel','alice',1)",
  );
  const state = {
    actor: 'alice',
    blocked: null,
    sql,
    beforeWrite: null,
    db: {
      prepare(text) {
        const bind = (args = []) => ({
          bind: (...values) => bind(values),
          first: async () => sql.prepare(text).get(...args) || null,
          run: async () => {
            state.beforeWrite?.();
            state.beforeWrite = null;
            return {
              meta: { changes: Number(sql.prepare(text).run(...args).changes) },
            };
          },
        });
        return bind();
      },
    },
  };
  globalThis.__chatPreferences = state;
  t.after(() => {
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    sql.close();
    delete globalThis.__chatPreferences;
  });
  return state;
}
const body = (muted, peer = 'bob') => ({ actor: 'alice', peer, muted });
await test('preferences persist independently per account and peer; no-op retries preserve the cutoff', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await api.readChatNotifications('alice', 'bob'), {
    peer: 'bob',
    muted: false,
  });
  await api.saveChatNotifications('alice', body(false), 10);
  assert.equal(
    f.sql.prepare('SELECT COUNT(*) n FROM direct_chat_notifications').get().n,
    0,
  );
  assert.deepEqual(await api.saveChatNotifications('alice', body(true), 20), {
    peer: 'bob',
    muted: true,
  });
  await api.saveChatNotifications('alice', body(true), 30);
  assert.equal(
    f.sql.prepare('SELECT updated FROM direct_chat_notifications').get()
      .updated,
    20,
  );
  assert.equal((await api.readChatNotifications('bob', 'alice')).muted, false);
  assert.equal(
    (await api.readChatNotifications('alice', 'carol')).muted,
    false,
  );
  assert.deepEqual(await api.saveChatNotifications('alice', body(false), 40), {
    peer: 'bob',
    muted: false,
  });
  await api.saveChatNotifications('alice', body(false), 50);
  assert.equal(
    f.sql.prepare('SELECT updated FROM direct_chat_notifications').get()
      .updated,
    40,
  );
});
await test('invalid input and actor changes cannot mutate another user preferences', async (t) => {
  const f = fixture(t);
  for (const value of [null, 1, 'yes'])
    await assert.rejects(
      api.saveChatNotifications('alice', body(value)),
      (e) => e.status === 400,
    );
  await assert.rejects(
    api.saveChatNotifications('alice', { ...body(true), actor: 'bob' }),
    (e) => e.status === 401,
  );
  for (const peer of ['alice', 'channel', 'missing'])
    await assert.rejects(
      api.saveChatNotifications('alice', body(true, peer)),
      (e) => e.status === 404,
    );
  assert.equal(
    f.sql.prepare('SELECT COUNT(*) n FROM direct_chat_notifications').get().n,
    0,
  );
  f.blocked = 'alice';
  await assert.rejects(
    api.saveChatNotifications('alice', body(true)),
    (e) => e.status === 403,
  );
});
await test('soft deletion at commit prevents saving a stale preference', async (t) => {
  const f = fixture(t);
  f.beforeWrite = () =>
    f.sql.exec("UPDATE users SET deletedAt=1 WHERE id='bob'");
  await assert.rejects(
    api.saveChatNotifications('alice', body(true)),
    (e) => e.status === 404,
  );
  assert.equal(
    f.sql.prepare('SELECT COUNT(*) n FROM direct_chat_notifications').get().n,
    0,
  );
});
await test('HTTP settings are private and reject anonymous, foreign-origin and stale-account requests', async (t) => {
  const f = fixture(t),
    origin = 'https://noctgram.test';
  const request = (data = body(true), headers = {}) =>
    new Request(origin + '/api/chat-notifications', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(data),
    });
  assert.equal(
    (await api.POST(request(body(true), { Origin: 'https://foreign.test' })))
      .status,
    403,
  );
  assert.equal(
    (await api.POST(request(body(true), { 'Sec-Fetch-Site': 'cross-site' })))
      .status,
    403,
  );
  assert.equal(
    (await api.POST(request({ ...body(true), actor: 'bob' }))).status,
    401,
  );
  assert.equal(
    (
      await api.GET(
        new Request(origin + '/api/chat-notifications?actor=bob&peer=alice'),
      )
    ).status,
    401,
  );
  f.actor = null;
  assert.equal((await api.POST(request())).status, 401);
  f.actor = 'alice';
  const saved = await api.POST(request());
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('cache-control'), 'private, no-store');
  const read = await api.GET(
    new Request(origin + '/api/chat-notifications?actor=alice&peer=bob'),
  );
  assert.deepEqual(await read.json(), { peer: 'bob', muted: true });
  assert.equal(read.headers.get('cache-control'), 'private, no-store');
});
