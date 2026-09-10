import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents:
      "export * from './lib/upstream-json'; export * from './lib/preview-storage'; export * from './lib/music-request-budget';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'fixture',
      setup(builder) {
        builder.onResolve(
          { filter: /^\.\/(storage|auth-session)$/ },
          (args) => ({
            path: args.path,
            namespace: 'fixture',
          }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === './storage'
              ? 'export const db=()=>globalThis.__storageSecurityDb;'
              : "export const tokenHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');",
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    'CREATE TABLE auth_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expiresAt INTEGER NOT NULL)',
  );
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...v) {
          args = v;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...args) || null;
        },
      };
    },
  };
  globalThis.__storageSecurityDb = db;
  const puts = [];
  const raw = {
    async put(key) {
      puts.push(key);
      return {};
    },
    async delete() {},
  };
  return {
    sqlite,
    db,
    puts,
    bucket: (user) => api.previewBucket(raw, db, user),
    seed(key, count) {
      sqlite
        .prepare('INSERT INTO auth_limits VALUES(?,?,?)')
        .run(key, count, Number.MAX_SAFE_INTEGER);
    },
    count(key) {
      return (
        sqlite.prepare('SELECT count FROM auth_limits WHERE key=?').get(key)
          ?.count || 0
      );
    },
  };
}
await test('chunked oversized JSON cancels despite a false small Content-Length', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"data":"'));
      c.enqueue(new TextEncoder().encode('fixture-secret-too-large'));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    api.readUpstreamJson(
      new Response(body, { headers: { 'content-length': '1' } }),
      10,
    ),
    (e) =>
      e.code === 'MUSIC_UPSTREAM_RESPONSE' &&
      !e.message.includes('fixture-secret'),
  );
  assert.equal(cancelled, true);
});
await test('JSON limits count UTF-8 bytes and accept exactly the limit', async () => {
  const body = '{"name":"ёж"}';
  const size = new TextEncoder().encode(body).length;
  assert.deepEqual(await api.readUpstreamJson(new Response(body), size), {
    name: 'ёж',
  });
  await assert.rejects(
    api.readUpstreamJson(new Response(body), size - 1),
    (e) => e.status === 502,
  );
  await assert.rejects(
    api.readUpstreamJson(new Response('private-provider-parser-diagnostic')),
    (e) =>
      e.code === 'MUSIC_UPSTREAM_RESPONSE' &&
      !e.message.includes('private-provider'),
  );
});
await test('declared oversized bodies cancel before reading and abort errors survive', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    api.readUpstreamJson(
      new Response(body, { headers: { 'content-length': '100' } }),
      10,
    ),
  );
  assert.equal(cancelled, true);
  const aborted = new ReadableStream({
    start(c) {
      c.error(new DOMException('Cancelled', 'AbortError'));
    },
  });
  await assert.rejects(
    api.readUpstreamJson(new Response(aborted)),
    (e) => e.name === 'AbortError',
  );
});
await test('all connected-provider requests share one concurrent account budget', async () => {
  const f = fixture();
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 61 }, () => api.musicProviderRequestLimit('alice')),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 60);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.status,
      429,
    );
    await api.musicProviderRequestLimit('bob');
    f.sqlite.exec('UPDATE auth_limits SET expiresAt=0');
    await api.musicProviderRequestLimit('alice');
  } finally {
    f.sqlite.close();
  }
});
await test('a user cannot spend the remaining shared budget by recycling drafts', async () => {
  const f = fixture();
  try {
    f.seed(
      'preview:r2:user-uploaded-bytes:alice',
      api.PREVIEW_USER_STORAGE_BYTES - 2,
    );
    const alice = f.bucket('alice');
    const outcomes = await Promise.allSettled([
      alice.put('a', new Uint8Array(2)),
      alice.put('b', new Uint8Array(2)),
    ]);
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
    await alice.delete('a');
    await assert.rejects(
      alice.put('recycled', new Uint8Array(1)),
      (e) => e.status === 429,
    );
    assert.equal(f.count('preview:r2:uploaded-bytes'), 2);
    assert.equal(
      f.count('preview:r2:user-uploaded-bytes:alice'),
      api.PREVIEW_USER_STORAGE_BYTES,
    );
    await f.bucket('bob').put('other-user', new Uint8Array(1));
    assert.equal(f.count('preview:r2:uploaded-bytes'), 3);
  } finally {
    f.sqlite.close();
  }
});
await test('user write allowance blocks before global budget and another user remains active', async () => {
  const f = fixture();
  try {
    const key =
      'preview:r2:user-write:alice:' + new Date().toISOString().slice(0, 7);
    f.seed(key, api.PREVIEW_USER_WRITES_PER_MONTH);
    await assert.rejects(
      f.bucket('alice').put('one', new Uint8Array(1)),
      (e) => e.status === 429,
    );
    assert.equal(f.count('preview:r2:uploaded-bytes'), 0);
    await f.bucket('bob').put('one', new Uint8Array(1));
    assert.equal(f.puts.length, 1);
  } finally {
    f.sqlite.close();
  }
});
await test('no anonymous uploads and resetting a user does not reset the global cap', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.bucket().put('missing-actor', new Uint8Array(1)),
      (e) => e.code === 'PREVIEW_ACTOR_REQUIRED',
    );
    f.seed('preview:r2:uploaded-bytes', api.PREVIEW_STORAGE_BYTES);
    f.seed(
      'preview:r2:user-uploaded-bytes:alice',
      api.PREVIEW_USER_STORAGE_BYTES,
    );
    f.sqlite
      .prepare('UPDATE auth_limits SET count=0 WHERE key=? AND count=?')
      .run(
        'preview:r2:user-uploaded-bytes:alice',
        api.PREVIEW_USER_STORAGE_BYTES,
      );
    await assert.rejects(
      f.bucket('alice').put('after-user-reset', new Uint8Array(1)),
      (e) => e.status === 429,
    );
    assert.equal(
      f.count('preview:r2:uploaded-bytes'),
      api.PREVIEW_STORAGE_BYTES,
    );
    assert.equal(f.puts.length, 0);
  } finally {
    f.sqlite.close();
  }
});
