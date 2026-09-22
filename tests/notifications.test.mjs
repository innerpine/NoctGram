// Social notifications: the real lib/notifications.ts against every journal
// migration in :memory: SQLite. No Worker, network, cookies or push service.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { compileFunction } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(process.cwd());
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const source = (path) => readFileSync(join(root, path), 'utf8');
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
const evaluate = (text, dependencies = {}) => {
  const output = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} };
  compileFunction(output, ['require', 'exports', 'module'])(
    (specifier) => {
      assert.ok(
        specifier in dependencies,
        `Unexpected dependency: ${specifier}`,
      );
      return dependencies[specifier];
    },
    loaded.exports,
    loaded,
  );
  return loaded.exports;
};
const { ApiError } = evaluate(source('lib/api-error.ts'));
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
const migrations = JSON.parse(source('drizzle/meta/_journal.json')).entries.map(
  (entry) => source(`drizzle/${entry.tag}.sql`),
);

function fixture() {
  const sql = new DatabaseSync(':memory:');
  migrations.forEach((migration) => sql.exec(migration));
  sql.exec('PRAGMA foreign_keys=ON');
  const statement = (text, args = []) => ({
    text,
    args,
    bind: (...values) => statement(text, values),
    first: async () => sql.prepare(text).get(...args) || null,
    all: async () => ({ results: sql.prepare(text).all(...args) }),
    run: async () => ({
      meta: { changes: Number(sql.prepare(text).run(...args).changes) },
    }),
  });
  const adapter = {
    prepare: (text) => statement(text),
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = statements.map((s) => ({
          meta: { changes: Number(sql.prepare(s.text).run(...s.args).changes) },
        }));
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const n = evaluate(source('lib/notifications.ts'), {
    '@/lib/premium-access': {
      appearanceColumns: () => 'u.verified AS verified',
    },
    '@block65/webcrypto-web-push': { buildPushPayload: async () => ({}) },
    'next/headers': { cookies: async () => ({ get() {}, set() {} }) },
    './server': { db: () => adapter, clean: (value) => value, ApiError },
    './auth-session': { setting: () => '' },
    './account-access': { visibleAccount, assertReadable: async () => {} },
    './channel-access': channel,
    './chat-access': chat,
    './calls': { callAllowed: () => '1' },
  });
  for (const [id, kind, owner] of [
    ['alice', 'person', null],
    ['bob', 'person', null],
    ['carol', 'person', null],
    ['chan', 'channel', 'alice'],
  ])
    sql
      .prepare(
        'INSERT INTO users(id,name,kind,ownerId,created) VALUES(?,?,?,?,1)',
      )
      .run(id, id, kind, owner);
  // Posts may reference only ready uploads (a trigger enforces it).
  sql.exec(
    "INSERT INTO uploads(id,userId,type,name,created) VALUES('img1','alice','image/png','a.png',1),('img2','alice','image/png','b.png',1)",
  );
  const post = (id, userId, extra = {}) =>
    sql
      .prepare(
        'INSERT INTO posts(id,userId,text,media,adult,created) VALUES(?,?,?,?,?,1)',
      )
      .run(
        id,
        userId,
        extra.text ?? 'text of ' + id,
        JSON.stringify(extra.media || []),
        extra.adult || 0,
      );
  post('p1', 'alice');
  post('p2', 'chan');
  post('photo', 'alice', {
    media: [{ id: 'img1', type: 'image/png', name: 'a.png' }],
  });
  post('adult', 'alice', {
    adult: 1,
    media: [{ id: 'img2', type: 'image/png', name: 'b.png' }],
  });
  const run = (statements) => adapter.batch([statements].flat());
  const like = async (postId, user, value = true) => {
    if (value)
      sql
        .prepare('INSERT OR IGNORE INTO likes(postId,userId) VALUES(?,?)')
        .run(postId, user);
    else
      sql
        .prepare('DELETE FROM likes WHERE postId=? AND userId=?')
        .run(postId, user);
    await run(n.likeNotification(postId, user, value));
  };
  const list = async (me = 'alice', query = {}) =>
    (
      await n.notificationsGet('notifications', me, new URLSearchParams(query))
    ).json();
  const count = async (me = 'alice', since = 0) =>
    (
      await n.notificationsGet(
        'notificationCount',
        me,
        new URLSearchParams(since ? { since: String(since) } : {}),
      )
    ).json();
  return { sql, n, run, like, list, count };
}

void test('likes are one row per post that shows the newest liker and counts the rest', async () => {
  const f = fixture();
  await f.like('p1', 'bob');
  let [row] = await f.list();
  assert.deepEqual(
    [row.kind, row.actorId, row.others, row.postId, row.postText],
    ['like', 'bob', 0, 'p1', 'text of p1'],
  );
  f.sql.exec('UPDATE notifications SET read=1');
  await f.like('p1', 'carol');
  const rows = await f.list();
  assert.equal(rows.length, 1, 'one aggregated row per post');
  assert.deepEqual(
    [rows[0].actorId, rows[0].others, rows[0].read],
    ['carol', 1, 0],
  );
  // The author liking their own post is not news.
  await f.like('p1', 'alice');
  assert.equal((await f.list())[0].actorId, 'carol');
  // Withdrawn likes hand the row back, then remove it.
  await f.like('p1', 'carol', false);
  row = (await f.list())[0];
  assert.equal(row.actorId, 'bob');
  await f.like('p1', 'bob', false);
  assert.equal((await f.list()).length, 0);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='like'")
      .get().n,
    0,
  );
});

void test('channel activity reaches the owner, never the actor themselves', async () => {
  const f = fixture();
  await f.like('p2', 'bob');
  assert.deepEqual(
    (await f.list()).map((r) => [r.kind, r.postId]),
    [['like', 'p2']],
  );
  await f.like('p2', 'alice');
  assert.equal((await f.list())[0].actorId, 'bob');
  f.sql
    .prepare(
      "INSERT INTO comments(id,postId,userId,text,created) VALUES('own','p2','alice','mine',2)",
    )
    .run();
  await f.run(f.n.commentNotification('own'));
  assert.equal((await f.list()).length, 1);
});

void test('comments carry their text and disappear with the comment or a block', async () => {
  const f = fixture();
  f.sql
    .prepare(
      "INSERT INTO comments(id,postId,userId,text,created) VALUES('c1','p1','bob','Отличный пост',5)",
    )
    .run();
  await f.run(f.n.commentNotification('c1'));
  await f.run(f.n.commentNotification('c1'));
  let rows = await f.list();
  assert.deepEqual(
    rows.map((r) => [r.kind, r.actorId, r.commentText, r.postId]),
    [['comment', 'bob', 'Отличный пост', 'p1']],
  );
  f.sql.exec(
    "INSERT INTO user_blocks(blocker,blocked,created) VALUES('alice','bob',1)",
  );
  assert.equal((await f.list()).length, 0);
  f.sql.exec("DELETE FROM user_blocks; DELETE FROM comments WHERE id='c1'");
  rows = await f.list();
  assert.equal(rows.length, 0, 'a deleted comment is not shown');
});

void test('a person is told about a follower once; channels are not', async () => {
  const f = fixture();
  f.sql.exec(
    "INSERT INTO follows(follower,following) VALUES('bob','alice'),('bob','chan')",
  );
  await f.run([
    f.n.followNotification('bob', 'alice'),
    f.n.followNotification('bob', 'chan'),
  ]);
  assert.deepEqual(
    (await f.list()).map((r) => [r.kind, r.actorId]),
    [['follow', 'bob']],
  );
  f.sql.exec("DELETE FROM follows WHERE follower='bob' AND following='alice'");
  assert.equal((await f.list()).length, 0);
  f.sql.exec("INSERT INTO follows(follower,following) VALUES('bob','alice')");
  await f.run(f.n.followNotification('bob', 'alice'));
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='follow'")
      .get().n,
    1,
  );
});

void test('thumbnails never expose 18+ media; support and market rows carry amounts', async () => {
  const f = fixture();
  await f.like('photo', 'bob');
  await f.like('adult', 'carol');
  const rows = await f.list();
  assert.equal(rows.find((r) => r.postId === 'photo').postImage, 'img1');
  assert.equal(rows.find((r) => r.postId === 'adult').postImage, null);
  f.sql.exec(`
    INSERT INTO star_transfers(id,sender,recipient,postId,postText,amount,kind,created) VALUES('seed','bob','alice',NULL,'',0,'grant',1);
    INSERT INTO star_transfers(id,sender,recipient,postId,postText,amount,kind,created) VALUES('support:bob:k','bob','alice','p1','',50,'support',9);
    INSERT INTO notifications(id,userId,actorId,kind,targetId,created) VALUES('support:support:bob:k','alice','bob','support','support:bob:k',9);
    INSERT INTO market_numbers(number,ownerId,created) VALUES('12345678','carol',1);
    INSERT INTO market_listings(id,kind,assetId,sellerId,price,status,buyerId,fee,created,closed) VALUES('lot1','number','12345678','alice',200,'sold','carol',10,1,10);
    INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created) VALUES('market:lot1','carol','alice','+888 1234 5678',190,'market_sale',10);
    INSERT INTO notifications(id,userId,actorId,kind,targetId,created) VALUES('market:lot1','alice','carol','market','lot1',10);
  `);
  const [market, support] = await f.list('alice', { kinds: 'support,market' });
  assert.deepEqual(
    [
      market.kind,
      market.amount,
      market.lotTitle,
      market.lotKind,
      market.lotKey,
    ],
    ['market', 190, '+888 1234 5678', 'number', '12345678'],
  );
  assert.deepEqual(
    [support.kind, support.amount, support.postId],
    ['support', 50, 'p1'],
  );
});

void test('count feeds pop-ups with events newer than the last server time only', async () => {
  const f = fixture();
  const first = await f.count();
  assert.deepEqual([first.unread, first.latest], [0, []]);
  assert.ok(first.now > 0);
  f.sql
    .prepare(
      "INSERT INTO comments(id,postId,userId,text,created) VALUES('old','p1','bob','old',?)",
    )
    .run(first.now - 5000);
  await f.run(f.n.commentNotification('old'));
  f.sql
    .prepare(
      "INSERT INTO comments(id,postId,userId,text,created) VALUES('new','p1','carol','new',?)",
    )
    .run(first.now + 5000);
  await f.run(f.n.commentNotification('new'));
  const next = await f.count('alice', first.now);
  assert.equal(next.unread, 2);
  assert.deepEqual(
    next.latest.map((r) => r.commentText),
    ['new'],
  );
  f.sql.exec('UPDATE notifications SET read=1');
  assert.deepEqual((await f.count('alice', first.now)).latest, []);
});

void test('the list pages by time and filters by known kinds', async () => {
  const f = fixture();
  for (let i = 0; i < 35; i++) {
    f.sql
      .prepare(
        'INSERT INTO comments(id,postId,userId,text,created) VALUES(?,?,?,?,?)',
      )
      .run('c' + i, 'p1', 'bob', 'c' + i, 100 + i);
    await f.run(f.n.commentNotification('c' + i));
  }
  const page = await f.list();
  assert.equal(page.length, 30);
  const last = page.at(-1);
  const rest = await f.list('alice', {
    before: String(last.created),
    beforeId: last.id,
  });
  assert.equal(rest.length, 5);
  assert.ok(rest.every((r) => r.created < last.created));
  assert.equal((await f.list('alice', { kinds: 'follow' })).length, 0);
  assert.equal(
    (await f.list('alice', { kinds: 'comment,unknown' })).length,
    30,
  );
});
