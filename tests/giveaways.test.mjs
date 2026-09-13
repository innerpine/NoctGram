import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const root = process.cwd();
const tree = process.env.NOCT_GIVEAWAY_SOURCE || root;
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const journal = JSON.parse(
  await readFile(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'),
);
const migrations = await Promise.all(
  journal.entries
    .filter((e) => e.tag !== '0044_giveaways')
    .map((e) => readFile(path.join(root, `drizzle/${e.tag}.sql`), 'utf8')),
);
migrations.push(
  await readFile(path.join(tree, 'drizzle/0044_giveaways.sql'), 'utf8'),
);
const compiled = await build({
  entryPoints: [path.join(tree, 'lib/giveaways.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'isolated-giveaways',
      setup(build) {
        build.onResolve({ filter: /^\.\/storage$/ }, () => ({
          path: 'storage',
          namespace: 'giveaway-test',
        }));
        build.onResolve({ filter: /^\.\/auth-session$/ }, () => ({
          path: 'auth',
          namespace: 'giveaway-test',
        }));
        build.onLoad({ filter: /.*/, namespace: 'giveaway-test' }, (args) => ({
          contents:
            args.path === 'storage'
              ? 'export const db = () => globalThis.__giveawayDb;'
              : "export const setting = () => ''; export async function tokenHash(s) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join(''); }",
        }));
        build.onResolve({ filter: /^\.\// }, async (args) => {
          const candidate = path.resolve(args.resolveDir, args.path + '.ts');
          try {
            await readFile(candidate);
            return undefined;
          } catch {
            return { path: path.join(root, 'lib', args.path + '.ts') };
          }
        });
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations) sql.exec(migration);
  let beforeBatch;
  function statement(query) {
    let args = [];
    const execute = (method) => {
      // D1 numbered bind parameters are positional; Node SQLite treats ?1 as
      // named parameters. Convert just that transport detail for this adapter.
      const numbers = [...query.matchAll(/\?(\d+)/g)].map((m) => +m[1]);
      const params = numbers.length
        ? [
            Object.fromEntries(
              Array.from(new Set(numbers), (n) => ['?' + n, args[n - 1]]),
            ),
          ]
        : args;
      return sql.prepare(query)[method](...params);
    };
    return {
      bind(...values) {
        args = values;
        return this;
      },
      async first() {
        return execute('get') || null;
      },
      async all() {
        return { results: execute('all') };
      },
      async run() {
        return { meta: { changes: Number(execute('run').changes) } };
      },
    };
  }
  globalThis.__giveawayDb = {
    prepare: statement,
    async batch(statements) {
      if (beforeBatch) {
        const cb = beforeBatch;
        beforeBatch = undefined;
        cb(sql);
      }
      sql.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const query of statements) results.push(await query.run());
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const now = Date.now();
  const person = (id, options = {}) =>
    sql
      .prepare(
        'INSERT INTO users(id,name,kind,onboardingComplete,deletedAt,created) VALUES(?,?,?,?,?,?)',
      )
      .run(
        id,
        id,
        options.kind || 'person',
        options.onboardingComplete ?? 1,
        options.deletedAt || 0,
        now,
      );
  for (const id of ['owner', 'admin', 'member', 'other', 'guest']) person(id);
  sql
    .prepare(
      "INSERT INTO users(id,name,kind,ownerId,created) VALUES('channel','Канал','channel','owner',?)",
    )
    .run(now);
  sql
    .prepare(
      "INSERT INTO chat_rooms(id,kind,ownerId,name,created,updatedAt) VALUES('group','group','owner','Группа',?,?)",
    )
    .run(now, now);
  for (const [userId, role] of [
    ['owner', 'owner'],
    ['admin', 'admin'],
    ['member', 'member'],
    ['other', 'member'],
  ])
    sql
      .prepare(
        "INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt) VALUES('group',?,?,'active',?)",
      )
      .run(userId, role, now);
  sql
    .prepare(
      "INSERT INTO channel_members(channelId,userId,role,created) VALUES('channel','admin','admin',?)",
    )
    .run(now);
  for (const userId of ['admin', 'member', 'other'])
    sql
      .prepare("INSERT INTO follows(follower,following) VALUES(?,'channel')")
      .run(userId);
  const grant = (who, amount) =>
    sql
      .prepare(
        "INSERT INTO star_transfers(id,recipient,amount,kind,created) VALUES(?,?,?,'admin_grant',?)",
      )
      .run(crypto.randomUUID(), who, amount, now);
  grant('owner', 10000);
  grant('admin', 10000);
  grant('member', 10000);
  const wallet = (id) =>
    sql
      .prepare(
        'SELECT COALESCE(SUM(CASE WHEN recipient=? THEN amount ELSE -amount END),0) AS n FROM star_transfers WHERE recipient=? OR sender=?',
      )
      .get(id, id, id).n;
  const body = (options = {}) => ({
    action: 'create',
    key: crypto.randomUUID(),
    targetKind: 'group',
    targetId: 'group',
    prize: 'stars',
    winnerCount: 2,
    starsPerWinner: 100,
    endsAt: now + 3600000,
    ...options,
  });
  return {
    sql,
    now,
    person,
    grant,
    wallet,
    body,
    beforeBatch: (cb) => {
      beforeBatch = cb;
    },
  };
}
async function isolated(callback) {
  const fixtureDb = fixture();
  try {
    await callback(fixtureDb);
  } finally {
    fixtureDb.sql.close();
    delete globalThis.__giveawayDb;
  }
}

test('atomic creation, rights, shared metadata and retry protection', async () =>
  isolated(async (f) => {
    await assert.rejects(
      api.createGiveaway('member', f.body(), f.now),
      /владельцам и администраторам/,
    );
    const body = f.body();
    const first = await api.createGiveaway('owner', body, f.now);
    assert.equal(first.balance, 9800);
    assert.equal(
      (await api.getGiveaway('owner', first.giveaway.id, f.now))
        .participantCount,
      3,
    );
    assert.deepEqual(first.giveaway.winners, []);
    assert.equal(first.giveaway.participating, false);
    const again = await api.createGiveaway('owner', body, f.now + 1000);
    assert.equal(again.balance, 9800);
    assert.equal(again.giveaway.id, first.giveaway.id);
    assert.equal(
      f.sql
        .prepare(
          'SELECT COUNT(*) AS n FROM chat_room_messages WHERE giveawayId=?',
        )
        .get(first.giveaway.id).n,
      1,
    );
    await assert.rejects(
      api.createGiveaway('owner', { ...body, starsPerWinner: 101 }, f.now),
      /уже использован/,
    );
    await assert.rejects(
      api.createGiveaway(
        'owner',
        f.body({ starsPerWinner: 100000, winnerCount: 50 }),
        f.now,
      ),
      /Максимальный бюджет/,
    );
    await assert.rejects(
      api.getGiveaway('guest', first.giveaway.id, f.now),
      /недоступен/,
    );
    await assert.rejects(
      api.createGiveaway('owner', f.body({ endsAt: f.now + 1000 }), f.now),
      /от 5 минут/,
    );
    assert.throws(
      () =>
        f.sql
          .prepare(
            "INSERT INTO chat_room_messages(id,roomId,sender,text,created,giveawayId) VALUES('forged','group','member','fake',?,?)",
          )
          .run(f.now, first.giveaway.id),
      /GIVEAWAY_BINDING/,
    );
  }));

test('all real awards funded, creator excluded, duplicate jobs pay once', async () =>
  isolated(async (f) => {
    const { giveaway } = await api.createGiveaway(
      'owner',
      f.body({ winnerCount: 3 }),
      f.now,
    );
    assert.equal(await api.settleGiveaway(giveaway.id, f.now), false);
    assert.equal(
      await api.settleGiveaway(giveaway.id, giveaway.endsAt + 1),
      true,
    );
    const drawn = await api.getGiveaway(
      'member',
      giveaway.id,
      giveaway.endsAt + 1,
    );
    assert.equal(drawn.status, 'completed');
    assert.deepEqual(drawn.winners.map((w) => w.id).sort(), [
      'admin',
      'member',
      'other',
    ]);
    assert.equal(drawn.refund, 0);
    assert.equal(f.wallet('owner'), 9700);
    assert.equal(f.wallet('member'), 10100);
    assert.equal(f.wallet('other'), 100);
    assert.equal(f.wallet('noctgram_giveaways'), 0);
    assert.equal(
      await api.settleGiveaway(giveaway.id, giveaway.endsAt + 2),
      false,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM star_transfers WHERE kind='giveaway_prize'",
        )
        .get().n,
      3,
    );
  }));

test('current eligible members only; unfilled slots return funded stars', async () =>
  isolated(async (f) => {
    const { giveaway } = await api.createGiveaway(
      'owner',
      f.body({ winnerCount: 5 }),
      f.now,
    );
    f.sql.exec(
      "UPDATE chat_room_members SET status='left' WHERE userId='other'; UPDATE chat_room_members SET status='banned' WHERE userId='admin';",
    );
    await api.settleGiveaway(giveaway.id, giveaway.endsAt);
    const drawn = await api.getGiveaway('owner', giveaway.id, giveaway.endsAt);
    assert.deepEqual(
      drawn.winners.map((w) => w.id),
      ['member'],
    );
    assert.equal(drawn.participantCount, 1);
    assert.equal(drawn.refund, 400);
    assert.equal(f.wallet('owner'), 9900);
    assert.equal(f.wallet('noctgram_giveaways'), 0);
  }));

test('membership changes between COUNT and transaction retry against current set', async () =>
  isolated(async (f) => {
    const { giveaway } = await api.createGiveaway(
      'owner',
      f.body({ winnerCount: 3 }),
      f.now,
    );
    f.beforeBatch((sql) =>
      sql.exec(
        "UPDATE chat_room_members SET status='left' WHERE userId='other'",
      ),
    );
    assert.equal(await api.settleGiveaway(giveaway.id, giveaway.endsAt), true);
    const drawn = await api.getGiveaway('owner', giveaway.id, giveaway.endsAt);
    assert.deepEqual(drawn.winners.map((w) => w.id).sort(), [
      'admin',
      'member',
    ]);
    assert.equal(drawn.refund, 100);
  }));

test('Premium costs 500 per winner and extends existing paid expiration exactly once', async () =>
  isolated(async (f) => {
    const oldExpiry = f.now + 90 * 86400000;
    f.sql
      .prepare(
        "INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) VALUES('member',?,?, 'admin',?)",
      )
      .run(f.now - 1, oldExpiry, f.now);
    f.sql.exec("DELETE FROM follows WHERE follower IN ('admin','other')");
    const { giveaway, balance } = await api.createGiveaway(
      'owner',
      f.body({
        targetKind: 'channel',
        targetId: 'channel',
        prize: 'premium',
        winnerCount: 2,
      }),
      f.now,
    );
    assert.equal(balance, 9000);
    assert.equal(giveaway.starsPerWinner, 0);
    assert.equal(giveaway.totalCost, 1000);
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM posts WHERE giveawayId=? AND userId='channel' AND publisherId='owner'",
        )
        .get(giveaway.id).n,
      1,
    );
    const drawn = await api.getGiveaway('guest', giveaway.id, giveaway.endsAt);
    assert.equal(drawn.winners.length, 1);
    assert.equal(drawn.winners[0].id, 'member');
    assert.equal(drawn.refund, 500);
    assert.equal(f.wallet('owner'), 9500);
    assert.equal(
      f.sql
        .prepare(
          "SELECT expiresAt FROM premium_entitlements WHERE userId='member'",
        )
        .get().expiresAt,
      oldExpiry + 30 * 86400000,
    );
    await api.settleDueGiveaways(giveaway.endsAt + 1);
    assert.equal(
      f.sql
        .prepare(
          "SELECT expiresAt FROM premium_entitlements WHERE userId='member'",
        )
        .get().expiresAt,
      oldExpiry + 30 * 86400000,
    );
  }));

test('insufficient funds and revocation at commit cannot debit or publish', async () =>
  isolated(async (f) => {
    await assert.rejects(
      api.createGiveaway('owner', f.body({ starsPerWinner: 10000 }), f.now),
      /Не хватает/,
    );
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM giveaways').get().n,
      0,
    );
    f.beforeBatch((sql) =>
      sql.exec(
        "UPDATE chat_room_members SET role='member' WHERE userId='admin'",
      ),
    );
    await assert.rejects(
      api.createGiveaway('admin', f.body(), f.now),
      /Не удалось/,
    );
    assert.equal(f.wallet('admin'), 10000);
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM giveaways').get().n,
      0,
    );
    f.sql
      .prepare(
        "INSERT INTO chat_rooms(id,kind,ownerId,name,created,updatedAt) VALUES('secret','secret','owner','',?,?)",
      )
      .run(f.now, f.now);
    f.sql
      .prepare(
        "INSERT INTO chat_room_members(roomId,userId,role,joinedAt) VALUES('secret','owner','owner',?)",
      )
      .run(f.now);
    await assert.rejects(
      api.createGiveaway('owner', f.body({ targetId: 'secret' }), f.now),
      /владельцам и администраторам/,
    );
  }));

test('transaction failure cannot leave a partial draw; next job recovers', async () =>
  isolated(async (f) => {
    const { giveaway } = await api.createGiveaway('owner', f.body(), f.now);
    f.sql.exec(
      "CREATE TRIGGER test_fail_prize BEFORE INSERT ON star_transfers WHEN NEW.kind='giveaway_prize' BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END",
    );
    await assert.rejects(
      api.settleGiveaway(giveaway.id, giveaway.endsAt),
      /TEST_FAILURE/,
    );
    assert.equal(
      f.sql.prepare('SELECT status FROM giveaways WHERE id=?').get(giveaway.id)
        .status,
      'active',
    );
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM giveaway_winners').get().n,
      0,
    );
    f.sql.exec('DROP TRIGGER test_fail_prize');
    assert.deepEqual(await api.settleDueGiveaways(giveaway.endsAt), {
      completed: 1,
      failed: 0,
    });
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM giveaway_winners').get().n,
      2,
    );
  }));

test('blocked, deleted and incomplete accounts cannot win; empty target refunds all', async () =>
  isolated(async (f) => {
    const { giveaway } = await api.createGiveaway(
      'owner',
      f.body({ prize: 'premium', winnerCount: 3 }),
      f.now,
    );
    f.sql
      .prepare(
        "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('restricted','admin','owner','blocked','test',?)",
      )
      .run(f.now);
    f.sql
      .prepare(
        "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('admin','restricted','blocked','test',?)",
      )
      .run(f.now);
    f.sql.exec(
      "UPDATE users SET deletedAt=1 WHERE id='other'; UPDATE users SET onboardingComplete=0 WHERE id='member';",
    );
    await api.settleGiveaway(giveaway.id, giveaway.endsAt);
    const drawn = await api.getGiveaway('owner', giveaway.id, giveaway.endsAt);
    assert.equal(drawn.winners.length, 0);
    assert.equal(drawn.refund, 1500);
    assert.equal(f.wallet('owner'), 10000);
    assert.equal(f.wallet('noctgram_giveaways'), 0);
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM premium_entitlements').get().n,
      0,
    );
  }));

test('channel administrators can pay; publisher-only role cannot create', async () =>
  isolated(async (f) => {
    const { giveaway } = await api.createGiveaway(
      'admin',
      f.body({ targetKind: 'channel', targetId: 'channel' }),
      f.now,
    );
    assert.equal(giveaway.creator, 'admin');
    assert.equal(f.wallet('owner'), 10000);
    assert.equal(f.wallet('admin'), 9800);
    f.sql.exec("UPDATE channel_members SET role='editor' WHERE userId='admin'");
    await assert.rejects(
      api.createGiveaway(
        'admin',
        f.body({ targetKind: 'channel', targetId: 'channel' }),
        f.now,
      ),
      /владельцам и администраторам/,
    );
  }));

test('committed receipt survives post-payment access loss and read-only retry', async () =>
  isolated(async (f) => {
    const draft = f.body();
    const originalBatch = globalThis.__giveawayDb.batch;
    globalThis.__giveawayDb.batch = async (statements) => {
      const result = await originalBatch(statements);
      f.sql.exec(
        "UPDATE chat_room_members SET status='banned' WHERE roomId='group' AND userId='owner'",
      );
      return result;
    };
    const created = await api.createGiveaway('owner', draft, f.now);
    assert.equal(created.balance, 9800);
    assert.equal(created.giveaway.creator, 'owner');
    assert.deepEqual(created.giveaway.winners, []);
    await assert.rejects(
      api.getGiveaway('owner', created.giveaway.id, f.now),
      /недоступен/,
    );
    f.sql
      .prepare(
        "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('readonly','owner','admin','read_only','test',?)",
      )
      .run(f.now);
    f.sql
      .prepare(
        "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('owner','readonly','read_only','test',?)",
      )
      .run(f.now);
    const replayed = await api.createGiveaway('owner', draft, f.now + 2000);
    assert.equal(replayed.giveaway.id, created.giveaway.id);
    assert.equal(replayed.balance, 9800);
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM giveaways').get().n,
      1,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM star_transfers WHERE kind='giveaway_debit'",
        )
        .get().n,
      1,
    );
    await assert.rejects(
      api.createGiveaway('owner', f.body(), f.now),
      (error) => error.code === 'GIVEAWAY_REJECTED' && error.status === 403,
    );
  }));

test('only definitive rejected creation errors permit a fresh payment attempt', async () =>
  isolated(async (f) => {
    await assert.rejects(
      api.createGiveaway('member', f.body(), f.now),
      (error) => error.code === 'GIVEAWAY_REJECTED',
    );
    await assert.rejects(
      api.createGiveaway('owner', f.body({ winnerCount: 0 }), f.now),
      (error) => error.code === 'GIVEAWAY_REJECTED',
    );
    await assert.rejects(
      api.createGiveaway('owner', f.body({ starsPerWinner: 10000 }), f.now),
      (error) => error.code === 'GIVEAWAY_REJECTED',
    );
    assert.equal(f.wallet('owner'), 10000);
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM giveaways').get().n,
      0,
    );
  }));
