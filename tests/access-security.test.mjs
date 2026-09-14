import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const { tag } of JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
).entries)
  sql.exec(await readFile('drizzle/' + tag + '.sql', 'utf8'));
let beforeBatch,
  failRules = false,
  calls = 0;
const d = {
  prepare(query) {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      async first() {
        return sql.prepare(query).get(...args) || null;
      },
      async all() {
        return { results: sql.prepare(query).all(...args) };
      },
      async run() {
        if (
          failRules &&
          query.includes('INSERT OR IGNORE INTO access_block_rules')
        )
          throw Error('injected');
        return { meta: { changes: sql.prepare(query).run(...args).changes } };
      },
    };
  },
  async batch(statements) {
    const hook = beforeBatch;
    beforeBatch = undefined;
    hook?.();
    sql.exec('BEGIN');
    try {
      const rows = [];
      for (const statement of statements) rows.push(await statement.run());
      sql.exec('COMMIT');
      return rows;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
globalThis.__accessDb = d;
globalThis.__accessApp = async (req) => {
  calls++;
  return Response.json({ body: await req.text() });
};
const compiled = await build({
  stdin: {
    contents:
      "export * from './lib/access-security';export * from './lib/admin-access';export {default as worker} from './worker/public';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'access-fixture',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(\.\/(storage|server|auth-session)|vinext\/server\/fetch-handler)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          resolveDir: process.cwd(),
          contents: path.startsWith('vinext')
            ? 'export default {fetch:(req)=>globalThis.__accessApp(req)};'
            : path.endsWith('auth-session')
              ? 'export {accessHash as tokenHash} from "./lib/access-security";export const setting=()=>"0";'
              : 'export const db=()=>globalThis.__accessDb;export {ApiError} from "./lib/api-error";export const clean=v=>v;',
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const env = {
  DB: d,
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  NOCT_DEPLOYMENT_TARGET: 'standalone',
  NOCT_AUTH_MODE: 'email',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test',
};
let serial = 0;
async function person(admin = false) {
  const id = 'access-user-' + ++serial,
    token = String(serial).padStart(64, '0');
  sql
    .prepare(
      'INSERT INTO users(id,name,created,onboardingComplete) VALUES(?,?,?,1)',
    )
    .run(id, id, Date.now());
  sql
    .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
    .run(id, id);
  sql
    .prepare(
      'INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt) VALUES(?,?,?,?)',
    )
    .run(await api.accessHash(token), id, Date.now(), Date.now() + 86400000);
  if (admin)
    sql
      .prepare('INSERT INTO administrators(userId,created) VALUES(?,?)')
      .run(id, Date.now());
  return { id, token };
}
const admin = await person(true);
function req(user, device, ip = '192.0.2.10', path = '/api/social') {
  return new Request('https://noctgram.com' + path, {
    headers: {
      cookie: [
        user ? 'noct_session=' + user.token : '',
        device ? api.DEVICE_COOKIE + '=' + device : '',
      ]
        .filter(Boolean)
        .join('; '),
      ...(ip ? { 'cf-connecting-ip': ip } : {}),
      'user-agent': 'Mozilla/5.0 (Windows) Chrome/140',
    },
  });
}
async function seen(user, device, ip) {
  await api.checkAccessRequest(d, req(user, device, ip));
}
function observations(user, kind) {
  return sql
    .prepare('SELECT * FROM access_observations WHERE userId=? AND kind=?')
    .all(user.id, kind);
}
function input(user, ids) {
  return {
    target: user.id,
    observations: ids,
    reason: 'Повторный спам',
    requestId: crypto.randomUUID(),
  };
}
const blocked = (e) => e.status === 403 && e.code === 'ACCESS_BLOCKED';

await test('IP normalization uses only edge addresses, and cookie tokens are private and persistent', async () => {
  assert.equal(api.normalizeClientIp('192.000.002.010'), '192.0.2.10');
  assert.equal(api.normalizeClientIp('::ffff:192.0.2.10'), '192.0.2.10');
  assert.equal(
    api.normalizeClientIp('2001:0db8:0000:0:0:0:0:1'),
    '2001:db8::1',
  );
  for (const ip of [
    'unknown',
    '999.1.1.1',
    '192.0.2.10,1.1.1.1',
    '192.0.2.10:80',
    'fe80::1%eth0',
  ])
    assert.equal(api.normalizeClientIp(ip), '');
  assert.equal(
    api.accessIp(
      new Headers({
        'x-forwarded-for': '192.0.2.10',
        'x-real-ip': '192.0.2.10',
      }),
    ),
    '',
  );
  const first = api.prepareAccessRequest(req(admin, 'invalid'));
  assert.match(
    first.setCookie,
    /HttpOnly; Secure; SameSite=Lax; Max-Age=31536000/,
  );
  assert.match(
    api.accessCookie(first.request.headers, api.DEVICE_COOKIE),
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    api.accessCookie(first.request.headers, 'noct_session'),
    admin.token,
  );
  assert.equal(api.prepareAccessRequest(first.request).setCookie, '');
});

await test('only a verified session records observations, and only administrators can inspect them', async () => {
  const user = await person(),
    device = 'a'.repeat(64);
  await seen(user, device);
  assert.equal(observations(user, 'ip').length, 1);
  assert.equal(observations(user, 'device').length, 1);
  const result = await api.readAdminAccess(
    admin.id,
    new URLSearchParams({ target: user.id }),
  );
  assert.equal(result.observations.length, 2);
  assert.equal(JSON.stringify(result).includes(device), false);
  assert.equal(
    JSON.stringify(result.observations).includes('valueHash'),
    false,
  );
  await assert.rejects(
    api.readAdminAccess(user.id, new URLSearchParams()),
    (e) => e.status === 403,
  );
  const old = sql.prepare('SELECT COUNT(*) n FROM access_observations').get().n;
  const forged = req(null, 'b'.repeat(64));
  forged.headers.set('oai-authenticated-user-id', user.id);
  forged.headers.set('cookie', 'noct_session=' + 'f'.repeat(64));
  await api.checkAccessRequest(d, forged);
  assert.equal(
    sql.prepare('SELECT COUNT(*) n FROM access_observations').get().n,
    old,
  );
  await seen(user, device);
  assert.equal(observations(user, 'device').length, 1);
});

await test('device bans stop other accounts, signup and active APIs across IP changes, but not unrelated browsers', async () => {
  const user = await person(),
    alt = await person(),
    device = 'c'.repeat(64);
  await seen(user, device, '192.0.2.20');
  const body = input(user, [observations(user, 'device')[0].id]);
  await api.blockAdminAccess(admin.id, body);
  const before = calls;
  for (const path of [
    '/api/social',
    '/%61pi/social',
    '/api%2Frooms',
    '//api/social',
    '/API/social',
    '/api/rooms',
    '/api/music',
    '/api/upload',
    '/api/auth/session',
    '/api/auth/start',
    '/api/auth/verify',
  ]) {
    const response = await api.worker.fetch(
      req(path.includes('/auth/') ? null : alt, device, '198.51.100.2', path),
      env,
      {},
    );
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).code, 'ACCESS_BLOCKED');
  }
  assert.equal(
    calls,
    before,
    'Blocked requests never reach application handlers',
  );
  await assert.rejects(
    api.checkAccessRequest(d, req(user, 'd'.repeat(64), '203.0.113.1')),
    blocked,
  );
  await api.checkAccessRequest(d, req(alt, 'd'.repeat(64), '192.0.2.20'));
  assert.equal(
    (
      await api.worker.fetch(
        req(user, device, '192.0.2.20', '/api/auth/logout'),
        env,
        {},
      )
    ).status,
    200,
  );
  await api.blockAdminAccess(admin.id, body);
  assert.equal(
    sql
      .prepare('SELECT COUNT(*) n FROM access_blocks WHERE targetId=?')
      .get(user.id).n,
    1,
  );
  await assert.rejects(
    api.blockAdminAccess(admin.id, { ...body, reason: 'changed' }),
    (e) => e.status === 409,
  );
  const block = sql
    .prepare('SELECT id FROM access_blocks WHERE targetId=?')
    .get(user.id);
  await api.revokeAdminAccess(admin.id, { id: block.id });
  await api.checkAccessRequest(d, req(user, device, '198.51.100.2'));
  await api.blockAdminAccess(admin.id, body);
  await api.checkAccessRequest(d, req(user, device, '198.51.100.2'));
});

await test('IP bans stop fresh browsers; a newly issued session is checked before delivery', async () => {
  const user = await person(),
    other = await person();
  await seen(user, 'e'.repeat(64), '203.0.113.55');
  await seen(other, 'f'.repeat(64), '203.0.113.55');
  const result = await api.readAdminAccess(
    admin.id,
    new URLSearchParams({ target: user.id }),
  );
  assert.equal(result.observations.find((o) => o.kind === 'ip').accounts, 2);
  await api.blockAdminAccess(
    admin.id,
    input(user, [observations(user, 'ip')[0].id]),
  );
  assert.equal(
    (
      await api.worker.fetch(
        req(null, null, '203.0.113.55', '/api/auth/start'),
        env,
        {},
      )
    ).status,
    403,
  );
  await api.checkAccessRequest(d, req(other, '1'.repeat(64), '203.0.113.56'));
  const normal = globalThis.__accessApp;
  globalThis.__accessApp = async () =>
    Response.json(
      { ok: true },
      {
        headers: {
          'Set-Cookie':
            'noct_session=' + user.token + '; Path=/; HttpOnly; Secure',
        },
      },
    );
  try {
    const response = await api.worker.fetch(
      req(null, '2'.repeat(64), '203.0.113.56', '/api/auth/verify'),
      env,
      {},
    );
    assert.equal(response.status, 403);
    assert.equal(
      response.headers
        .getSetCookie()
        .some((c) => c.startsWith('noct_session=')),
      false,
    );
  } finally {
    globalThis.__accessApp = normal;
  }
});

await test('non-admins, staff targets, shared staff identifiers and foreign observation IDs cannot create bans', async () => {
  const user = await person(),
    other = await person();
  await seen(user, '3'.repeat(64), '198.51.100.40');
  await seen(admin, '4'.repeat(64), '198.51.100.40');
  const ip = input(user, [observations(user, 'ip')[0].id]);
  await assert.rejects(
    api.blockAdminAccess(user.id, ip),
    (e) => e.status === 403,
  );
  await assert.rejects(
    api.blockAdminAccess(admin.id, ip),
    (e) => e.status === 409,
  );
  await assert.rejects(
    api.blockAdminAccess(
      admin.id,
      input(admin, [observations(admin, 'device')[0].id]),
    ),
    (e) => e.status === 403,
  );
  await assert.rejects(
    api.blockAdminAccess(admin.id, {
      ...input(other, [observations(user, 'device')[0].id]),
    }),
    (e) => e.status === 409,
  );
  const device = observations(user, 'device')[0].id;
  beforeBatch = () =>
    sql.prepare('DELETE FROM administrators WHERE userId=?').run(admin.id);
  await assert.rejects(
    api.blockAdminAccess(admin.id, input(user, [device])),
    (e) => e.status === 409,
  );
  sql
    .prepare('INSERT INTO administrators(userId,created) VALUES(?,?)')
    .run(admin.id, Date.now());
  assert.equal(
    sql
      .prepare('SELECT COUNT(*) n FROM access_blocks WHERE targetId=?')
      .get(user.id).n,
    0,
  );
  failRules = true;
  try {
    await assert.rejects(
      api.blockAdminAccess(admin.id, input(user, [device])),
      /injected/,
    );
  } finally {
    failRules = false;
  }
  assert.equal(
    sql
      .prepare('SELECT COUNT(*) n FROM access_blocks WHERE targetId=?')
      .get(user.id).n,
    0,
  );
});

await test('cleanup removes old observations without expiring a permanent rule; admins retain recovery access', async () => {
  const user = await person(),
    device = '5'.repeat(64);
  await seen(user, device, '198.51.100.50');
  await api.blockAdminAccess(
    admin.id,
    input(user, [observations(user, 'device')[0].id]),
  );
  sql
    .prepare('UPDATE access_observations SET lastSeen=1 WHERE userId=?')
    .run(user.id);
  await api.cleanAccessHistory(d);
  assert.equal(observations(user, 'device').length, 0);
  await assert.rejects(api.checkAccessRequest(d, req(null, device)), blocked);
  await api.checkAccessRequest(d, req(admin, device));
  const plan = sql
    .prepare(
      "EXPLAIN QUERY PLAN SELECT b.id FROM access_block_rules r JOIN access_blocks b ON b.id=r.blockId WHERE r.kind='device' AND r.valueHash=? AND b.revokedAt=0",
    )
    .all('hash');
  assert.match(JSON.stringify(plan), /access_rule_lookup/);
});
