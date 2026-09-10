/**
 * Isolated channel cosmetics/story reward regressions using real TypeScript and migrations.
 * Run from the project directory: node --test tests/boost-rewards.test.mjs
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
  const objects = new Map();
  const bucket = {
    async head(id) {
      const value = objects.get(id);
      return value ? { size: value.length } : null;
    },
    async get(id) {
      const value = objects.get(id);
      return value
        ? { arrayBuffer: async () => Uint8Array.from(value).buffer }
        : null;
    },
  };
  const modules = new Map();
  const allowed = new Set([
    'lib/boosts.ts',
    'lib/boost-access.ts',
    'lib/boost-rules.ts',
    'lib/premium-access.ts',
    'lib/presence-privacy.ts',
    'lib/profile-background.ts',
    'lib/premium-predicate.ts',
    'lib/premium-emoji.ts',
    'lib/premium-emoji-access.ts',
    'lib/account-access.ts',
    'lib/channel-access.ts',
    'lib/privacy.ts',
    'lib/chat-files.ts',
    'lib/chat-access.ts',
    'lib/api-error.ts',
    'lib/premium.ts',
    'lib/stories.ts',
    'lib/media-access.ts',
    'lib/avatar-media.ts',
    'lib/appearance.ts',
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
        import { appearanceColumns, premiumActive } from './premium-access';
        import { visibleLastSeen } from './presence-privacy';
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
        bucket: () => bucket,
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
    objects,
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
  ctx.appearance = async (actor = 'owner', patch = {}, target = 'channel') => {
    const response = await load('lib/premium.ts').premiumPost(
      'appearance',
      {
        id: target,
        theme: 'aurora',
        nameGradient: false,
        ringText: '',
        avatarMotion: '',
        ...patch,
      },
      actor,
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  ctx.publish = async (actor = 'owner', patch = {}, target = 'channel') => {
    const response = await load('lib/stories.ts').storiesPost(
      'story',
      { channelId: target, text: 'QA story', ...patch },
      actor,
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  ctx.storyPost = async (action, id, actor = 'owner', patch = {}) => {
    const response = await load('lib/stories.ts').storiesPost(
      action,
      { id, ...patch },
      actor,
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  ctx.storyGet = async (
    action = 'stories',
    actor = 'owner',
    id = 'channel',
  ) => {
    const response = await load('lib/stories.ts').storiesGet(
      action,
      new URLSearchParams({ id }),
      actor,
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  ctx.channelLevel = async (level) => {
    for (let donor = 1; donor <= level; donor++) {
      const id = 'donor' + donor;
      ctx.person(id);
      ctx.premium(id);
      await ctx.post([1, 2, 3, 4], 'channel', id);
    }
    assert.equal(ctx.count().level, level);
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

function savedAppearance(f, id = 'channel') {
  const row = f.sql
    .prepare('SELECT * FROM profile_appearance WHERE userId=?')
    .get(id);
  return row ? { ...row } : null;
}
function expireDonors(f) {
  f.sql
    .prepare(
      "UPDATE premium_entitlements SET expiresAt=? WHERE userId LIKE 'donor%'",
    )
    .run(Math.floor(f.clock.now / 1000) * 1000);
}
function upload(f, id, owner, type, data = [0, 1, 2, 3]) {
  f.sql
    .prepare(
      "INSERT INTO uploads(id,userId,type,name,created,state) VALUES(?,?,?,?,?,'ready')",
    )
    .run(id, owner, type, id, f.clock.now);
  f.objects.set(id, Uint8Array.from(data));
}

for (const actor of ['owner', 'admin']) {
  scenario(
    'level 1 channel colors allowed for ' + actor + ' without personal Premium',
    async (f) => {
      f.member('admin');
      await f.channelLevel(1);
      const result = await f.appearance(actor);
      assert.equal(result.profileTheme, 'aurora');
      assert.equal(result.boostLevel, 1);
      assert.equal(result.premium, 0);
      assert.equal(result.verified, 0);
      assert.equal(savedAppearance(f).theme, 'aurora');
    },
  );
}
for (const actor of ['editor', 'outsider']) {
  scenario(
    'even level 5 channel cosmetics forbidden for ' + actor,
    async (f) => {
      f.member('editor', 'editor');
      await f.channelLevel(5);
      await rejectsApi(f, () => f.appearance(actor), 403);
      assert.equal(savedAppearance(f), null);
    },
  );
}
scenario(
  'level zero cannot change cosmetics; arbitrary personal id cannot be impersonated',
  async (f) => {
    await rejectsApi(f, () => f.appearance(), 403);
    await rejectsApi(f, () => f.appearance('owner', {}, 'alice'), 403);
  },
);
scenario(
  'personal Premium appearance behavior unchanged and non-Premium fails',
  async (f) => {
    const result = await f.appearance(
      'alice',
      {
        nameGradient: true,
        chromeFlow: true,
        chromeTempo: 6,
        ringText: 'MOON',
      },
      'alice',
    );
    assert.equal(result.premium, 1);
    assert.equal(result.nameGradient, 1);
    assert.equal(result.chromeFlow, 1);
    assert.equal(result.ringText, 'MOON');
    await rejectsApi(f, () => f.appearance('bob', {}, 'bob'), 403);
  },
);
scenario(
  'ignored premium/verified input never grants channel Premium badge or entitlement',
  async (f) => {
    await f.channelLevel(1);
    const result = await f.appearance('owner', {
      premium: true,
      verified: true,
    });
    assert.equal(result.premium, 0);
    assert.equal(result.verified, 0);
    assert.equal(
      f.sql
        .prepare(
          'SELECT COUNT(*) AS n FROM premium_entitlements WHERE userId=?',
        )
        .get('channel').n,
      0,
    );
  },
);
/** @type {Array<[number, Record<string, unknown>, string]>} */
const unlockCases = [
  [2, { nameGradient: true }, 'nameGradient'],
  [3, { chromeFlow: true, chromeTempo: 6 }, 'chromeFlow'],
  [4, { ringText: 'NOCT CHANNEL' }, 'ringText'],
];
for (const [level, patch, field] of unlockCases) {
  scenario(field + ' unlocks exactly at level ' + level, async (f) => {
    await f.channelLevel(level - 1);
    await rejectsApi(f, () => f.appearance('owner', patch), 403);
    f.person('lastdonor');
    f.premium('lastdonor');
    await f.post([1, 2, 3, 4], 'channel', 'lastdonor');
    const result = await f.appearance('owner', patch);
    assert.ok(result[field]);
  });
}
scenario(
  'level 5 motion requires owner upload and static poster; persists playable avatar',
  async (f) => {
    await f.channelLevel(5);
    upload(f, 'motion', 'owner', 'image/gif');
    upload(f, 'poster', 'owner', 'image/png');
    const result = await f.appearance('owner', {
      avatarMotion: '/api/media/motion',
      poster: '/api/media/poster',
    });
    assert.equal(result.avatarMotion, '/api/media/motion');
    assert.equal(result.avatarMotionType, 'image/gif');
    assert.equal(result.avatar, '/api/media/poster');
    assert.equal(result.premium, 0);
    upload(f, 'foreignmotion', 'outsider', 'image/gif');
    await rejectsApi(
      f,
      () =>
        f.appearance('owner', {
          avatarMotion: '/api/media/foreignmotion',
          poster: '/api/media/poster',
        }),
      400,
    );
  },
);
scenario('level 4 cannot assign animation or poster', async (f) => {
  await f.channelLevel(4);
  upload(f, 'motion', 'owner', 'image/gif');
  upload(f, 'poster', 'owner', 'image/png');
  await rejectsApi(
    f,
    () =>
      f.appearance('owner', {
        avatarMotion: '/api/media/motion',
        poster: '/api/media/poster',
      }),
    403,
  );
});
scenario(
  'lower level saves preserve all locked design choices and restore after renewed boosts',
  async (f) => {
    await f.channelLevel(5);
    upload(f, 'motion', 'owner', 'image/gif');
    upload(f, 'poster', 'owner', 'image/png');
    await f.appearance('owner', {
      nameGradient: true,
      chromeFlow: true,
      chromeTempo: 6,
      ringText: 'MOON',
      avatarMotion: '/api/media/motion',
      poster: '/api/media/poster',
    });
    const before = savedAppearance(f);
    f.sql
      .prepare(
        "UPDATE premium_entitlements SET revokedAt=? WHERE userId IN('donor2','donor3','donor4','donor5')",
      )
      .run(f.clock.now);
    const low = await f.appearance('owner', {
      theme: 'ocean',
      nameGradient: false,
      chromeFlow: false,
      ringText: '',
      avatarMotion: '',
    });
    assert.equal(low.boostLevel, 1);
    assert.equal(low.nameGradient, 0);
    assert.equal(low.chromeFlow, 0);
    assert.equal(low.ringText, '');
    assert.equal(low.avatarMotion, '');
    const saved = savedAppearance(f);
    for (const key of [
      'nameGradient',
      'chromeFlow',
      'chromeTempo',
      'ringText',
      'avatarMotion',
      'avatarMotionType',
    ])
      assert.equal(saved[key], before[key], key);
    assert.equal(saved.theme, 'ocean');
    f.sql
      .prepare(
        "UPDATE premium_entitlements SET revokedAt=0 WHERE userId LIKE 'donor%'",
      )
      .run();
    const restored = await f.load('lib/server.ts').profile('channel', 'owner');
    assert.equal(restored.boostLevel, 5);
    assert.equal(restored.nameGradient, 1);
    assert.equal(restored.ringText, 'MOON');
    assert.equal(restored.avatarMotion, '/api/media/motion');
  },
);
for (const mutation of [
  'role',
  'expiry',
  'actor-read-only',
  'owner-read-only',
  'channel-read-only',
]) {
  scenario('cosmetic atomic save rechecks ' + mutation, async (f) => {
    f.member('admin');
    await f.channelLevel(1);
    f.onceBefore(
      /INSERT INTO profile_appearance/,
      () => {
        if (mutation === 'role')
          f.sql
            .prepare('DELETE FROM channel_members WHERE userId=?')
            .run('admin');
        if (mutation === 'expiry') expireDonors(f);
        if (mutation === 'actor-read-only') f.restrict('admin');
        if (mutation === 'owner-read-only') f.restrict('owner');
        if (mutation === 'channel-read-only') f.restrict('channel');
      },
      'batch',
    );
    await rejectsApi(f, () => f.appearance('admin'), 403);
    assert.equal(savedAppearance(f), null);
  });
}
scenario(
  'reward-specific level rechecked after level 2 -> level 1 interleaving',
  async (f) => {
    await f.channelLevel(2);
    f.onceBefore(
      /INSERT INTO profile_appearance/,
      () =>
        f.sql
          .prepare('UPDATE premium_entitlements SET revokedAt=? WHERE userId=?')
          .run(f.clock.now, 'donor2'),
      'batch',
    );
    await rejectsApi(
      f,
      () => f.appearance('owner', { nameGradient: true }),
      403,
    );
    assert.equal(savedAppearance(f), null);
  },
);
scenario('personal Premium revoked at commit cannot save design', async (f) => {
  f.onceBefore(
    /INSERT INTO profile_appearance/,
    () =>
      f.sql
        .prepare('UPDATE premium_entitlements SET revokedAt=? WHERE userId=?')
        .run(f.clock.now, 'alice'),
    'batch',
  );
  await rejectsApi(f, () => f.appearance('alice', {}, 'alice'), 403);
  assert.equal(savedAppearance(f, 'alice'), null);
});

for (const actor of ['owner', 'admin', 'editor']) {
  scenario(
    'channel story publish permissions allow ' +
      actor +
      ' and record publisher',
    async (f) => {
      f.member('admin');
      f.member('editor', 'editor');
      await f.channelLevel(1);
      const { id } = await f.publish(actor);
      const row = f.sql.prepare('SELECT * FROM stories WHERE id=?').get(id);
      assert.equal(row.userId, 'channel');
      assert.equal(row.publisherId, actor);
      assert.equal(row.expiresAt - row.created, DAY);
      const items = await f.storyGet('stories', 'outsider');
      assert.equal(items.length, 1);
      assert.equal(items[0].kind, 'channel');
      assert.equal(items[0].boostLevel, 1);
      assert.equal(items[0].premium, 0);
      assert.equal(items[0].canManage, 0);
      assert.equal(items[0].views, null);
    },
  );
}
scenario(
  'outsider, personal target forgery, and level zero cannot publish channel stories',
  async (f) => {
    await rejectsApi(f, () => f.publish('owner'), 409);
    await f.channelLevel(1);
    await rejectsApi(f, () => f.publish('outsider'), 403);
    await rejectsApi(f, () => f.publish('owner', {}, 'alice'), 403);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM stories').get().n, 0);
  },
);
scenario(
  'channel quota shared across team and deletion does not refund rolling allocation',
  async (f) => {
    f.member('editor', 'editor');
    await f.channelLevel(2);
    const a = await f.publish('owner'),
      b = await f.publish('editor');
    await rejectsApi(f, () => f.publish('owner'), 409);
    await f.storyPost('deleteStory', a.id);
    await rejectsApi(f, () => f.publish('editor'), 409);
    assert.equal((await f.storyGet()).length, 1);
    assert.equal(
      f.sql.prepare('SELECT deletedAt FROM stories WHERE id=?').get(a.id)
        .deletedAt,
      f.clock.now,
    );
    assert.ok(b.id);
  },
);
scenario(
  'concurrent owner/admin/editor publication cannot exceed one remaining quota',
  async (f) => {
    f.member('admin');
    f.member('editor', 'editor');
    await f.channelLevel(1);
    const results = await Promise.allSettled(
      ['owner', 'admin', 'editor'].map((a) => f.publish(a)),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const row of results.filter((r) => r.status === 'rejected')) {
      assert.ok(row.reason instanceof f.ApiError);
      assert.equal(row.reason.status, 409);
    }
    assert.equal(
      f.sql
        .prepare('SELECT COUNT(*) AS n FROM stories WHERE userId=?')
        .get('channel').n,
      1,
    );
  },
);
scenario(
  'rolling quota resets after 24h server boundary, not date rollover',
  async (f) => {
    f.clock.now = Math.floor(f.clock.now / 1000) * 1000;
    await f.channelLevel(1);
    const start = f.clock.now;
    await f.publish();
    f.clock.now = start + DAY - 1000;
    await rejectsApi(f, () => f.publish(), 409);
    f.clock.now = start + DAY;
    await f.publish();
    assert.equal(
      f.sql
        .prepare('SELECT COUNT(*) AS n FROM stories WHERE userId=?')
        .get('channel').n,
      2,
    );
  },
);
scenario(
  'expired Premium lowers story quota without deleting live stories',
  async (f) => {
    await f.channelLevel(1);
    const created = await f.publish();
    expireDonors(f);
    const items = await f.storyGet();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, created.id);
    assert.equal(items[0].boostLevel, 0);
    await rejectsApi(f, () => f.publish(), 409);
  },
);
for (const mutation of [
  'role',
  'expiry',
  'actor-read-only',
  'owner-read-only',
  'channel-read-only',
  'actor-deleted',
]) {
  scenario('story INSERT atomically rechecks ' + mutation, async (f) => {
    f.member('editor', 'editor');
    await f.channelLevel(1);
    f.onceBefore(/INSERT INTO stories/, () => {
      if (mutation === 'role')
        f.sql
          .prepare('DELETE FROM channel_members WHERE userId=?')
          .run('editor');
      if (mutation === 'expiry') expireDonors(f);
      if (mutation === 'actor-read-only') f.restrict('editor');
      if (mutation === 'owner-read-only') f.restrict('owner');
      if (mutation === 'channel-read-only') f.restrict('channel');
      if (mutation === 'actor-deleted')
        f.sql
          .prepare('UPDATE users SET deletedAt=? WHERE id=?')
          .run(f.clock.now, 'editor');
    });
    await rejectsApi(f, () => f.publish('editor'), 409);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM stories').get().n, 0);
  });
}
scenario(
  'read-only member may read/view/report stories but cannot publish or delete',
  async (f) => {
    f.member('editor', 'editor');
    await f.channelLevel(1);
    const { id } = await f.publish('editor');
    f.restrict('editor');
    assert.equal((await f.storyGet('stories', 'editor')).length, 1);
    await f.storyPost('viewStory', id, 'editor');
    await f.storyPost('reportStory', id, 'editor', {
      reason: 'Fixture report',
    });
    await rejectsApi(f, () => f.publish('editor'), 403);
    await rejectsApi(f, () => f.storyPost('deleteStory', id, 'editor'), 403);
  },
);
scenario(
  'owner/admin manage all channel stories; editor manages only their own',
  async (f) => {
    f.member('admin');
    f.member('editor', 'editor');
    await f.channelLevel(3);
    const a = await f.publish('owner'),
      b = await f.publish('editor'),
      c = await f.publish('admin');
    const ed = await f.storyGet('stories', 'editor');
    assert.equal(ed.find((s) => s.id === a.id).canManage, 0);
    assert.equal(ed.find((s) => s.id === b.id).canManage, 1);
    await rejectsApi(f, () => f.storyPost('deleteStory', a.id, 'editor'), 403);
    await f.storyPost('deleteStory', b.id, 'editor');
    await f.storyPost('deleteStory', a.id, 'admin');
    await f.storyPost('deleteStory', c.id, 'owner');
    assert.equal((await f.storyGet()).length, 0);
  },
);
scenario(
  'revoked editor loses deletion/viewer-list right for previously published story',
  async (f) => {
    f.member('editor', 'editor');
    await f.channelLevel(1);
    const { id } = await f.publish('editor');
    f.sql.prepare('DELETE FROM channel_members WHERE userId=?').run('editor');
    assert.equal((await f.storyGet('stories', 'editor'))[0].canManage, 0);
    await rejectsApi(f, () => f.storyPost('deleteStory', id, 'editor'), 403);
    await rejectsApi(f, () => f.storyGet('storyViewers', 'editor', id), 403);
  },
);
scenario(
  'delete commit rechecks role revoked after initial story lookup',
  async (f) => {
    f.member('editor', 'editor');
    await f.channelLevel(1);
    const { id } = await f.publish('editor');
    f.onceBefore(/UPDATE stories SET deletedAt/, () =>
      f.sql.prepare('DELETE FROM channel_members WHERE userId=?').run('editor'),
    );
    await rejectsApi(f, () => f.storyPost('deleteStory', id, 'editor'), 403);
    assert.equal(
      f.sql.prepare('SELECT deletedAt FROM stories WHERE id=?').get(id)
        .deletedAt,
      0,
    );
  },
);
scenario(
  'deleted, expired, blocked and personally hidden channel stories disappear',
  async (f) => {
    await f.channelLevel(1);
    const { id } = await f.publish();
    f.block('outsider', 'owner');
    assert.equal((await f.storyGet('stories', 'outsider')).length, 0);
    f.restrict('channel', 'blocked');
    assert.equal((await f.storyGet()).length, 0);
    f.sql
      .prepare('DELETE FROM account_restrictions WHERE userId=?')
      .run('channel');
    f.clock.now += DAY + 1000;
    assert.equal((await f.storyGet()).length, 0);
    await rejectsApi(f, () => f.storyPost('viewStory', id, 'outsider'), 404);
  },
);
scenario(
  'views deduplicate; outsiders cannot read identities; team can',
  async (f) => {
    f.member('admin');
    await f.channelLevel(1);
    const { id } = await f.publish();
    await f.storyPost('viewStory', id, 'outsider');
    await f.storyPost('viewStory', id, 'outsider');
    assert.equal(
      f.sql
        .prepare('SELECT COUNT(*) AS n FROM story_views WHERE storyId=?')
        .get(id).n,
      1,
    );
    const viewers = await f.storyGet('storyViewers', 'admin', id);
    assert.deepEqual(
      viewers.map((v) => v.id),
      ['outsider'],
    );
    assert.equal((await f.storyGet())[0].views, 1);
    await rejectsApi(f, () => f.storyGet('storyViewers', 'outsider', id), 403);
  },
);
scenario(
  'viewer identities never disclosed when admin role revoked just before read',
  async (f) => {
    f.member('admin');
    await f.channelLevel(1);
    const { id } = await f.publish();
    await f.storyPost('viewStory', id, 'outsider');
    f.onceBefore(
      /FROM story_views v JOIN users u/,
      () =>
        f.sql
          .prepare('DELETE FROM channel_members WHERE userId=?')
          .run('admin'),
      'all',
    );
    try {
      const rows = await f.storyGet('storyViewers', 'admin', id);
      assert.deepEqual(
        rows,
        [],
        'Former admin must not receive viewer identities after role revocation',
      );
    } catch (e) {
      if (!(e instanceof f.ApiError)) throw e;
      assert.equal(e.status, 403);
    }
  },
);
scenario(
  'media story enforces uploader ownership and ready state without network',
  async (f) => {
    await f.channelLevel(1);
    upload(f, 'foreign', 'outsider', 'image/png');
    await rejectsApi(f, () => f.publish('owner', { mediaId: 'foreign' }), 400);
    upload(f, 'mine', 'owner', 'image/png');
    f.sql.prepare("UPDATE uploads SET state='pending' WHERE id=?").run('mine');
    await rejectsApi(f, () => f.publish('owner', { mediaId: 'mine' }), 409);
    f.sql.prepare("UPDATE uploads SET state='ready' WHERE id=?").run('mine');
    const { id } = await f.publish('owner', { mediaId: 'mine' });
    assert.equal(
      f.sql.prepare('SELECT mediaId FROM stories WHERE id=?').get(id).mediaId,
      'mine',
    );
  },
);
scenario(
  'personal stories retain cap 20 and own deletion releases active quota',
  async (f) => {
    const first = await f.publish('bob', {}, 'bob');
    for (let n = 1; n < 20; n++) await f.publish('bob', {}, 'bob');
    await rejectsApi(f, () => f.publish('bob', {}, 'bob'), 409);
    await f.storyPost('deleteStory', first.id, 'bob');
    await f.publish('bob', {}, 'bob');
    assert.equal((await f.storyGet('stories', 'bob', 'bob')).length, 20);
  },
);
for (const mutation of ['story-deleted', 'channel-blocked']) {
  scenario(
    'viewer identity disclosure rechecks ' +
      mutation +
      ' after initial access lookup',
    async (f) => {
      f.member('admin');
      await f.channelLevel(1);
      const { id } = await f.publish();
      await f.storyPost('viewStory', id, 'outsider');
      f.onceBefore(
        /FROM story_views v JOIN users u/,
        () => {
          if (mutation === 'story-deleted')
            f.sql
              .prepare('UPDATE stories SET deletedAt=? WHERE id=?')
              .run(f.clock.now, id);
          if (mutation === 'channel-blocked') f.restrict('channel', 'blocked');
        },
        'all',
      );
      try {
        const rows = await f.storyGet('storyViewers', 'admin', id);
        assert.deepEqual(
          rows,
          [],
          'Inaccessible story must not disclose viewer identities',
        );
      } catch (e) {
        if (!(e instanceof f.ApiError)) throw e;
        assert.ok([403, 404].includes(e.status));
      }
    },
  );
}
// Append to tests/boost-rewards.test.mjs. Uses its existing isolated fixture.
function recordStoryRemovalFixture(f, row, deleteSource = true) {
  // Match the relevant atomic part of removeContent: immutable original snapshot
  // followed by physical deletion. Text-only stories do not need R2 evidence.
  f.sql.exec('BEGIN IMMEDIATE');
  try {
    f.sql
      .prepare(`INSERT INTO content_removals
      (id,targetType,targetId,postId,authorId,moderatorId,text,snapshot,reason,created)
      VALUES(?,'story',?,'',?,'outsider',?,?,?,?)`)
      .run(
        randomUUID(),
        row.id,
        row.userId,
        row.text,
        JSON.stringify(row),
        'Fixture moderation decision',
        f.clock.now,
      );
    if (deleteSource)
      f.sql.prepare('DELETE FROM stories WHERE id=?').run(row.id);
    f.sql.exec('COMMIT');
  } catch (error) {
    f.sql.exec('ROLLBACK');
    throw error;
  }
}

scenario(
  'moderator physical removal preserves channel quota until original 24h boundary',
  async (f) => {
    f.clock.now = Math.floor(f.clock.now / 1000) * 1000;
    await f.channelLevel(1);
    const start = f.clock.now;
    const { id } = await f.publish();
    const original = f.sql.prepare('SELECT * FROM stories WHERE id=?').get(id);
    // Moderation happens later; the quota must expire relative to publication,
    // not remain charged for another 24 hours after the moderation decision.
    f.clock.now = start + 6 * 3600000;
    recordStoryRemovalFixture(f, original);
    assert.equal(
      f.sql.prepare('SELECT id FROM stories WHERE id=?').get(id),
      undefined,
    );
    const evidence = f.sql
      .prepare('SELECT snapshot FROM content_removals WHERE targetId=?')
      .get(id);
    assert.equal(JSON.parse(evidence.snapshot).created, start);
    await rejectsApi(f, () => f.publish(), 409);
    f.clock.now = start + DAY - 1;
    await rejectsApi(f, () => f.publish(), 409);
    f.clock.now = start + DAY;
    const next = await f.publish();
    assert.ok(next.id);
    assert.equal(
      f.sql
        .prepare('SELECT COUNT(*) AS n FROM stories WHERE userId=?')
        .get('channel').n,
      1,
    );
  },
);

scenario(
  'recent removal of an old story snapshot does not spend current channel quota',
  async (f) => {
    f.clock.now = Math.floor(f.clock.now / 1000) * 1000;
    await f.channelLevel(1);
    const { id } = await f.publish();
    const oldCreated = f.clock.now - DAY - 1000;
    f.sql
      .prepare('UPDATE stories SET created=?,expiresAt=? WHERE id=?')
      .run(oldCreated, oldCreated + DAY, id);
    const old = f.sql.prepare('SELECT * FROM stories WHERE id=?').get(id);
    recordStoryRemovalFixture(f, old);
    const evidence = f.sql
      .prepare('SELECT created,snapshot FROM content_removals WHERE targetId=?')
      .get(id);
    assert.equal(evidence.created, f.clock.now);
    assert.equal(JSON.parse(evidence.snapshot).created, oldCreated);
    await f.publish();
    // The newly published story still consumes the one current slot.
    await rejectsApi(f, () => f.publish(), 409);
  },
);

scenario(
  'same story present in source and removal evidence consumes exactly one quota slot',
  async (f) => {
    f.clock.now = Math.floor(f.clock.now / 1000) * 1000;
    await f.channelLevel(2);
    const { id } = await f.publish();
    const original = f.sql.prepare('SELECT * FROM stories WHERE id=?').get(id);
    // Deliberate overlapping fixture to verify UNION identity semantics;
    // a normal atomic moderation transaction does not expose this midpoint.
    recordStoryRemovalFixture(f, original, false);
    const second = await f.publish();
    assert.notEqual(second.id, id);
    assert.equal(
      f.sql
        .prepare('SELECT COUNT(*) AS n FROM stories WHERE userId=?')
        .get('channel').n,
      2,
    );
    await rejectsApi(f, () => f.publish(), 409);
  },
);
