/**
 * Standalone administration regression tests. Requires Node 22.13+ (node:sqlite)
 * and the project's TypeScript installation. No Worker, browser, network or
 * on-disk database is used; project source files are never modified.
 *
 * Run from the project directory:
 *   node --test tests/administration.test.mjs
 * Or set NOCT_TEST_ROOT to the project directory. After copying to tests/, run:
 *   node --test tests/administration.test.mjs
 *
 * Actual administration, account-access, premium-access, channel-access,
 * rate-limit and ApiError modules execute against a small D1/SQLite adapter.
 * clean() and tokenHash() are extracted from their actual source declarations,
 * avoiding unrelated framework/authentication initialization. viewer()/HTTP
 * cookies, trusted-proxy authentication and Cloudflare's batch implementation
 * are outside this harness; the adapter models D1 batch atomicity explicitly.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto, randomUUID } from 'node:crypto';
import test from 'node:test';

const root = [
  process.env.NOCT_TEST_ROOT,
  process.cwd(),
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
]
  .filter(Boolean)
  .find((p) => existsSync(join(p, 'lib/administration.ts')));
assert.ok(root, 'Run from the project directory or set NOCT_TEST_ROOT.');
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const sourceCache = new Map();
const source = (file) => {
  if (!sourceCache.has(file))
    sourceCache.set(file, readFileSync(join(root, file), 'utf8'));
  return sourceCache.get(file);
};
const journal = JSON.parse(source('drizzle/meta/_journal.json')).entries;
const migrations = journal.map((entry) => [
  entry.tag,
  source(`drizzle/${entry.tag}.sql`),
]);
const OWNER = 'local_seedy';
const DAY = 86400000;
// A nonzero millisecond fraction deterministically detects the old startsAt bug.
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0, 875);
const START = Math.floor(NOW / 1000) * 1000;
class Clock extends Date {
  static now() {
    return NOW;
  }
}

function declaration(file, name) {
  const text = source(file);
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
  );
  assert.ok(node, `${file} must export function ${name}`);
  return node.getText(ast);
}

function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  // Freeze SQLite and JavaScript clocks together, preserving second precision.
  sql.function('strftime', (format, value) => {
    assert.equal(format, '%s');
    assert.equal(value, 'now');
    return String(Math.floor(NOW / 1000));
  });
  let seededOwner = false;
  for (const [tag, text] of migrations) {
    if (/CREATE TABLE\s+[`"]?administrators[`"]?\s*\(/i.test(text)) {
      sql
        .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
        .run(OWNER, 'Seedy', NOW - DAY);
      sql
        .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
        .run('noctgram', 'Noctgram', NOW - DAY);
      seededOwner = true;
    }
    try {
      sql.exec(text);
    } catch (error) {
      throw new Error(`Journal migration ${tag} failed`, { cause: error });
    }
  }
  assert.ok(seededOwner, 'Journal must include the administration migration.');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const [id, name, kind, ownerId] of [
    ['user_a', 'Alice', 'person', null],
    ['user_b', 'Bob', 'person', null],
    ['ordinary', 'Ordinary', 'person', null],
    ['moderator', 'Moderator', 'person', null],
    ['channel_a', 'Channel', 'channel', 'user_a'],
    ['deleted', 'Deleted', 'person', null],
    ['incomplete', 'Incomplete', 'person', null],
  ])
    sql
      .prepare(
        'INSERT INTO users(id,name,kind,ownerId,created) VALUES(?,?,?,?,?)',
      )
      .run(id, name, kind, ownerId, NOW - 1000);
  for (const row of sql.prepare('SELECT id FROM users').all()) {
    sql
      .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
      .run(`h_${String(row.id)}`, row.id);
  }
  sql
    .prepare('UPDATE users SET deletedAt=? WHERE id=?')
    .run(NOW - 1000, 'deleted');
  sql
    .prepare('UPDATE users SET onboardingComplete=0 WHERE id=?')
    .run('incomplete');
  sql
    .prepare('INSERT INTO moderators(userId,created) VALUES(?,?)')
    .run('moderator', NOW - DAY);
  assert.equal(
    sql.prepare('SELECT userId FROM administrators WHERE userId=?').get(OWNER)
      ?.userId,
    OWNER,
    'The real migration must provision local_seedy as administrator.',
  );

  const hooks = {
    beforeBatch: null,
    beforeStatement: null,
    replayBarrier: null,
  };
  const adapter = {
    prepare(text) {
      const statement = (args) => ({
        text,
        args,
        bind(...values) {
          return statement(values);
        },
        async first(column) {
          // Capture the DB snapshot before waiting: both concurrent requests
          // must observe a missing receipt before either transaction can run.
          const row = sql.prepare(text).get(...args) || null;
          const barrier = hooks.replayBarrier;
          if (
            barrier &&
            row === null &&
            /SELECT\s+\*\s+FROM\s+admin_events\s+WHERE\s+id\s*=\s*\?/i.test(
              text,
            )
          ) {
            if (--barrier.remaining === 0) {
              hooks.replayBarrier = null;
              barrier.release();
            }
            await barrier.wait;
          }
          return column ? (row?.[column] ?? null) : row;
        },
        async all() {
          return { results: sql.prepare(text).all(...args), success: true };
        },
        async run() {
          const result = sql.prepare(text).run(...args);
          return {
            success: true,
            meta: {
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid),
            },
          };
        },
      });
      return statement([]);
    },
    async batch(statements) {
      if (hooks.beforeBatch) {
        const callback = hooks.beforeBatch;
        hooks.beforeBatch = null;
        callback();
      }
      sql.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((s) => {
          hooks.beforeStatement?.(s.text);
          if (/^\s*SELECT\b/i.test(s.text))
            return {
              success: true,
              results: sql.prepare(s.text).all(...s.args),
            };
          const result = sql.prepare(s.text).run(...s.args);
          return { success: true, meta: { changes: Number(result.changes) } };
        });
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };

  const modules = new Map();
  const allowed = new Set([
    'lib/administration.ts',
    'lib/administrator-access.ts',
    'lib/admin-gifts.ts',
    'lib/admin-online.ts',
    'lib/admin-access.ts',
    'lib/access-security.ts',
    'lib/online-stats.ts',
    'lib/gift-catalog.ts',
    'lib/gift-upgrade-catalog.ts',
    'lib/gift-upgrade-data.json',
    'lib/account-access.ts',
    'lib/premium-access.ts',
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
    const compiledModule = { exports: {} };
    modules.set(file, compiledModule);
    const output = ts.transpileModule(text, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: file,
    }).outputText;
    const scopedRequire = (specifier) => {
      const path = specifier.startsWith('@/')
        ? resolve(root, specifier.slice(2))
        : specifier.startsWith('.')
          ? resolve(root, dirname(file), specifier)
          : null;
      assert.ok(path, `Unexpected external dependency ${specifier} in ${file}`);
      const relative = path
        .slice(resolve(root).length + 1)
        .replaceAll('\\', '/');
      return load(extname(relative) ? relative : `${relative}.ts`);
    };
    // Transpile and execute only the explicitly allowlisted local source modules.
    // eslint-disable-next-line typescript/no-implied-eval
    new Function('require', 'exports', 'module', 'Date', 'crypto', output)(
      scopedRequire,
      compiledModule.exports,
      compiledModule,
      Clock,
      webcrypto,
    );
    return compiledModule.exports;
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
      Object.assign(result, { db: () => adapter, ApiError: api.ApiError });
      return result;
    }
    if (file === 'lib/auth-session.ts')
      return Object.assign(evaluate(file, declaration(file, 'tokenHash')), {
        setting: () => '1',
      });
    if (file === 'lib/privacy.ts')
      return new Proxy(
        {},
        {
          get(_object, key) {
            return () => {
              throw new Error(`Untested privacy path: ${String(key)}`);
            };
          },
        },
      );
    assert.ok(
      allowed.has(file),
      `Unexpected dependency ${file}; add its real module or document the boundary.`,
    );
    return file.endsWith('.json')
      ? { default: JSON.parse(source(file)) }
      : evaluate(file, source(file));
  }
  const admin = load('lib/administration.ts');
  const access = load('lib/account-access.ts');
  const premium = load('lib/premium-access.ts');
  const ApiError = load('lib/api-error.ts').ApiError;
  const count = (table) =>
    Number(sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  const body = (patch = {}) => ({
    target: 'user_a',
    kind: 'stars',
    amount: 100,
    reason: 'Regression test',
    requestId: randomUUID(),
    ...patch,
  });
  async function post(input, actor = OWNER) {
    try {
      const response = await admin.administrationPost(
        'adminGrant',
        input,
        actor,
      );
      return { status: response.status, body: await response.json() };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return {
        status: error.status,
        body: { error: error.message, code: error.code },
      };
    }
  }
  function restrict(id, mode) {
    const event = randomUUID();
    sql
      .prepare(
        'INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,?,?,?,?)',
      )
      .run(event, id, OWNER, mode, 'Concurrent restriction', NOW);
    sql
      .prepare(
        'INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,?,?,?)',
      )
      .run(id, event, mode, 'Concurrent restriction', NOW);
  }
  function armReplayRace(participants = 2) {
    let release;
    const wait = new Promise((done) => {
      release = done;
    });
    hooks.replayBarrier = { remaining: participants, wait, release };
  }
  function active(id = 'user_a') {
    return Number(
      sql
        .prepare(
          `SELECT ${premium.premiumActive('u.id')} AS active FROM users u WHERE u.id=?`,
        )
        .get(id).active,
    );
  }
  t.after(() => sql.close());
  return {
    sql,
    hooks,
    admin,
    online: load('lib/admin-online.ts'),
    access,
    premium,
    ApiError,
    count,
    body,
    post,
    restrict,
    armReplayRace,
    active,
  };
}

const options = { concurrency: false, timeout: 10000 };
function scenario(name, run) {
  void test(name, options, async (t) => {
    await run(fixture(t), t);
  });
}

scenario(
  'online counts active personal accounts once and excludes invalid or blocked profiles',
  async (f) => {
    for (const id of ['user_a', 'user_b', 'deleted', 'incomplete', 'channel_a'])
      f.sql
        .prepare('UPDATE users SET lastSeen=? WHERE id=?')
        .run(NOW - 60000, id);
    f.sql
      .prepare('UPDATE users SET lastSeen=? WHERE id=?')
      .run(NOW + 1, 'ordinary');
    f.sql
      .prepare('UPDATE users SET lastSeen=? WHERE id=?')
      .run(NOW - 120000, 'moderator');
    f.sql
      .prepare(
        "INSERT INTO user_presence_privacy(userId,policy) VALUES('user_a','nobody')",
      )
      .run();
    assert.equal((await f.online.readAdminOnline(OWNER, 'hour')).online, 2);
    // The aggregate includes private presence without disclosing names or their status.
    const response = await f.admin.administrationGet(
      'adminOnline',
      new URLSearchParams('range=hour'),
      OWNER,
    );
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const data = await response.json();
    assert.equal(data.online, 2);
    assert.ok(!JSON.stringify(data).includes('user_a'));
    f.restrict('user_b', 'blocked');
    assert.equal((await f.online.readAdminOnline(OWNER, 'hour')).online, 1);
    f.sql
      .prepare('UPDATE users SET lastSeen=? WHERE id=?')
      .run(NOW - 120001, 'user_a');
    assert.equal((await f.online.readAdminOnline(OWNER, 'hour')).online, 0);
  },
);

scenario(
  'online history records actual zeroes, deduplicates cron retries and never fabricates missing minutes',
  async (f) => {
    const empty = await f.online.readAdminOnline(OWNER, 'hour');
    assert.equal(empty.points.length, 60);
    assert.ok(empty.points.every((p) => p.average === null && p.samples === 0));
    assert.equal(empty.day.peak, null);
    await f.online.recordOnlineSnapshot(NOW);
    f.sql.prepare('UPDATE users SET lastSeen=? WHERE id=?').run(NOW, 'user_a');
    await f.online.recordOnlineSnapshot(NOW + 1000);
    assert.equal(
      f.sql.prepare('SELECT online FROM online_samples').get().online,
      0,
    );
    await f.online.recordOnlineSnapshot(NOW + 60000);
    const data = await f.online.readAdminOnline(OWNER, 'hour', NOW + 60000);
    assert.deepEqual(
      data.points.slice(-2).map((p) => p.average),
      [0, 1],
    );
    assert.equal(data.day.peak, 1);
    assert.equal(data.day.average, 0.5);
    assert.equal(data.day.samples, 2);
    assert.ok(data.points.slice(0, -2).every((p) => p.average === null));
    assert.equal(data.firstSampleAt, NOW);
    assert.equal(data.latestSampleAt, NOW + 60000);
  },
);

scenario(
  'hourly online uses minute averages and peaks, not a sum of users',
  async (f) => {
    const hour = Math.floor(NOW / 3600000) * 3600000 - 3600000;
    for (const [offset, online] of [
      [0, 2],
      [1, 6],
      [2, 4],
    ])
      f.sql
        .prepare(
          'INSERT INTO online_samples(minute,online,recordedAt) VALUES(?,?,?)',
        )
        .run(hour + offset * 60000, online, hour + offset * 60000);
    const day = await f.online.readAdminOnline(OWNER, 'day');
    assert.equal(day.points.length, 24);
    const point = day.points.find((p) => p.time === hour);
    assert.deepEqual(
      { ...point },
      { time: hour, average: 4, peak: 6, minimum: 2, samples: 3 },
    );
    assert.equal(
      (await f.online.readAdminOnline(OWNER, 'week')).points.length,
      168,
    );
    assert.equal(
      (await f.online.readAdminOnline(OWNER, 'malformed')).range,
      'day',
    );
  },
);

scenario(
  'online retention deletes only old aggregate samples and presence queries use an index',
  async (f) => {
    const minute = Math.floor(NOW / 60000) * 60000;
    const cutoff = minute - 30 * DAY;
    for (const at of [cutoff - 60000, cutoff, minute - 60000])
      f.sql
        .prepare(
          'INSERT INTO online_samples(minute,online,recordedAt) VALUES(?,2,?)',
        )
        .run(at, at);
    const users = JSON.stringify(
      f.sql.prepare('SELECT * FROM users ORDER BY id').all(),
    );
    await f.online.recordOnlineSnapshot(NOW);
    assert.equal(
      f.sql
        .prepare('SELECT COUNT(*) AS n FROM online_samples WHERE minute<?')
        .get(cutoff).n,
      0,
    );
    assert.ok(
      f.sql
        .prepare('SELECT minute FROM online_samples WHERE minute=?')
        .get(cutoff),
    );
    assert.equal(
      JSON.stringify(f.sql.prepare('SELECT * FROM users ORDER BY id').all()),
      users,
    );
    let countQuery;
    f.hooks.beforeStatement = (query) => {
      if (query.startsWith('SELECT COUNT(*) AS online')) countQuery = query;
    };
    await f.online.readAdminOnline(OWNER, 'day');
    const plan = f.sql
      .prepare('EXPLAIN QUERY PLAN ' + countQuery)
      .all(NOW - 120000, NOW, NOW);
    assert.ok(plan.some((row) => row.detail.includes('users_last_seen')));
  },
);

scenario(
  'restricted administrators cannot access online aggregates',
  async (f) => {
    f.restrict(OWNER, 'read_only');
    await assert.rejects(
      f.online.readAdminOnline(OWNER, 'day'),
      (e) => e.status === 403,
    );
  },
);

scenario(
  'journal creates real tables, provisions only the owner, and validates foreign keys',
  async (f) => {
    assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(f.count('administrators'), 1);
    assert.equal(await f.admin.isAdministrator(OWNER), true);
    assert.equal(await f.access.isModerator(OWNER), true);
    assert.equal(await f.admin.isAdministrator('moderator'), false);
  },
);
for (const actor of ['ordinary', 'moderator'])
  scenario(
    `${actor} cannot GET administration or grant any privilege`,
    async (f) => {
      await assert.rejects(
        f.admin.administrationGet('adminOnline', new URLSearchParams(), actor),
        (e) => e.status === 403,
      );
      await assert.rejects(
        f.admin.administrationGet(
          'administration',
          new URLSearchParams(),
          actor,
        ),
        (e) => e.status === 403,
      );
      for (const kind of [
        'stars',
        'premium',
        'verified',
        'gratitude',
        'moderator',
      ]) {
        assert.equal(
          (await f.post(f.body({ kind, amount: 1 }), actor)).status,
          403,
        );
      }
      assert.equal(f.count('admin_events'), 0);
    },
  );
for (const kind of ['stars', 'premium', 'gratitude', 'moderator'])
  scenario(`channel cannot receive ${kind}`, async (f) => {
    assert.equal(
      (await f.post(f.body({ target: 'channel_a', kind, amount: 1 }))).status,
      400,
    );
    assert.equal(f.count('admin_events'), 0);
    assert.equal(f.count('star_transfers'), 0);
  });
for (const target of ['missing', 'deleted', 'incomplete'])
  scenario(`grant rejects ${target} target`, async (f) => {
    assert.equal((await f.post(f.body({ target }))).status, 404);
    assert.equal(f.count('admin_events'), 0);
  });
scenario(
  'invalid quantities and request formats never write a grant',
  async (f) => {
    for (const patch of [
      { amount: 0 },
      { amount: -1 },
      { amount: 1.5 },
      { amount: 1000001 },
      { kind: 'premium', amount: 0 },
      { kind: 'premium', amount: 366 },
      { kind: 'verified', amount: 2 },
      { kind: 'gratitude', amount: 2 },
      { kind: 'gratitude', amount: -1 },
      { kind: 'moderator', amount: -1 },
      { requestId: 'not-a-request-id' },
      { kind: 'administrator' },
      { reason: '' },
    ])
      assert.equal(
        (await f.post(f.body(patch))).status,
        400,
        JSON.stringify(patch),
      );
    assert.equal(f.count('admin_events'), 0);
  },
);
scenario(
  'Stars grant and replay preserve the starter bonus and credit exactly once',
  async (f) => {
    f.sql
      .prepare(
        "INSERT INTO star_transfers(id,recipient,amount,kind,created) VALUES('grant:user_a','user_a',10000,'grant',?)",
      )
      .run(NOW - DAY);
    const input = f.body({ amount: 1234 });
    assert.equal((await f.post(input)).status, 200);
    const replay = await f.post(input);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    const rows = f.sql
      .prepare(
        "SELECT sender,recipient,amount FROM star_transfers WHERE kind='admin_grant'",
      )
      .all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sender, null);
    assert.equal(rows[0].recipient, 'user_a');
    assert.equal(rows[0].amount, 1234);
    assert.equal(
      f.sql.prepare('SELECT SUM(amount) AS total FROM star_transfers').get()
        .total,
      11234,
    );
    assert.equal(f.count('admin_events'), 1);
  },
);
scenario('same-key concurrent Stars requests credit once', async (f) => {
  const input = f.body();
  f.armReplayRace();
  const results = await Promise.all([f.post(input), f.post(input)]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.equal(f.count('star_transfers'), 1);
  assert.equal(f.count('admin_events'), 1);
});
for (const [name, patch] of Object.entries({
  amount: { amount: 200 },
  target: { target: 'user_b' },
  action: { kind: 'premium' },
  reason: { reason: 'Different reason' },
}))
  scenario(`concurrent altered replay (${name}) must return 409`, async (f) => {
    const first = f.body(),
      second = { ...first, ...patch };
    f.armReplayRace();
    const results = await Promise.all([f.post(first), f.post(second)]);
    assert.deepEqual(
      results.map((r) => r.status).sort((a, b) => a - b),
      [200, 409],
    );
    const winner = results[0].status === 200 ? first : second;
    const event = f.sql.prepare('SELECT * FROM admin_events').get();
    assert.equal(f.count('admin_events'), 1);
    assert.equal(event.targetId, winner.target);
    assert.equal(event.action, winner.kind);
    assert.equal(event.amount, winner.amount);
    assert.equal(event.reason, winner.reason);
    assert.equal(
      f.count('star_transfers') + f.count('premium_entitlements'),
      1,
    );
  });
scenario('sequential changed payload is also rejected', async (f) => {
  const input = f.body();
  assert.equal((await f.post(input)).status, 200);
  assert.equal((await f.post({ ...input, amount: 200 })).status, 409);
  assert.equal(
    f.sql.prepare('SELECT amount FROM star_transfers').get().amount,
    100,
  );
});
scenario(
  'administrator role revoked after preflight prevents the whole transaction',
  async (f) => {
    f.hooks.beforeBatch = () =>
      f.sql.prepare('DELETE FROM administrators WHERE userId=?').run(OWNER);
    assert.equal((await f.post(f.body())).status, 409);
    assert.equal(f.count('star_transfers'), 0);
    assert.equal(f.count('admin_events'), 0);
  },
);
for (const mode of ['read_only', 'blocked']) {
  scenario(`${mode} administrator is denied before preflight`, async (f) => {
    f.restrict(OWNER, mode);
    assert.equal((await f.post(f.body())).status, 403);
    assert.equal(f.count('admin_events'), 0);
  });
  scenario(
    `${mode} added after preflight prevents the whole transaction`,
    async (f) => {
      f.hooks.beforeBatch = () => f.restrict(OWNER, mode);
      assert.equal((await f.post(f.body())).status, 409);
      assert.equal(f.count('star_transfers'), 0);
      assert.equal(f.count('admin_events'), 0);
    },
  );
}
scenario('target deleted after preflight cannot receive Stars', async (f) => {
  f.hooks.beforeBatch = () =>
    f.sql.prepare("UPDATE users SET deletedAt=? WHERE id='user_a'").run(NOW);
  assert.equal((await f.post(f.body())).status, 409);
  assert.equal(f.count('star_transfers'), 0);
  assert.equal(f.count('admin_events'), 0);
});
scenario(
  'new Premium is active immediately despite nonzero milliseconds',
  async (f) => {
    assert.equal(
      (await f.post(f.body({ kind: 'premium', amount: 30 }))).status,
      200,
    );
    assert.equal(f.active(), 1);
    const row = f.sql
      .prepare("SELECT * FROM premium_entitlements WHERE userId='user_a'")
      .get();
    assert.ok(row.startsAt <= START);
    assert.equal(row.expiresAt, START + 30 * DAY);
    assert.equal(row.source, 'admin');
  },
);
scenario(
  'concurrent Premium extension extends once and preserves immediate activity',
  async (f) => {
    const initialStart = START - 20 * DAY,
      initialExpiry = START + 10 * DAY;
    f.sql
      .prepare(
        "INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) VALUES('user_a',?,?,'test',?)",
      )
      .run(initialStart, initialExpiry, initialStart);
    const input = f.body({ kind: 'premium', amount: 30 });
    f.armReplayRace();
    assert.deepEqual(
      (await Promise.all([f.post(input), f.post(input)])).map((r) => r.status),
      [200, 200],
    );
    const row = f.sql
      .prepare("SELECT * FROM premium_entitlements WHERE userId='user_a'")
      .get();
    assert.equal(row.startsAt, initialStart);
    assert.equal(row.expiresAt, initialExpiry + 30 * DAY);
    assert.equal(f.active(), 1);
    assert.equal(f.count('admin_events'), 1);
  },
);
for (const revoked of [false, true])
  scenario(
    `${revoked ? 'revoked' : 'expired'} Premium restarts from now`,
    async (f) => {
      f.sql
        .prepare(
          "INSERT INTO premium_entitlements(userId,startsAt,expiresAt,revokedAt,source,created) VALUES('user_a',?,?,?,'test',?)",
        )
        .run(
          START - 40 * DAY,
          revoked ? START + 200 * DAY : START - DAY,
          revoked ? START - 1000 : 0,
          START - 40 * DAY,
        );
      assert.equal(
        (await f.post(f.body({ kind: 'premium', amount: 7 }))).status,
        200,
      );
      const row = f.sql
        .prepare("SELECT * FROM premium_entitlements WHERE userId='user_a'")
        .get();
      assert.equal(row.expiresAt, START + 7 * DAY);
      assert.equal(row.revokedAt, 0);
      assert.equal(f.active(), 1);
    },
  );
scenario(
  'verification can be granted and removed without Premium, including channels',
  async (f) => {
    for (const target of ['user_a', 'channel_a']) {
      const input = f.body({ target, kind: 'verified', amount: 1 });
      assert.equal((await f.post(input)).status, 200);
      assert.equal((await f.post(input)).status, 200);
      const identity = f.sql
        .prepare(
          `SELECT ${f.premium.appearanceColumns('u')} FROM users u WHERE u.id=?`,
        )
        .get(target);
      assert.equal(identity.verified, 1);
      assert.equal(identity.premium, 0);
      assert.equal(
        (await f.post(f.body({ target, kind: 'verified', amount: 0 }))).status,
        200,
      );
      assert.equal(
        f.sql.prepare('SELECT verified FROM users WHERE id=?').get(target)
          .verified,
        0,
      );
    }
    assert.equal(f.count('admin_events'), 4);
  },
);
scenario(
  'gratitude grant, replay and removal are audited without granting privileges',
  async (f) => {
    const input = f.body({ kind: 'gratitude', amount: 1 });
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM users WHERE gratitude<>0').get()
        .n,
      0,
    );
    assert.equal((await f.post(input)).status, 200);
    assert.equal((await f.post(input)).body.replayed, true);
    const identity = f.sql
      .prepare(
        `SELECT ${f.premium.appearanceColumns('u')} FROM users u WHERE u.id='user_a'`,
      )
      .get();
    assert.equal(identity.gratitude, 1);
    assert.equal(f.premium.appearanceFrom(identity).gratitude, 1);
    assert.equal(identity.verified, 0);
    assert.equal(identity.premium, 0);
    assert.equal(await f.admin.isAdministrator('user_a'), false);
    assert.equal(await f.access.isModerator('user_a'), false);
    assert.equal(f.count('star_transfers'), 0);
    assert.equal(f.count('admin_events'), 1);
    const result = await f.admin.administrationGet(
      'administration',
      new URLSearchParams({ q: 'h_user_a' }),
      OWNER,
    );
    const data = await result.json();
    assert.equal(data.people.find((p) => p.id === 'user_a').gratitude, 1);
    assert.equal(data.events[0].action, 'gratitude');
    // An independent official verification survives removal of the gratitude sign.
    f.sql.prepare("UPDATE users SET verified=1 WHERE id='user_a'").run();
    assert.equal(
      (await f.post(f.body({ kind: 'gratitude', amount: 0 }))).status,
      200,
    );
    const removed = f.sql
      .prepare("SELECT gratitude,verified FROM users WHERE id='user_a'")
      .get();
    assert.equal(removed.gratitude, 0);
    assert.equal(removed.verified, 1);
    assert.equal(f.count('admin_events'), 2);
  },
);
scenario(
  'gratitude is not granted if administrator rights change before commit',
  async (f) => {
    f.hooks.beforeBatch = () =>
      f.sql.prepare('DELETE FROM administrators WHERE userId=?').run(OWNER);
    assert.equal(
      (await f.post(f.body({ kind: 'gratitude', amount: 1 }))).status,
      409,
    );
    assert.equal(
      f.sql.prepare("SELECT gratitude FROM users WHERE id='user_a'").get()
        .gratitude,
      0,
    );
    assert.equal(f.count('admin_events'), 0);
  },
);
scenario('gratitude and its audit event roll back together', async (f) => {
  f.hooks.beforeStatement = (text) => {
    if (text.includes('INSERT INTO admin_events'))
      throw new Error('Audit write failed');
  };
  await assert.rejects(
    f.post(f.body({ kind: 'gratitude', amount: 1 })),
    /Audit write failed/,
  );
  assert.equal(
    f.sql.prepare("SELECT gratitude FROM users WHERE id='user_a'").get()
      .gratitude,
    0,
  );
  assert.equal(f.count('admin_events'), 0);
});
scenario(
  'moderator grant/revoke changes real role gates but never creates administrators',
  async (f) => {
    assert.equal(await f.access.isModerator('user_a'), false);
    const input = f.body({ kind: 'moderator', amount: 1 });
    assert.equal((await f.post(input)).status, 200);
    assert.equal((await f.post(input)).status, 200);
    assert.equal(await f.access.isModerator('user_a'), true);
    assert.equal(await f.admin.isAdministrator('user_a'), false);
    assert.equal((await f.post(f.body(), 'user_a')).status, 403);
    assert.equal(
      (await f.post(f.body({ kind: 'moderator', amount: 0 }))).status,
      200,
    );
    assert.equal(await f.access.isModerator('user_a'), false);
    assert.equal(f.count('admin_events'), 2);
  },
);
scenario('moderator controls cannot alter the administrator', async (f) => {
  for (const amount of [0, 1])
    assert.equal(
      (await f.post(f.body({ target: OWNER, kind: 'moderator', amount })))
        .status,
      400,
    );
  assert.equal(await f.admin.isAdministrator(OWNER), true);
  assert.equal(f.count('admin_events'), 0);
});
scenario('audit insert failure rolls back the grant', async (f) => {
  f.hooks.beforeStatement = (text) => {
    if (/INSERT\s+INTO\s+admin_events/i.test(text))
      throw new Error('Injected audit failure');
  };
  await assert.rejects(f.post(f.body()), /Injected audit failure/);
  assert.equal(f.count('star_transfers'), 0);
  assert.equal(f.count('admin_events'), 0);
});
scenario(
  'administration GET executes real identity projections and returns the audit',
  async (f) => {
    assert.equal((await f.post(f.body())).status, 200);
    const response = await f.admin.administrationGet(
      'administration',
      new URLSearchParams({ q: 'Alice' }),
      OWNER,
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.people.length, 1);
    assert.equal(data.people[0].id, 'user_a');
    assert.equal(data.people[0].balance, 100);
    assert.equal(data.events.length, 1);
    assert.equal(data.events[0].actorId, OWNER);
  },
);
scenario(
  'actual administrator rate limit rejects grant 31 without a ledger write',
  async (f) => {
    for (let i = 0; i < 30; i++)
      assert.equal((await f.post(f.body({ amount: 1 }))).status, 200);
    assert.equal((await f.post(f.body({ amount: 1 }))).status, 429);
    assert.equal(f.count('star_transfers'), 30);
    assert.equal(f.count('admin_events'), 30);
  },
);

const starsOf = (f, id) =>
  Number(
    f.sql
      .prepare(
        'SELECT COALESCE(SUM(CASE WHEN recipient=? THEN amount ELSE -amount END),0) AS n FROM star_transfers WHERE recipient=? OR sender=?',
      )
      .get(id, id, id).n,
  );
scenario(
  'stars debit goes to the treasury, never below zero, and audits only real debits',
  async (f) => {
    assert.equal((await f.post(f.body({ amount: 500 }))).status, 200);
    const over = await f.post(f.body({ kind: 'starsDebit', amount: 501 }));
    assert.equal(over.status, 409);
    assert.match(over.body.error, /500/);
    assert.equal(f.count('admin_events'), 1);
    assert.equal(starsOf(f, 'user_a'), 500);
    const debit = f.body({ kind: 'starsDebit', amount: 200 });
    assert.equal((await f.post(debit)).status, 200);
    assert.deepEqual((await f.post(debit)).body, { ok: true, replayed: true });
    assert.equal(starsOf(f, 'user_a'), 300);
    assert.equal(f.count('admin_events'), 2);
    assert.deepEqual(
      {
        ...f.sql
          .prepare(
            "SELECT sender,recipient,amount FROM star_transfers WHERE kind='admin_debit'",
          )
          .get(),
      },
      { sender: 'user_a', recipient: 'noctgram_gifts', amount: 200 },
    );
    for (const [patch, actor, status] of [
      [{ target: 'channel_a', amount: 1 }, OWNER, 400],
      [{ amount: 0 }, OWNER, 400],
      [{ amount: 1 }, 'moderator', 403],
    ])
      assert.equal(
        (await f.post(f.body({ kind: 'starsDebit', ...patch }), actor)).status,
        status,
      );
    assert.equal(starsOf(f, 'user_a'), 300);
    assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(), []);
  },
);
scenario(
  'rich list orders personal accounts by balance and paginates',
  async (f) => {
    await f.post(f.body({ target: 'user_b', amount: 900 }));
    await f.post(f.body({ target: 'user_a', amount: 300 }));
    const get = async (query) =>
      (
        await f.admin.administrationGet(
          'administration',
          new URLSearchParams(query),
          OWNER,
        )
      ).json();
    const top = await get('sort=balance');
    assert.deepEqual(
      top.people.slice(0, 2).map((p) => [p.id, p.balance]),
      [
        ['user_b', 900],
        ['user_a', 300],
      ],
    );
    assert.ok(top.people.every((p) => p.kind === 'person'));
    assert.equal(top.more, false);
    assert.equal((await get('sort=balance&offset=1')).people[0].id, 'user_a');
    assert.ok((await get('')).people.some((p) => p.kind === 'channel'));
  },
);
