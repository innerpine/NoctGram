// Isolated SQLite and mocked push/after boundaries; no .env, Worker or real network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { compileFunction } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';

const root = resolve(process.cwd());
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const source = (path) =>
  readFileSync(
    join(
      process.env.NOCT_PUSH_PROPOSAL_ROOT &&
        ['lib/notifications.ts', 'app/api/social/route.ts'].includes(path)
        ? process.env.NOCT_PUSH_PROPOSAL_ROOT
        : root,
      path,
    ),
    'utf8',
  );
const declaration = (path, name) => {
  const ast = ts.createSourceFile(
    path,
    source(path),
    ts.ScriptTarget.Latest,
    true,
  );
  const node = ast.statements.find(
    (statement) =>
      (ts.isFunctionDeclaration(statement) && statement.name?.text === name) ||
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (entry) => entry.name.getText(ast) === name,
        )),
  );
  assert.ok(node, `${path} must declare ${name}`);
  return node.getText(ast);
};
const evaluate = (text, dependencies = {}, globals = {}) => {
  const output = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  compileFunction(output, [
    'require',
    'exports',
    'module',
    ...Object.keys(globals),
  ])(
    (specifier) => {
      assert.ok(
        specifier in dependencies,
        `Unexpected dependency: ${specifier}`,
      );
      return dependencies[specifier];
    },
    loadedModule.exports,
    loadedModule,
    ...Object.values(globals),
  );
  return loadedModule.exports;
};
const NOW = Date.UTC(2026, 8, 9, 12);
const { ApiError, failure } = evaluate(source('lib/api-error.ts'));
const { clean } = evaluate(
  `import { ApiError } from './api-error';\n${declaration('lib/server.ts', 'clean')}`,
  { './api-error': { ApiError } },
);
const { visibleAccount } = evaluate(
  declaration('lib/account-access.ts', 'visibleAccount'),
);
const channel = evaluate(
  [
    declaration('lib/channel-access.ts', 'sqlNow'),
    declaration('lib/channel-access.ts', 'published'),
  ].join('\n'),
);
const chat = evaluate(source('lib/chat-access.ts'));
const { callAllowed } = evaluate(
  `import { visibleAccount, sqlNow, messageAllowed } from 'rules';\n${declaration('lib/calls.ts', 'callAllowed')}`,
  {
    rules: {
      visibleAccount,
      ...channel,
      ...evaluate(declaration('lib/privacy.ts', 'messageAllowed')),
    },
  },
);
const migrations = JSON.parse(source('drizzle/meta/_journal.json')).entries.map(
  (entry) => source(`drizzle/${entry.tag}.sql`),
);

function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  const clock = { now: NOW };
  class Clock extends Date {
    static now() {
      return clock.now;
    }
  }
  sql.function('strftime', (_format, _date) =>
    String(Math.floor(clock.now / 1000)),
  );
  migrations.forEach((migration) => sql.exec(migration));
  sql.exec('PRAGMA foreign_keys=ON');
  for (const id of ['alice', 'bob', 'mallory'])
    sql
      .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
      .run(id, id, NOW - 1000);
  const queries = [];
  const hooks = { before: null };
  const adapter = {
    prepare(text) {
      const bind = (args = []) => ({
        bind: (...values) => bind(values),
        async run() {
          await Promise.resolve();
          await hooks.before?.('run', text, args);
          queries.push({ method: 'run', text, args });
          return {
            meta: { changes: Number(sql.prepare(text).run(...args).changes) },
          };
        },
        async all() {
          await Promise.resolve();
          await hooks.before?.('all', text, args);
          queries.push({ method: 'all', text, args });
          return { results: sql.prepare(text).all(...args) };
        },
        async first() {
          await Promise.resolve();
          await hooks.before?.('first', text, args);
          queries.push({ method: 'first', text, args });
          return sql.prepare(text).get(...args) || null;
        },
      });
      return bind();
    },
    async batch() {
      throw new Error('Unexpected global post fanout in a push fixture');
    },
  };
  const settings = {
    NOCT_VAPID_PUBLIC_KEY: 'fixture-public',
    NOCT_VAPID_PRIVATE_KEY: 'fixture-private',
    NOCT_VAPID_SUBJECT: 'https://example.invalid',
  };
  const network = {
    requests: [],
    payloads: [],
    active: 0,
    maxActive: 0,
    respond: async () => new Response(null, { status: 201 }),
  };
  const notifications = evaluate(
    source('lib/notifications.ts'),
    {
      '@/lib/premium-access': { appearanceColumns: () => 'NULL' },
      '@block65/webcrypto-web-push': {
        async buildPushPayload(payload, subscription) {
          network.payloads.push({ payload, subscription });
          return { method: 'POST', body: 'synthetic encrypted payload' };
        },
      },
      'next/headers': { cookies: async () => ({ get() {}, set() {} }) },
      './server': { db: () => adapter, clean, ApiError },
      './auth-session': { setting: (name) => settings[name] || '' },
      './account-access': { visibleAccount },
      './channel-access': channel,
      './chat-access': chat,
      './calls': { callAllowed },
    },
    {
      Date: Clock,
      crypto: webcrypto,
      fetch: async (url, init) => {
        assert.match(url, /^https:\/\/fcm\.googleapis\.com\/fixture\//);
        network.requests.push({ url, init });
        network.maxActive = Math.max(network.maxActive, ++network.active);
        try {
          return await network.respond(url, init);
        } finally {
          network.active--;
        }
      },
    },
  );
  const ctx = {
    sql,
    clock,
    queries,
    hooks,
    settings,
    network,
    notifications,
    subscription(id = 'sub-0', userId = 'bob', expiresAt = NOW + 86400000) {
      sql
        .prepare(
          'INSERT INTO push_subscriptions(id,userId,device,endpoint,p256dh,auth,created,expiresAt) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          userId,
          id,
          `https://fcm.googleapis.com/fixture/${id}`,
          'fixture-key',
          'fixture-auth',
          NOW - 1000,
          expiresAt,
        );
    },
    call(id = 'target', userId = 'bob') {
      sql
        .prepare(
          'INSERT INTO calls(id,caller,callee,callerDevice,created,callerSeen,calleeSeen,expiresAt) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          'alice',
          userId,
          'fixture-device-0001',
          NOW,
          NOW,
          NOW,
          NOW + 60000,
        );
      sql
        .prepare(
          "INSERT INTO notifications(id,userId,actorId,kind,targetId,created) VALUES(?,?,?,'call',?,?)",
        )
        .run(`call:${id}`, userId, 'alice', id, NOW);
    },
    deliveries() {
      return sql
        .prepare(
          'SELECT * FROM push_deliveries ORDER BY notificationId,subscriptionId',
        )
        .all()
        .map((row) => ({ ...row }));
    },
  };
  t.after(() => {
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    sql.close();
  });
  return ctx;
}

void test('targeted flush touches only its notification and skips global fanout/cleanup', async (t) => {
  const f = fixture(t);
  f.subscription();
  f.subscription('expired', 'mallory', NOW - 1);
  f.call();
  f.call('unrelated');
  f.sql
    .prepare(
      'INSERT INTO push_deliveries(notificationId,subscriptionId) VALUES(?,?)',
    )
    .run('call:unrelated', 'sub-0');
  const result = await f.notifications.flushPush('call:target');
  assert.deepEqual(result, { configured: true, sent: 1 });
  assert.equal(
    f.sql
      .prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE id=?')
      .get('expired').n,
    1,
  );
  const unrelated = f
    .deliveries()
    .find((row) => row.notificationId === 'call:unrelated');
  assert.equal(unrelated.state, 'pending');
  assert.equal(unrelated.attempts, 0);
  assert.equal(
    f.queries.filter((query) =>
      /DELETE FROM push_subscriptions|SELECT p.id FROM posts/.test(query.text),
    ).length,
    0,
  );
  assert.ok(
    f.queries
      .find((query) =>
        query.text.includes('INSERT OR IGNORE INTO push_deliveries'),
      )
      .args.includes('call:target'),
  );
  assert.ok(
    f.queries
      .find((query) => query.text.includes('SELECT pd.*'))
      .args.includes('call:target'),
  );
  assert.equal(f.network.payloads[0].payload.options.ttl, 30);
  assert.equal(f.network.payloads[0].payload.options.urgency, 'high');
  assert.equal(f.network.requests[0].init.redirect, 'error');
  assert.ok(f.network.requests[0].init.signal instanceof AbortSignal);
});

void test('privacy, call expiry and subscription ownership are checked after claiming', async (t) => {
  for (const [label, change] of [
    ['read', "UPDATE notifications SET read=1 WHERE id='call:target'"],
    ['ended', "UPDATE calls SET status='ended' WHERE id='target'"],
    ['accepted', "UPDATE calls SET status='accepted' WHERE id='target'"],
    ['expired-call', `UPDATE calls SET expiresAt=${NOW} WHERE id='target'`],
    [
      'expired-subscription',
      `UPDATE push_subscriptions SET expiresAt=${NOW} WHERE id='sub-0'`,
    ],
    [
      'subscription-owner',
      "UPDATE push_subscriptions SET userId='mallory' WHERE id='sub-0'",
    ],
    ['deleted-subscription', "DELETE FROM push_subscriptions WHERE id='sub-0'"],
    [
      'blocked',
      `INSERT INTO user_blocks(blocker,blocked,created) VALUES('bob','alice',${NOW})`,
    ],
    [
      'policy',
      "INSERT INTO user_privacy(userId,messagePolicy) VALUES('bob','nobody')",
    ],
    ['recipient-deleted', "UPDATE users SET deletedAt=1 WHERE id='bob'"],
  ]) {
    await t.test(label, async (st) => {
      const f = fixture(st);
      f.subscription();
      f.call();
      f.hooks.before = (method, text) => {
        if (method === 'first' && text.startsWith('SELECT n.id')) {
          f.hooks.before = null;
          assert.equal(f.deliveries()[0].attempts, 1);
          f.sql.exec(change);
        }
      };
      assert.equal((await f.notifications.flushPush('call:target')).sent, 0);
      assert.equal(f.network.requests.length, 0);
      if (f.deliveries().length)
        assert.equal(f.deliveries()[0].state, 'skipped');
    });
  }
});

void test('overlapping flushes share atomic claims and preserve a replacement lease', async (t) => {
  const f = fixture(t);
  f.subscription();
  f.call();
  const results = await Promise.all([
    f.notifications.flushPush('call:target'),
    f.notifications.flushPush('call:target'),
  ]);
  assert.equal(
    results.reduce((sum, result) => sum + result.sent, 0),
    1,
  );
  assert.equal(f.network.requests.length, 1);
  assert.equal(f.deliveries()[0].attempts, 1);
  f.sql.exec("UPDATE push_deliveries SET state='pending',retryAt=0");
  f.network.respond = async () => {
    f.sql
      .prepare('UPDATE push_deliveries SET lease=?,retryAt=?')
      .run('replacement-lease', NOW + 60000);
    return new Response(null, { status: 201 });
  };
  await f.notifications.flushPush('call:target');
  assert.equal(f.deliveries()[0].lease, 'replacement-lease');
  assert.equal(f.deliveries()[0].state, 'pending');
});

void test('targeted retries retain backoff, skip fresh subscriptions and remove dead endpoints', async (t) => {
  const f = fixture(t);
  f.subscription();
  f.call();
  f.subscription('new-device');
  f.sql
    .prepare('UPDATE push_subscriptions SET created=? WHERE id=?')
    .run(NOW + 1, 'new-device');
  f.network.respond = async () => new Response(null, { status: 503 });
  await f.notifications.flushPush('call:target');
  assert.equal(f.deliveries().length, 1);
  assert.equal(f.deliveries()[0].state, 'pending');
  assert.equal(f.deliveries()[0].retryAt, NOW + 30000);
  await f.notifications.flushPush('call:target');
  assert.equal(f.network.requests.length, 1);
  f.clock.now += 30001;
  f.network.respond = async () => new Response(null, { status: 410 });
  await f.notifications.flushPush('call:target');
  assert.equal(f.network.requests.length, 2);
  assert.equal(
    f.sql
      .prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE id=?')
      .get('sub-0').n,
    0,
  );
});

void test('ten subscriptions use at most four concurrent targeted sends', async (t) => {
  const f = fixture(t);
  f.call();
  for (let index = 0; index < 10; index++) f.subscription(`sub-${index}`);
  f.network.respond = async () => {
    await new Promise((done) => setTimeout(done, 2));
    return new Response(null, { status: 201 });
  };
  assert.equal((await f.notifications.flushPush('call:target')).sent, 10);
  assert.equal(f.network.maxActive, 4);
  assert.ok(
    f
      .deliveries()
      .every(
        (row) =>
          row.state === 'sent' && row.attempts === 1 && row.lease === null,
      ),
  );
});

void test('global flush still prioritizes calls and performs cleanup without parallel sends', async (t) => {
  const f = fixture(t);
  f.subscription();
  f.subscription('expired', 'mallory', NOW - 1);
  f.call();
  f.sql
    .prepare(
      "INSERT INTO messages(id,sender,recipient,text,created) VALUES('old','alice','bob','private fixture',?)",
    )
    .run(NOW - 500);
  f.sql
    .prepare(
      "INSERT INTO notifications(id,userId,actorId,kind,targetId,created) VALUES('message:old','bob','alice','message','old',?)",
    )
    .run(NOW - 500);
  assert.equal((await f.notifications.flushPush()).sent, 2);
  assert.deepEqual(
    f.network.payloads.map((entry) => entry.payload.data.tag),
    ['call:target', 'message:old'],
  );
  assert.equal(f.network.maxActive, 1);
  assert.ok(!JSON.stringify(f.network.payloads).includes('private fixture'));
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM push_subscriptions WHERE id='expired'",
      )
      .get().n,
    0,
  );
});

function routeFixture(overrides = {}) {
  const scheduled = [],
    flushed = [],
    logs = [],
    events = [];
  const bindings = {
    db: () => ({}),
    clean,
    ApiError,
    failure,
    viewer: async () => 'alice',
    readJsonBody: async (request) => request.json(),
    socialRateLimit: async () => events.push('limit'),
    administrationPost: async () => null,
    telegramPost: async () => null,
    callsPost: async () => {
      events.push('committed');
      return Response.json({ ok: true });
    },
    after: (callback) => {
      events.push('scheduled');
      scheduled.push(callback);
    },
    flushPush: async (id) => flushed.push(id),
    ...overrides,
  };
  const ast = ts.createSourceFile(
    'route.ts',
    source('app/api/social/route.ts'),
    ts.ScriptTarget.Latest,
    true,
  );
  const dependencies = {};
  for (const entry of ast.statements) {
    if (!ts.isImportDeclaration(entry)) continue;
    const imported = entry.importClause?.namedBindings;
    const importedModule = {};
    for (const name of imported?.elements || []) {
      importedModule[name.propertyName?.text || name.name.text] =
        bindings[name.name.text] ||
        (() => {
          throw new Error(`Unexpected route path: ${name.name.text}`);
        });
    }
    dependencies[entry.moduleSpecifier.text] = importedModule;
  }
  const route = evaluate(source('app/api/social/route.ts'), dependencies, {
    console: { error: (...args) => logs.push(args) },
  });
  return {
    scheduled,
    flushed,
    logs,
    events,
    post(action = 'callStart') {
      return route.POST(
        new Request('https://app.example.invalid/api/social', {
          method: 'POST',
          headers: {
            origin: 'https://app.example.invalid',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action,
            id: ' target ',
            peer: 'bob',
            device: 'fixture-device-0001',
          }),
        }),
      );
    },
  };
}

void test('callStart returns after commit and schedules targeted push for after response', async () => {
  const f = routeFixture();
  assert.equal((await f.post()).status, 200);
  assert.deepEqual(f.events, ['limit', 'committed', 'scheduled']);
  assert.equal(f.flushed.length, 0);
  assert.equal(f.scheduled.length, 1);
  await f.scheduled[0]();
  assert.deepEqual(f.flushed, ['call:target']);
});

void test('failed and non-start call actions do not schedule push', async () => {
  for (const action of ['callAccept', 'callSignal', 'callEnd']) {
    const f = routeFixture();
    assert.equal((await f.post(action)).status, 200);
    assert.equal(f.scheduled.length, 0);
  }
  const failed = routeFixture({
    callsPost: async () => Response.json({ error: 'busy' }, { status: 409 }),
  });
  assert.equal((await failed.post()).status, 409);
  assert.equal(failed.scheduled.length, 0);
  const rejected = routeFixture({
    callsPost: async () => {
      throw new ApiError(403, 'fixture blocked');
    },
  });
  assert.equal((await rejected.post()).status, 403);
  assert.equal(rejected.scheduled.length, 0);
});

void test('background and scheduling failures preserve committed response and redact details', async () => {
  const privateDetail = 'synthetic-provider-response-do-not-log';
  const background = routeFixture({
    flushPush: async () => {
      throw new Error(privateDetail);
    },
  });
  assert.equal((await background.post()).status, 200);
  await background.scheduled[0]();
  assert.deepEqual(background.logs, [['Incoming call push delivery failed']]);
  assert.ok(!JSON.stringify(background.logs).includes(privateDetail));
  const scheduling = routeFixture({
    after: () => {
      throw new Error(privateDetail);
    },
  });
  assert.equal((await scheduling.post()).status, 200);
  assert.deepEqual(scheduling.logs, [['Incoming call push scheduling failed']]);
});
void test('targeted empty ID or missing config never falls back to global work', async (t) => {
  const f = fixture(t);
  f.subscription();
  f.call();
  assert.equal((await f.notifications.flushPush('')).sent, 0);
  assert.equal(f.deliveries().length, 0);
  f.queries.length = 0;
  delete f.settings.NOCT_VAPID_PRIVATE_KEY;
  assert.deepEqual(await f.notifications.flushPush('call:target'), {
    configured: false,
    sent: 0,
  });
  assert.equal(f.queries.length, 0);
});

void test('one database failure does not end background lifetime before active sends settle', async (t) => {
  const f = fixture(t);
  f.call();
  for (let index = 0; index < 4; index++) f.subscription(`sub-${index}`);
  f.hooks.before = (method, text, args) => {
    if (
      method === 'run' &&
      text.startsWith('UPDATE push_deliveries SET lease=') &&
      args.includes('sub-0')
    ) {
      throw new Error('synthetic database details');
    }
  };
  const pending = [];
  f.network.respond = () => new Promise((done) => pending.push(done));
  let settled = false;
  const running = f.notifications.flushPush('call:target').then(
    () => {
      settled = true;
      return null;
    },
    (error) => {
      settled = true;
      return error;
    },
  );
  for (let index = 0; index < 100 && pending.length < 3; index++)
    await Promise.resolve();
  assert.equal(pending.length, 3);
  assert.equal(settled, false);
  pending.forEach((done) => done(new Response(null, { status: 201 })));
  const error = await running;
  assert.equal(error.message, 'Push delivery batch did not complete');
  assert.equal(f.network.active, 0);
  assert.equal(f.deliveries().filter((row) => row.state === 'sent').length, 3);
});
