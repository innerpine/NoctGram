/**
 * Isolated regressions against current Noctgram boost TypeScript and real migrations.
 * Run from the project directory: node --test tests/boosts.test.mjs
 * The file may also be copied into tests/. No network, secrets, Worker or disk DB.
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
].find((p) => existsSync(join(p, 'lib/boosts.ts')));
assert.ok(root, 'Run from the project directory or place the file in tests/.');
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const sources = new Map();
function source(file) {
  if (!sources.has(file))
    sources.set(file, readFileSync(join(root, file), 'utf8'));
  return sources.get(file);
}
const journal = JSON.parse(source('drizzle/meta/_journal.json')).entries;
assert.ok(
  journal.some((e) => e.tag.startsWith('0017_')),
  'Boost migration must be journaled.',
);
const migrations = journal.map((e) => [
  e.tag,
  source('drizzle/' + e.tag + '.sql'),
]);
const NOW = Date.UTC(2026, 8, 8, 12, 0, 0, 875);
const DAY = 86400000;
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
  for (const [tag, text] of migrations) {
    try {
      sql.exec(text);
    } catch (cause) {
      throw new Error('Migration failed: ' + tag, { cause });
    }
  }
  sql.exec('PRAGMA foreign_keys=ON');
  const hooks = { beforeOperation: null };
  const adapter = {
    prepare(text) {
      const statement = (args) => ({
        text,
        args,
        bind(...values) {
          return statement(values);
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
          const row = sql.prepare(text).run(...args);
          return {
            success: true,
            meta: {
              changes: Number(row.changes),
              last_row_id: Number(row.lastInsertRowid),
            },
          };
        },
      });
      return statement([]);
    },
    async batch(statements) {
      await Promise.resolve();
      sql.exec('BEGIN IMMEDIATE');
      try {
        const rows = statements.map((s) => {
          hooks.beforeOperation?.('batch', s.text, s.args);
          const row = sql.prepare(s.text).run(...s.args);
          return { success: true, meta: { changes: Number(row.changes) } };
        });
        sql.exec('COMMIT');
        return rows;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const modules = new Map();
  const allowed = new Set([
    'lib/boosts.ts',
    'lib/boost-access.ts',
    'lib/boost-rules.ts',
    'lib/premium-access.ts',
    'lib/premium-predicate.ts',
    'lib/premium-emoji.ts',
    'lib/premium-emoji-access.ts',
    'lib/account-access.ts',
    'lib/channel-access.ts',
    'lib/privacy.ts',
    'lib/chat-files.ts',
    'lib/chat-access.ts',
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
      const target = specifier.startsWith('@/')
        ? resolve(root, specifier.slice(2))
        : specifier.startsWith('.')
          ? resolve(root, dirname(file), specifier)
          : null;
      assert.ok(target, 'Unexpected dependency: ' + specifier);
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
      () => {
        throw new Error('Real network forbidden.');
      },
    );
    return loadedModule.exports;
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    if (file === 'lib/auth-session.ts') return { setting: () => '1' };
    if (file === 'lib/storage.ts') return { db: () => adapter };
    if (file === 'lib/server.ts') {
      // Actual clean and profile functions, without framework/server initialization.
      const result = evaluate(
        file,
        `
        import { ApiError } from './api-error';
        import { appearanceColumns } from './premium-access';
        import { visibleAccount,blockingRestriction,restriction,isModerator } from './account-access';
        import { channelRights } from './channel-access';
        import { db } from './storage';
        async function isAdministrator(id:string) { return !!(await db().prepare('SELECT userId FROM administrators WHERE userId=?').bind(id).first()); }
        ${declaration(file, 'clean')}
        ${declaration(file, 'profile')}
      `,
      );
      return Object.assign(result, {
        db: () => adapter,
        ApiError: load('lib/api-error.ts').ApiError,
      });
    }
    assert.ok(allowed.has(file), 'Unexpected module: ' + file);
    return evaluate(file, source(file));
  }
  const boosts = load('lib/boosts.ts'),
    access = load('lib/boost-access.ts');
  const { ApiError } = load('lib/api-error.ts');
  const ctx = {
    sql,
    clock,
    hooks,
    load,
    boosts,
    access,
    ApiError,
    person(id) {
      sql
        .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
        .run(id, 'Name ' + id, NOW - DAY);
      sql
        .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
        .run(id, id);
    },
    channel(id, owner = 'owner') {
      sql
        .prepare(
          "INSERT INTO users(id,name,created,kind,ownerId) VALUES(?,?,?,'channel',?)",
        )
        .run(id, 'Channel ' + id, NOW - DAY, owner);
      sql
        .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
        .run(id, id);
    },
    premium(id = 'alice', expiresAt = clock.now + 30 * DAY) {
      sql
        .prepare(
          "INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) VALUES(?,?,?,'test',?) ON CONFLICT(userId) DO UPDATE SET startsAt=excluded.startsAt,expiresAt=excluded.expiresAt,revokedAt=0",
        )
        .run(
          id,
          Math.floor(clock.now / 1000) * 1000 - DAY,
          expiresAt,
          clock.now - DAY,
        );
    },
    restrict(id, mode = 'read_only', expiresAt = null) {
      const event = randomUUID();
      sql
        .prepare(
          'INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,?,?,?,?)',
        )
        .run(event, id, 'outsider', mode, 'Fixture restriction', clock.now);
      sql
        .prepare(
          'INSERT INTO account_restrictions(userId,eventId,mode,reason,expiresAt,created) VALUES(?,?,?,?,?,?)',
        )
        .run(id, event, mode, 'Fixture restriction', expiresAt, clock.now);
    },
    block(blocker, blocked) {
      sql
        .prepare(
          'INSERT INTO user_blocks(blocker,blocked,created) VALUES(?,?,?)',
        )
        .run(blocker, blocked, clock.now);
    },
    member(userId, role = 'admin') {
      sql
        .prepare(
          'INSERT INTO channel_members(channelId,userId,role,created) VALUES(?,?,?,?)',
        )
        .run('channel', userId, role, clock.now);
    },
    row(slot = 1, user = 'alice') {
      const row = sql
        .prepare('SELECT * FROM channel_boost_slots WHERE userId=? AND slot=?')
        .get(user, slot);
      return row ? { ...row } : null;
    },
    allRows(user = 'alice') {
      return sql
        .prepare(
          'SELECT * FROM channel_boost_slots WHERE userId=? ORDER BY slot',
        )
        .all(user)
        .map((v) => ({ ...v }));
    },
    count(id = 'channel') {
      return sql
        .prepare(
          `SELECT ${access.activeBoosts('u.id')} AS count,${access.channelLevel('u')} AS level FROM users u WHERE u.id=?`,
        )
        .get(id);
    },
    async get(id = 'channel', actor = 'alice', params = {}) {
      const response = await boosts.boostsGet(
        'boosts',
        new URLSearchParams({ id, ...params }),
        actor,
      );
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
      return response.json();
    },
    async post(slots = [1], id = 'channel', actor = 'alice') {
      const response = await boosts.boostsPost('boost', { id, slots }, actor);
      assert.equal(response.status, 200);
      return response.json();
    },
    onceBefore(pattern, mutate, operation = 'run') {
      hooks.beforeOperation = (op, text, args) => {
        if (op === operation && pattern.test(text)) {
          hooks.beforeOperation = null;
          mutate(text, args);
        }
      };
    },
  };
  for (const id of [
    'alice',
    'bob',
    'owner',
    'otherowner',
    'outsider',
    'admin',
    'editor',
  ])
    ctx.person(id);
  ctx.channel('channel');
  ctx.channel('other', 'otherowner');
  ctx.premium();
  t.after(() => {
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    sql.close();
  });
  return ctx;
}
function scenario(name, fn) {
  void test(name, { concurrency: false, timeout: 15000 }, (t) =>
    fn(fixture(t), t),
  );
}
async function rejectsApi(f, task, statuses) {
  const allowed = Array.isArray(statuses) ? statuses : [statuses];
  await assert.rejects(task, (error) => {
    assert.ok(error instanceof f.ApiError, String(error?.stack || error));
    assert.ok(
      allowed.includes(error.status),
      'Unexpected API status: ' + error.status,
    );
    return true;
  });
}

scenario(
  'GET and POST execute all actual status/profile SQL; four slots yield level one',
  async (f) => {
    const initial = await f.get();
    assert.equal(initial.premium, true);
    assert.equal(initial.count, 0);
    assert.deepEqual(
      initial.slots.map((s) => [s.slot, s.channelId, s.availableAt]),
      [
        [1, null, 0],
        [2, null, 0],
        [3, null, 0],
        [4, null, 0],
      ],
    );
    const result = await f.post([1, 2, 3, 4]);
    assert.equal(result.count, 4);
    assert.equal(result.level, 1);
    assert.equal(result.nextThreshold, 8);
    assert.equal(result.maxLevel, 5);
    assert.equal(result.profile.id, 'channel');
    assert.equal(result.profile.boostLevel, 1);
    assert.equal(
      result.profile.premium,
      0,
      'Boosted channel must not become a Premium person.',
    );
    assert.equal(f.allRows().length, 4);
    assert.deepEqual(
      result.slots.map((s) => s.channel.id),
      Array(4).fill('channel'),
    );
  },
);

scenario(
  'slots reject duplicates, out of range, fractional, strings, empty and non-array values',
  async (f) => {
    for (const input of [
      [],
      [1, 1],
      [0],
      [5],
      [1.5],
      ['1'],
      [null],
      [true],
      [1, 2, 3, 4, 5],
      null,
      '1',
    ])
      await rejectsApi(f, () => f.post(input), 400);
    assert.deepEqual(f.allRows(), []);
  },
);

scenario(
  'no Premium, future entitlement and personal targets cannot receive assignments',
  async (f) => {
    await rejectsApi(f, () => f.post([1], 'channel', 'bob'), 409);
    f.premium('bob');
    f.sql
      .prepare('UPDATE premium_entitlements SET startsAt=? WHERE userId=?')
      .run(f.clock.now + DAY, 'bob');
    await rejectsApi(f, () => f.post([1], 'channel', 'bob'), 409);
    await rejectsApi(f, () => f.post([1], 'owner'), 409);
    await rejectsApi(f, () => f.get('owner'), 404);
    await rejectsApi(f, () => f.post([1], 'missing'), 404);
    assert.deepEqual(f.allRows(), []);
    assert.deepEqual(f.allRows('bob'), []);
  },
);

scenario(
  'same channel retry is idempotent and never extends cooldown',
  async (f) => {
    await f.post([1, 2]);
    const before = f.allRows();
    f.clock.now += 8000;
    await f.post([2, 1]);
    assert.deepEqual(f.allRows(), before);
    assert.equal((await f.get()).count, 2);
  },
);

scenario(
  'batch with one locked slot moves none and allocates no previously free slots',
  async (f) => {
    await f.post([1]);
    const before = f.allRows();
    await rejectsApi(f, () => f.post([2, 3, 4, 1], 'other'), 409);
    assert.deepEqual(f.allRows(), before);
    assert.equal(f.count('other').count, 0);
    await f.post([2, 3, 4], 'other');
    assert.equal(f.count('channel').count, 1);
    assert.equal(f.count('other').count, 3);
  },
);

scenario(
  'cooldown exact server boundary and transfer of four slots preserve global capacity',
  async (f) => {
    await f.post([1, 2, 3, 4]);
    const availableAt = f.row().availableAt;
    f.clock.now = availableAt - 1;
    await rejectsApi(f, () => f.post([1, 2, 3, 4], 'other'), 409);
    f.clock.now = availableAt;
    const result = await f.post([4, 3, 2, 1], 'other');
    assert.equal(result.count, 4);
    assert.equal(f.count('channel').count, 0);
    assert.equal(f.row().availableAt, availableAt + DAY);
    assert.equal(f.allRows().length, 4);
  },
);

scenario(
  'concurrent first assignment to two channels has one winner and one conflict',
  async (f) => {
    const results = await Promise.allSettled([
      f.post([1, 2, 3, 4], 'channel'),
      f.post([1, 2, 3, 4], 'other'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = results.find((r) => r.status === 'rejected');
    assert.ok(rejected.reason instanceof f.ApiError);
    assert.equal(rejected.reason.status, 409);
    assert.equal(f.allRows().length, 4);
    assert.equal(new Set(f.allRows().map((s) => s.channelId)).size, 1);
    assert.equal(f.count('channel').count + f.count('other').count, 4);
  },
);

scenario(
  'Premium expiry/revocation removes contributions without deleting slots or resetting cooldown',
  async (f) => {
    await f.post([1, 2, 3, 4]);
    const before = f.allRows();
    const second = Math.floor(f.clock.now / 1000) * 1000;
    f.sql
      .prepare('UPDATE premium_entitlements SET expiresAt=? WHERE userId=?')
      .run(second, 'alice');
    const state = await f.get();
    assert.equal(state.premium, false);
    assert.equal(state.count, 0);
    assert.equal(state.level, 0);
    assert.deepEqual(f.allRows(), before);
    f.premium();
    assert.equal((await f.get()).count, 4);
    await rejectsApi(f, () => f.post([1], 'other'), 409);
    f.sql
      .prepare('UPDATE premium_entitlements SET revokedAt=? WHERE userId=?')
      .run(f.clock.now, 'alice');
    assert.equal((await f.get()).count, 0);
    assert.deepEqual(f.allRows(), before);
  },
);

for (const mode of ['read_only', 'blocked']) {
  scenario(
    mode +
      ' donor stops contributing, cannot boost; restriction expiry restores old slots',
    async (f) => {
      await f.post([1, 2, 3, 4]);
      const before = f.allRows();
      const expiresAt = Math.floor(f.clock.now / 1000) * 1000 + 5000;
      f.restrict('alice', mode, expiresAt);
      assert.equal((await f.get('channel', 'outsider')).count, 0);
      await rejectsApi(f, () => f.post([1]), 403);
      f.clock.now = expiresAt;
      assert.equal((await f.get()).count, 4);
      assert.deepEqual(f.allRows(), before);
    },
  );
}

scenario(
  'soft-deleted or unonboarded donor contributes nothing even when entitlement remains',
  async (f) => {
    await f.post([1, 2, 3, 4]);
    const before = f.allRows();
    f.sql
      .prepare('UPDATE users SET deletedAt=? WHERE id=?')
      .run(f.clock.now, 'alice');
    assert.equal((await f.get('channel', 'outsider')).count, 0);
    await rejectsApi(f, () => f.post([2], 'other'), 409);
    assert.deepEqual(f.allRows(), before);
    f.sql
      .prepare('UPDATE users SET deletedAt=0,onboardingComplete=0 WHERE id=?')
      .run('alice');
    assert.equal((await f.get('channel', 'outsider')).count, 0);
    await rejectsApi(f, () => f.post([2], 'other'), 409);
  },
);

scenario(
  'deleted channel leaves existing assignment cooldown enforceable on transfer',
  async (f) => {
    await f.post([1]);
    const before = f.row();
    f.sql
      .prepare('UPDATE users SET deletedAt=? WHERE id=?')
      .run(f.clock.now, 'channel');
    await rejectsApi(f, () => f.post([2]), 409);
    await rejectsApi(f, () => f.get(), 404);
    const state = await f.get('other');
    assert.equal(state.slots[0].channel, null);
    assert.equal(state.slots[0].availableAt, before.availableAt);
    await rejectsApi(f, () => f.post([1], 'other'), 409);
    f.clock.now = before.availableAt;
    await f.post([1], 'other');
    assert.equal(f.row().channelId, 'other');
  },
);

for (const entity of ['owner', 'channel']) {
  for (const mode of ['read_only', 'blocked']) {
    scenario(
      entity +
        ' ' +
        mode +
        ' blocks new boost; read-only target reports zero usable level',
      async (f) => {
        await f.post([1, 2, 3, 4]);
        const before = f.allRows();
        f.restrict(entity, mode);
        await rejectsApi(f, () => f.post([1]), mode === 'blocked' ? 403 : 409);
        if (mode === 'blocked') await rejectsApi(f, () => f.get(), 403);
        else {
          const result = await f.get();
          assert.equal(result.count, 0);
          assert.equal(result.level, 0);
        }
        assert.deepEqual(f.allRows(), before);
      },
    );
  }
}

scenario(
  'soft-deleted owner makes channel inactive without allowing assignment',
  async (f) => {
    await f.post([1]);
    f.sql
      .prepare('UPDATE users SET deletedAt=? WHERE id=?')
      .run(f.clock.now, 'owner');
    await rejectsApi(f, () => f.post([2]), 409);
    assert.equal((await f.get()).count, 0);
    assert.equal(f.count().level, 0);
  },
);

for (const direction of ['donor-blocks-owner', 'owner-blocks-donor']) {
  scenario(direction + ' forbids boost and channel status', async (f) => {
    if (direction === 'donor-blocks-owner') f.block('alice', 'owner');
    else f.block('owner', 'alice');
    await rejectsApi(f, () => f.post(), 403);
    await rejectsApi(f, () => f.get(), 403);
    assert.deepEqual(f.allRows(), []);
  });
}

scenario(
  'GET exposes only viewer slots regardless of supplied user/actor and sanitizes blocked channel',
  async (f) => {
    await f.post([1, 2]);
    f.premium('bob');
    await f.post([3], 'other', 'bob');
    const bob = await f.get('channel', 'bob', {
      userId: 'alice',
      actor: 'alice',
    });
    assert.deepEqual(
      bob.slots.map((s) => s.channelId),
      [null, null, 'other', null],
    );
    assert.equal(bob.count, 2);
    assert.deepEqual(bob.boosters, []);
    assert.equal(bob.canManage, false);
    f.block('alice', 'owner');
    const alice = await f.get('other');
    assert.equal(alice.slots[0].channel, null);
    assert.equal(alice.slots[1].channel, null);
  },
);

scenario(
  'booster identities visible to owner/admin only, without slot history or entitlement details',
  async (f) => {
    f.member('admin');
    f.member('editor', 'editor');
    await f.post([1, 2]);
    f.premium('bob');
    await f.post([1, 2, 3, 4], 'channel', 'bob');
    for (const actor of ['alice', 'editor', 'outsider']) {
      const result = await f.get('channel', actor);
      assert.equal(result.canManage, false);
      assert.deepEqual(result.boosters, []);
    }
    for (const actor of ['owner', 'admin']) {
      const result = await f.get('channel', actor);
      assert.equal(result.canManage, true);
      assert.deepEqual(result.boosters.map((v) => [v.id, v.boosts]).sort(), [
        ['alice', 2],
        ['bob', 4],
      ]);
      for (const booster of result.boosters)
        for (const field of [
          'slot',
          'availableAt',
          'changedAt',
          'expiresAt',
          'email',
        ])
          assert.equal(field in booster, false, field + ' must stay private');
    }
    f.block('owner', 'bob');
    const state = await f.get('channel', 'owner');
    assert.deepEqual(
      state.boosters.map((v) => v.id),
      ['alice'],
    );
    assert.equal(
      state.count,
      6,
      'Aggregate is global, separate from personal list visibility.',
    );
  },
);

scenario(
  'levels cap at five, server appearance projection drops rewards immediately',
  async (f) => {
    for (let i = 0; i < 6; i++) {
      const id = 'donor' + i;
      f.person(id);
      f.premium(id);
      await f.post([1, 2, 3, 4], 'channel', id);
    }
    f.sql
      .prepare(
        "INSERT INTO profile_appearance(userId,theme,nameGradient,ringText,chromeFlow,chromeTempo,updated) VALUES('channel','rose',1,'HELLO',1,7,?)",
      )
      .run(f.clock.now);
    let result = await f.get('channel', 'owner');
    assert.equal(result.count, 24);
    assert.equal(result.level, 5);
    assert.equal(result.nextThreshold, null);
    let profile = await f.load('lib/server.ts').profile('channel', 'owner');
    assert.equal(profile.profileTheme, 'rose');
    assert.equal(profile.nameGradient, 1);
    assert.equal(profile.chromeFlow, 1);
    assert.equal(profile.ringText, 'HELLO');
    assert.equal(profile.premium, 0);
    for (let i = 0; i < 5; i++) f.restrict('donor' + i, 'read_only');
    result = await f.get('channel', 'owner');
    assert.equal(result.count, 4);
    assert.equal(result.level, 1);
    profile = await f.load('lib/server.ts').profile('channel', 'owner');
    assert.equal(profile.profileTheme, 'rose');
    assert.equal(profile.nameGradient, 0);
    assert.equal(profile.chromeFlow, 0);
    assert.equal(profile.ringText, '');
    const saved = f.sql
      .prepare('SELECT * FROM profile_appearance WHERE userId=?')
      .get('channel');
    assert.equal(saved.ringText, 'HELLO');
    assert.equal(saved.nameGradient, 1);
  },
);

for (const mutation of [
  'revoke',
  'read_only',
  'deleted',
  'owner-blocked',
  'privacy',
]) {
  scenario(
    'eligibility change immediately before atomic INSERT is enforced: ' +
      mutation,
    async (f) => {
      f.onceBefore(/INSERT INTO channel_boost_slots/, () => {
        if (mutation === 'revoke')
          f.sql
            .prepare(
              'UPDATE premium_entitlements SET revokedAt=? WHERE userId=?',
            )
            .run(f.clock.now, 'alice');
        if (mutation === 'read_only') f.restrict('alice');
        if (mutation === 'deleted')
          f.sql
            .prepare('UPDATE users SET deletedAt=? WHERE id=?')
            .run(f.clock.now, 'alice');
        if (mutation === 'owner-blocked') f.restrict('owner', 'blocked');
        if (mutation === 'privacy') f.block('owner', 'alice');
      });
      await rejectsApi(f, () => f.post([1, 2, 3, 4]), 409);
      assert.deepEqual(f.allRows(), []);
    },
  );
}

scenario(
  'admin role revoked immediately before booster query cannot disclose identities',
  async (f) => {
    await f.post([1, 2]);
    f.member('admin');
    f.onceBefore(
      /COUNT\(\*\) AS boosts/,
      () => {
        f.sql
          .prepare('DELETE FROM channel_members WHERE channelId=? AND userId=?')
          .run('channel', 'admin');
      },
      'all',
    );
    const result = await f.get('channel', 'admin');
    assert.deepEqual(
      result.boosters,
      [],
      'Read must re-check administrator permission at disclosure.',
    );
  },
);
