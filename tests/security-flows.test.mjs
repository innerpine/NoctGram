/**
 * Isolated call/TURN regressions against CURRENT project TypeScript and real migrations.
 * Run: node --test tests/calls.test.mjs
 * Run from the project directory, or copy this file into the project's tests directory.
 * No .env, network, Worker,
 * browser, disk database, or production secrets are used. All credentials below are fixtures.
 * D1 is modeled by SQLite :memory: with atomic SQL/batches and controllable interleavings.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto, randomUUID } from 'node:crypto';
import test from 'node:test';
import { compileFunction } from 'node:vm';

const root = [
  process.cwd(),
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
].find((p) => existsSync(join(p, 'lib/turn.ts')));
assert.ok(
  root,
  'Run from the project directory or place this file in its tests directory.',
);
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const cached = new Map();
const source = (name) => {
  if (!cached.has(name))
    cached.set(name, readFileSync(join(root, name), 'utf8'));
  return cached.get(name);
};
const journal = JSON.parse(source('drizzle/meta/_journal.json')).entries;
assert.ok(
  journal.some((e) => e.tag.startsWith('0015_')),
  'The journal must include the call negotiation migration.',
);
const migrations = journal.map((e) => [
  e.tag,
  source('drizzle/' + e.tag + '.sql'),
]);
const NOW = Date.UTC(2026, 8, 8, 12, 0, 0, 875);
const CALLER_DEVICE = 'caller_device_fixture_001';
const CALLEE_DEVICE = 'callee_device_fixture_001';
const API_TOKEN = 'fixture-provider-token-never-a-real-secret';
const SETTINGS = {
  NOCT_TURN_PROVIDER: 'cloudflare',
  NOCT_CF_TURN_KEY_ID: 'fixture_key_12345',
  NOCT_CF_TURN_API_TOKEN: API_TOKEN,
};
const sdp = (ufrag, suffix = '') =>
  [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=fixture',
    't=0 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=mid:0',
    'a=ice-ufrag:' + ufrag,
    'a=ice-pwd:fixture-password-only',
    'a=sendrecv' + suffix,
  ].join('\r\n');
const relayPayload = () => ({
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:untrusted.invalid:3478'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
        'turn:evil.invalid:3478?transport=udp',
      ],
      username: 'fixture-temporary-user',
      credential: 'fixture-temporary-password',
    },
  ],
});
function declaration(file, name) {
  const text = source(file),
    ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
  );
  assert.ok(node, file + ' must contain ' + name);
  return node.getText(ast);
}

function fixture(t) {
  const clock = { now: NOW };
  class Clock extends Date {
    static now() {
      return clock.now;
    }
  }
  const sql = new DatabaseSync(':memory:');
  sql.function('strftime', (format, value) => {
    assert.equal(format, '%s');
    assert.equal(value, 'now');
    return String(Math.floor(clock.now / 1000));
  });
  for (const [tag, migration] of migrations) {
    try {
      sql.exec(migration);
    } catch (e) {
      throw new Error('Migration failed: ' + tag, { cause: e });
    }
  }
  sql.exec('PRAGMA foreign_keys=ON');
  for (const id of ['alice', 'bob', 'outsider']) {
    sql
      .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
      .run(id, id, NOW - 1000);
    sql
      .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
      .run(id, id);
  }
  // These spending regressions retain a synthetic starter wallet. Commerce
  // tests separately verify that real environments default to zero credit.
  const config = { NOCT_STARS_TEST_MODE: '1' };
  const network = { calls: [], respond: null };
  const hooks = { beforeOperation: null };
  const adapter = {
    prepare(text) {
      const stmt = (args) => ({
        text,
        args,
        bind(...values) {
          return stmt(values);
        },
        async first(column) {
          await Promise.resolve();
          hooks.beforeOperation?.('first', text, args);
          const row = sql.prepare(text).get(...args) || null;
          return column ? (row?.[column] ?? null) : row;
        },
        async all() {
          await Promise.resolve();
          hooks.beforeOperation?.('all', text, args);
          return { success: true, results: sql.prepare(text).all(...args) };
        },
        async run() {
          await Promise.resolve();
          hooks.beforeOperation?.('run', text, args);
          const r = sql.prepare(text).run(...args);
          return {
            success: true,
            meta: {
              changes: Number(r.changes),
              last_row_id: Number(r.lastInsertRowid),
            },
          };
        },
      });
      return stmt([]);
    },
    async batch(statements) {
      await Promise.resolve();
      sql.exec('BEGIN IMMEDIATE');
      try {
        const rows = statements.map((s) => {
          const r = sql.prepare(s.text).run(...s.args);
          return { success: true, meta: { changes: Number(r.changes) } };
        });
        sql.exec('COMMIT');
        return rows;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const fakeFetch = async (...args) => {
    network.calls.push(args);
    assert.ok(
      network.respond,
      'Real network is forbidden: configure the fixture fetch response.',
    );
    return network.respond(...args);
  };
  const modules = new Map();
  const allowed = new Set([
    'lib/gifts.ts',
    'lib/gift-collectibles.ts',
    'lib/gift-upgrades.ts',
    'lib/gift-upgrade-catalog.ts',
    'lib/gift-upgrade-data.json',
    'lib/gift-upgrade-eligibility.json',
    'lib/star-wallet.ts',
    'lib/gift-catalog.ts',
    'lib/notifications.ts',
    'lib/request-body.ts',
    'app/api/gifts/route.ts',
    'lib/calls.ts',
    'lib/turn.ts',
    'lib/account-access.ts',
    'lib/privacy.ts',
    'lib/chat-files.ts',
    'lib/chat-access.ts',
    'lib/premium-access.ts',
    'lib/presence-privacy.ts',
    'lib/premium-predicate.ts',
    'lib/premium-emoji.ts',
    'lib/premium-emoji-access.ts',
    'lib/boost-access.ts',
    'lib/boost-rules.ts',
    'lib/channel-access.ts',
    'lib/rate-limit.ts',
    'lib/api-error.ts',
  ]);
  function evaluate(file, text) {
    const loadedModule = { exports: {} };
    modules.set(file, loadedModule);
    const output = ts.transpileModule(text, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: file,
    }).outputText;
    const scopedRequire = (specifier) => {
      if (specifier === 'next/headers')
        return {
          cookies: async () => ({ get: () => undefined, set: () => {} }),
        };
      if (specifier === '@block65/webcrypto-web-push')
        return {
          buildPushPayload: async () => ({
            method: 'POST',
            body: 'fixture-only',
          }),
        };
      const target = specifier.startsWith('@/')
        ? resolve(root, specifier.slice(2))
        : specifier.startsWith('.')
          ? resolve(root, dirname(file), specifier)
          : null;
      assert.ok(target, 'Unexpected external dependency: ' + specifier);
      const relative = target
        .slice(resolve(root).length + 1)
        .replaceAll('\\', '/');
      return load(extname(relative) ? relative : relative + '.ts');
    };
    compileFunction(output, [
      'require',
      'exports',
      'module',
      'Date',
      'crypto',
      'fetch',
    ])(
      scopedRequire,
      loadedModule.exports,
      loadedModule,
      Clock,
      webcrypto,
      fakeFetch,
    );
    return loadedModule.exports;
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    if (file === 'lib/storage.ts') return { db: () => adapter };
    if (file === 'lib/server.ts') {
      const api = load('lib/api-error.ts');
      const result = evaluate(
        file,
        `import { ApiError } from './api-error';\n${declaration(file, 'clean')}`,
      );
      return Object.assign(result, {
        db: () => adapter,
        ApiError: api.ApiError,
        failure: api.failure,
        viewer: async () => 'alice',
      });
    }
    if (file === 'lib/auth-session.ts') {
      const result = evaluate(file, declaration(file, 'tokenHash'));
      return Object.assign(result, { setting: (name) => config[name] || '' });
    }
    if (file === 'lib/social-features.ts')
      return evaluate(
        file,
        "import { db, clean, ApiError } from './server'; import { ensureWallet, balance } from './star-wallet'; import { visibleAccount } from './account-access'; import { published, sqlNow } from './channel-access';" +
          declaration(file, 'featurePost'),
      );
    assert.ok(allowed.has(file), 'Unexpected dependency: ' + file);
    if (file.endsWith('.json')) return { default: JSON.parse(source(file)) };
    return evaluate(file, source(file));
  }
  const calls = load('lib/calls.ts'),
    turn = load('lib/turn.ts'),
    { ApiError } = load('lib/api-error.ts');
  const ctx = {
    sql,
    clock,
    config,
    network,
    hooks,
    calls,
    turn,
    ApiError,
    load,
    row(id = 'call_fixture') {
      const row = sql.prepare('SELECT * FROM calls WHERE id=?').get(id);
      return row ? { ...row } : null;
    },
    async post(action, body = {}, actor = 'alice') {
      return calls.callsPost(
        action,
        {
          id: 'call_fixture',
          device: actor === 'bob' ? CALLEE_DEVICE : CALLER_DEVICE,
          ...body,
        },
        actor,
      );
    },
    async signal(type, body = {}, actor = 'alice') {
      return ctx.post('callSignal', { type, negotiation: 1, ...body }, actor);
    },
    async get(action, params = {}, actor = 'alice') {
      return calls.callsGet(
        action,
        new URLSearchParams({
          id: 'call_fixture',
          device: actor === 'bob' ? CALLEE_DEVICE : CALLER_DEVICE,
          ...params,
        }),
        actor,
      );
    },
    async accepted() {
      await ctx.post('callStart', { peer: 'bob' });
      await ctx.post('callAccept', {}, 'bob');
    },
    async negotiated() {
      await ctx.accepted();
      await ctx.signal('offer', { sdp: sdp('offer1') });
      await ctx.signal('answer', { sdp: sdp('answer1') }, 'bob');
    },
    restrict(id, mode = 'read_only') {
      const event = randomUUID();
      sql
        .prepare(
          'INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,?,?,?,?)',
        )
        .run(event, id, 'outsider', mode, 'fixture restriction', clock.now);
      sql
        .prepare(
          'INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,?,?,?)',
        )
        .run(id, event, mode, 'fixture restriction', clock.now);
    },
    managed() {
      Object.assign(config, SETTINGS);
      network.respond = async () => Response.json(relayPayload());
    },
  };
  t.after(() => {
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    sql.close();
  });
  return ctx;
}
const options = { concurrency: false, timeout: 10000 };
function scenario(name, run) {
  void test(name, options, (t) => run(fixture(t), t));
}
const rejectStatus = (fn, status) =>
  assert.rejects(fn, (e) => {
    assert.equal(e.status, status, e.message);
    return true;
  });

scenario(
  'gifts cannot bypass exhausted message and mutation limits',
  async (f) => {
    const rates = f.load('lib/rate-limit.ts');
    for (let i = 0; i < 30; i++)
      await rates.socialRateLimit('alice', 'message');
    await rejectStatus(() => rates.socialRateLimit('alice', 'message'), 429);
    for (let i = 0; i < 149; i++)
      await rates.socialRateLimit('alice', 'unclassified');
    await rejectStatus(
      () => rates.socialRateLimit('alice', 'unclassified'),
      429,
    );
    const route = f.load('app/api/gifts/route.ts');
    for (let i = 0; i < 2; i++) {
      const response = await route.POST(
        new Request('https://noctgram.fixture.invalid/api/gifts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://noctgram.fixture.invalid',
          },
          body: JSON.stringify({
            action: 'send',
            recipient: 'bob',
            giftId: 'toy_bear',
            key: 'security-gift-' + String(i).padStart(8, '0'),
            message: 'fixture spam',
          }),
        }),
      );
      assert.equal(response.status, 429, JSON.stringify(await response.json()));
    }
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM messages WHERE sender='alice' AND recipient='bob'",
        )
        .get().n,
      0,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM notifications WHERE actorId='alice' AND userId='bob'",
        )
        .get().n,
      0,
    );
  },
);

scenario('malformed call requests never run call maintenance', async (f) => {
  let writes = 0;
  const statements = [];
  f.hooks.beforeOperation = (method, text, args) => {
    if (
      method === 'run' &&
      /^(DELETE FROM call_|UPDATE calls SET status)/.test(text)
    ) {
      writes++;
      if (statements.length < 3) statements.push({ text, args });
    }
  };
  for (let i = 0; i < 100; i++)
    await rejectStatus(() => f.get('callConfig', { device: 'bad' }), 400);
  assert.equal(writes, 0);
  assert.equal(
    f.sql.prepare('SELECT COUNT(*) AS n FROM auth_limits').get().n,
    0,
  );
  assert.equal(statements.length, 0);
});

scenario(
  'support rejects concurrent moderation and recipient block at debit',
  async (f) => {
    f.sql
      .prepare(
        "INSERT INTO posts(id,userId,text,created) VALUES('post_fixture','bob','visible post',?)",
      )
      .run(NOW - 1000);
    const account = f.load('lib/account-access.ts');
    const feature = f.load('lib/social-features.ts');
    await account.assertWritable('alice');
    await account.assertPostVisible('post_fixture', 'alice');
    let triggered = false;
    f.hooks.beforeOperation = (method, text) => {
      if (
        !triggered &&
        method === 'run' &&
        text.startsWith('INSERT INTO star_transfers(id,sender,recipient,postId')
      ) {
        triggered = true;
        f.restrict('alice', 'blocked');
        f.sql
          .prepare(
            "INSERT INTO user_blocks(blocker,blocked,created) VALUES('bob','alice',?)",
          )
          .run(NOW);
      }
    };
    await rejectStatus(
      () =>
        feature.featurePost(
          'support',
          { id: 'post_fixture', key: 'security-support-race', amount: 100 },
          'alice',
        ),
      409,
    );
    assert.ok(triggered);
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM star_transfers WHERE sender='alice' AND kind='support'",
        )
        .get().n,
      0,
    );
    await rejectStatus(() => account.assertWritable('alice'), 403);
    await rejectStatus(
      () => account.assertPostVisible('post_fixture', 'alice'),
      403,
    );
  },
);

scenario(
  'gifts still reject recipient block atomically at debit',
  async (f) => {
    const gifts = f.load('lib/gifts.ts');
    let blocked = false;
    f.hooks.beforeOperation = (method, text) => {
      if (!blocked && method === 'run' && text.includes('VALUES(?,?,10000')) {
        blocked = true;
        f.sql
          .prepare(
            "INSERT INTO user_blocks(blocker,blocked,created) VALUES('bob','alice',?)",
          )
          .run(NOW);
      }
    };
    await rejectStatus(
      () =>
        gifts.sendGift('alice', {
          recipient: 'bob',
          giftId: 'toy_bear',
          key: 'control-gift-000001',
        }),
      403,
    );
    assert.equal(
      f.sql
        .prepare("SELECT COUNT(*) AS n FROM star_transfers WHERE kind='gift'")
        .get().n,
      0,
    );
  },
);

scenario(
  'gifts honor the message limit while the mutation budget remains available',
  async (f) => {
    const rates = f.load('lib/rate-limit.ts');
    for (let i = 0; i < 30; i++)
      await rates.socialRateLimit('alice', 'message');
    const before = f.sql
      .prepare(
        "SELECT count FROM auth_limits WHERE key LIKE 'action:mutations:%'",
      )
      .get().count;
    assert.equal(before, 30);
    const route = f.load('app/api/gifts/route.ts');
    const response = await route.POST(
      new Request('https://noctgram.fixture.invalid/api/gifts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://noctgram.fixture.invalid',
        },
        body: JSON.stringify({
          action: 'send',
          recipient: 'bob',
          giftId: 'toy_bear',
          key: 'only-message-limit-0001',
        }),
      }),
    );
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, 'RATE_LIMIT');
    assert.equal(
      f.sql
        .prepare(
          "SELECT count FROM auth_limits WHERE key LIKE 'action:mutations:%'",
        )
        .get().count,
      31,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT count FROM auth_limits WHERE key LIKE 'action:message:%'",
        )
        .get().count,
      30,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM auth_limits WHERE key LIKE 'action:gift-recipient:%'",
        )
        .get().n,
      0,
    );
    for (const table of [
      'received_gifts',
      'messages',
      'notifications',
      'star_transfers',
    ])
      assert.equal(
        f.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
        0,
        table,
      );
  },
);

scenario(
  'five gifts per recipient are allowed, a committed retry succeeds and another recipient is independent',
  async (f) => {
    const route = f.load('app/api/gifts/route.ts');
    const body = (number, recipient = 'bob') => ({
      action: 'send',
      recipient,
      giftId: 'toy_bear',
      key: 'recipient-budget-' + String(number).padStart(8, '0'),
      message: 'fixture gift',
    });
    const send = (value) =>
      route.POST(
        new Request('https://noctgram.fixture.invalid/api/gifts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://noctgram.fixture.invalid',
          },
          body: JSON.stringify(value),
        }),
      );
    const receipts = [];
    for (let i = 0; i < 5; i++) {
      const response = await send(body(i));
      assert.equal(response.status, 200);
      receipts.push(await response.json());
    }
    assert.equal(receipts[4].balance, 10000 - 5 * 75);
    const denied = await send(body(5));
    assert.equal(denied.status, 429);
    assert.equal((await denied.json()).code, 'RATE_LIMIT');
    const counts = () =>
      f.sql
        .prepare(
          "SELECT key,count FROM auth_limits WHERE key NOT LIKE 'action:gift-requests:%' ORDER BY key",
        )
        .all();
    const limitsBeforeRetry = counts();
    const retried = await send(body(0));
    assert.equal(retried.status, 200);
    const retry = await retried.json();
    assert.equal(retry.id, receipts[0].id);
    assert.equal(retry.balance, receipts[4].balance);
    assert.deepEqual(
      counts(),
      limitsBeforeRetry,
      'retry consumes no message, mutation, gift or recipient creation allowance',
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM star_transfers WHERE sender='alice' AND kind='gift'",
        )
        .get().n,
      5,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM received_gifts WHERE sender='alice' AND recipient='bob'",
        )
        .get().n,
      5,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM messages WHERE sender='alice' AND recipient='bob'",
        )
        .get().n,
      5,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM notifications WHERE actorId='alice' AND userId='bob' AND kind='gift'",
        )
        .get().n,
      5,
    );
    const other = await send(body(6, 'outsider'));
    assert.equal(other.status, 200);
    assert.equal((await other.json()).balance, 10000 - 6 * 75);
  },
);

scenario(
  'support atomically credits the current recipient once across concurrent requests and retries',
  async (f) => {
    f.sql
      .prepare(
        "INSERT INTO posts(id,userId,text,created) VALUES('supported-post','bob','support snapshot fixture',?)",
      )
      .run(NOW - 1000);
    const wallet = f.load('lib/star-wallet.ts');
    const feature = f.load('lib/social-features.ts');
    const account = f.load('lib/account-access.ts');
    await wallet.ensureWallet('alice');
    await wallet.ensureWallet('bob');
    await account.assertWritable('alice');
    await account.assertPostVisible('supported-post', 'alice');
    const body = {
      id: 'supported-post',
      key: 'support-success-0001',
      amount: 125,
    };
    const responses = await Promise.all([
      feature.featurePost('support', body, 'alice'),
      feature.featurePost('support', body, 'alice'),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).balance, 9875);
    }
    const row = f.sql
      .prepare(
        "SELECT id,sender,recipient,postId,postText,amount,kind FROM star_transfers WHERE sender='alice' AND kind='support'",
      )
      .all();
    assert.equal(row.length, 1);
    assert.deepEqual(
      { ...row[0] },
      {
        id: 'support:alice:support-success-0001',
        sender: 'alice',
        recipient: 'bob',
        postId: 'supported-post',
        postText: 'support snapshot fixture',
        amount: 125,
        kind: 'support',
      },
    );
    assert.equal(await wallet.balance('alice'), 9875);
    assert.equal(await wallet.balance('bob'), 10125);
    const repeated = await feature.featurePost('support', body, 'alice');
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).balance, 9875);
    await rejectStatus(
      () => feature.featurePost('support', { ...body, amount: 126 }, 'alice'),
      409,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM star_transfers WHERE sender='alice' AND kind='support'",
        )
        .get().n,
      1,
    );
    assert.equal(await wallet.balance('bob'), 10125);
  },
);

for (const role of ['caller', 'callee']) {
  scenario(
    `starting a call clears the peer's stale ${role} call and leaves unrelated history untouched`,
    async (f) => {
      for (const id of ['carol', 'dave'])
        f.sql
          .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
          .run(id, id, NOW - 1000);
      const insert = f.sql.prepare(
        "INSERT INTO calls(id,caller,callee,callerDevice,created,callerSeen,calleeSeen,expiresAt) VALUES(?,?,?,'fixture-device',?,?,?,?)",
      );
      insert.run(
        'peer-stale',
        role === 'caller' ? 'bob' : 'outsider',
        role === 'caller' ? 'outsider' : 'bob',
        NOW - 100000,
        NOW - 100000,
        NOW - 100000,
        NOW - 1,
      );
      insert.run(
        'unrelated-stale',
        'carol',
        'dave',
        NOW - 100000,
        NOW - 100000,
        NOW - 100000,
        NOW - 1,
      );
      const unrelated = f.row('unrelated-stale');
      const response = await f.post('callStart', {
        id: 'fresh-scoped-call',
        peer: 'bob',
      });
      assert.equal(response.status, 200);
      assert.equal(f.row('peer-stale').status, 'ended');
      assert.equal(f.row('peer-stale').reason, 'missed');
      assert.equal(f.row('fresh-scoped-call').status, 'ringing');
      assert.deepEqual(f.row('unrelated-stale'), unrelated);
      assert.equal(
        f.sql
          .prepare(
            "SELECT COUNT(*) AS n FROM notifications WHERE targetId='fresh-scoped-call' AND userId='bob' AND kind='call'",
          )
          .get().n,
        1,
      );
    },
  );
}
