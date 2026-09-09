import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';

await mkdir('work/tests', { recursive: true });
await build({
  stdin: {
    contents:
      "export * from './lib/access-auth'; export * from './lib/preview-storage';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: 'work/tests/shared-preview.mjs',
});
const {
  accessIdentity,
  accessConfiguration,
  previewBucket,
  PREVIEW_STORAGE_BYTES,
  PREVIEW_READS_PER_MONTH,
} = await import('../work/tests/shared-preview.mjs');
const pair = await generateKeyPair('RS256');
const key = await exportJWK(pair.publicKey);
const keys = createLocalJWKSet({
  keys: [{ ...key, kid: 'test', alg: 'RS256' }],
});
const settings = {
  NOCT_AUTH_MODE: 'access',
  NOCT_ACCESS_TEAM_DOMAIN: 'https://private-test.cloudflareaccess.com',
  NOCT_ACCESS_AUD: 'a'.repeat(64),
  NOCT_ACCESS_USERS: JSON.stringify({
    'alice@example.com': { userId: 'existing_alice' },
    'bob@example.com': { userId: 'new_bob' },
  }),
};
async function jwt(overrides = {}, privateKey = pair.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: 'alice@example.com',
    type: 'app',
    iss: settings.NOCT_ACCESS_TEAM_DOMAIN,
    aud: [settings.NOCT_ACCESS_AUD],
    sub: 'alice-identity',
    iat: now,
    exp: now + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .sign(privateKey);
}
async function resolve(token, config = settings) {
  return accessIdentity(
    new Headers({ 'cf-access-jwt-assertion': token }),
    config,
    keys,
  );
}
await test('verified emails retain separate existing profile IDs', async () => {
  assert.equal((await resolve(await jwt())).userId, 'existing_alice');
  assert.equal(
    (await resolve(await jwt({ email: 'BOB@example.com' }))).userId,
    'new_bob',
  );
});
await test('missing and forged headers cannot impersonate a local profile', async () => {
  assert.equal(
    await accessIdentity(
      new Headers({
        'oai-authenticated-user-id': 'existing_alice',
        'oai-authenticated-user-email': 'alice@example.com',
      }),
      settings,
      keys,
    ),
    null,
  );
  assert.equal(await resolve('garbage'), null);
  const attacker = await generateKeyPair('RS256');
  assert.equal(await resolve(await jwt({}, attacker.privateKey)), null);
});
await test('wrong issuer, audience, token kind, time, and unlisted email are denied', async () => {
  for (const value of [
    { iss: 'https://attacker.cloudflareaccess.com' },
    { aud: ['b'.repeat(64)] },
    { type: 'org' },
    { exp: 1 },
    { iat: Date.now() / 1000 + 600 },
    { nbf: Date.now() / 1000 + 600 },
    { email: 'outsider@example.com' },
    { sub: '' },
  ])
    assert.equal(await resolve(await jwt(value)), null);
});
await test('incomplete settings and ambiguous account mappings fail closed', async () => {
  for (const value of [
    { NOCT_AUTH_MODE: 'hybrid' },
    { NOCT_ACCESS_AUD: '' },
    { NOCT_ACCESS_TEAM_DOMAIN: 'http://localhost' },
    { NOCT_ACCESS_USERS: '{}' },
    {
      NOCT_ACCESS_USERS:
        '{"alice@example.com":{"userId":"same"},"bob@example.com":{"userId":"same"}}',
    },
  ])
    assert.equal(accessConfiguration({ ...settings, ...value }), null);
});
function storage() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    'CREATE TABLE auth_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expiresAt INTEGER NOT NULL)',
  );
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              return sqlite.prepare(sql).get(...args);
            },
          };
        },
      };
    },
  };
  const calls = [];
  const raw = {
    async get(...args) {
      calls.push(['get', ...args]);
      return { body: 'ok' };
    },
    async head(...args) {
      calls.push(['head', ...args]);
      return { size: 1 };
    },
    async put(...args) {
      calls.push(['put', ...args]);
      return { key: args[0] };
    },
    async delete(...args) {
      calls.push(['delete', ...args]);
    },
  };
  return { sqlite, calls, bucket: previewBucket(raw, db) };
}
await test('concurrent uploads cannot overrun the cumulative byte budget', async () => {
  const { sqlite, calls, bucket } = storage();
  sqlite
    .prepare('INSERT INTO auth_limits VALUES(?,?,?)')
    .run(
      'preview:r2:uploaded-bytes',
      PREVIEW_STORAGE_BYTES - 3,
      Number.MAX_SAFE_INTEGER,
    );
  const results = await Promise.allSettled([
    bucket.put('one', new Uint8Array(2)),
    bucket.put('two', new Uint8Array(2)),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(calls.length, 1);
  assert.equal(
    sqlite
      .prepare('SELECT count FROM auth_limits WHERE key=?')
      .get('preview:r2:uploaded-bytes').count,
    PREVIEW_STORAGE_BYTES - 1,
  );
  sqlite.close();
});
await test('read limit blocks the R2 operation and deleting never resets the upload budget', async () => {
  const { sqlite, calls, bucket } = storage();
  sqlite
    .prepare('INSERT INTO auth_limits VALUES(?,?,?)')
    .run(
      `preview:r2:read:${new Date().toISOString().slice(0, 7)}`,
      PREVIEW_READS_PER_MONTH,
      Number.MAX_SAFE_INTEGER,
    );
  await assert.rejects(
    bucket.get('existing'),
    (e) => e.code === 'PREVIEW_STORAGE_LIMIT',
  );
  assert.equal(calls.length, 0);
  await bucket.put('one', new Uint8Array(3));
  await bucket.delete('one');
  assert.equal(
    sqlite
      .prepare('SELECT count FROM auth_limits WHERE key=?')
      .get('preview:r2:uploaded-bytes').count,
    3,
  );
  await assert.rejects(bucket.put('stream', new ReadableStream()), /размером/);
  assert.throws(() => bucket.createMultipartUpload, /not enabled/);
  sqlite.close();
});
