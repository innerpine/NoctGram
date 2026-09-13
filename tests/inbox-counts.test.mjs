import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Run the production query functions against all real migrations, without network.
function functions(file, names, dependencies = {}) {
  const text = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declarations = names
    .map((name) => {
      const node = ast.statements.find(
        (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
      );
      assert.ok(node, `${file}: ${name}`);
      return node.getText(ast);
    })
    .join('\n');
  const output = ts.transpileModule(declarations, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  compileFunction(output, ['exports', ...Object.keys(dependencies)])(
    exports,
    ...Object.values(dependencies),
  );
  return exports;
}

function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  const journal = JSON.parse(
    readFileSync('drizzle/meta/_journal.json', 'utf8'),
  );
  for (const entry of journal.entries)
    sql.exec(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'));
  sql.exec('PRAGMA foreign_keys=ON');
  for (const id of [
    'alice',
    'bob',
    'carol',
    'deleted',
    'restricted',
    'unfinished',
  ]) {
    sql.prepare('INSERT INTO users(id,name,created) VALUES(?,?,1)').run(id, id);
    sql
      .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
      .run(id, id);
  }
  sql
    .prepare(
      "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('event','restricted','alice','blocked','fixture',1)",
    )
    .run();
  sql
    .prepare(
      "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('restricted','event','blocked','fixture',1)",
    )
    .run();
  const queries = [];
  const db = () => ({
    prepare(text) {
      queries.push(text);
      const statement = (args = []) => ({
        bind: (...values) => statement(values),
        first: async () => sql.prepare(text).get(...args) || null,
        all: async () => ({ results: sql.prepare(text).all(...args) }),
      });
      return statement();
    },
  });
  const { visibleAccount } = functions('lib/account-access.ts', [
    'visibleAccount',
  ]);
  const { messageVisible } = functions('lib/chat-access.ts', [
    'messageVisible',
  ]);
  const { published } = functions('lib/channel-access.ts', ['published'], {
    sqlNow: "(strftime('%s','now')*1000)",
  });
  const { readUnreadMessageCount } = functions(
    'lib/chat-messages.ts',
    ['readUnreadMessageCount'],
    { db, visibleAccount, messageVisible },
  );
  const { notificationsGet } = functions(
    'lib/notifications.ts',
    ['notificationVisible', 'notificationsGet'],
    {
      db,
      visibleAccount,
      messageVisible,
      published,
      fanoutPosts: async () => {},
      appearanceColumns: () => 'u.verified AS verified',
      ...functions('lib/direct-notification-policy.ts', [
        'directNotificationAllowed',
      ]),
    },
  );
  const message = (id, sender = 'bob', recipient = 'alice', read = 0) => {
    sql
      .prepare(
        'INSERT INTO messages(id,sender,recipient,text,created,read) VALUES(?,?,?, ?,1,?)',
      )
      .run(id, sender, recipient, id, read);
    sql
      .prepare(
        "INSERT INTO notifications(id,userId,actorId,kind,targetId,created,read) VALUES(?,?,?,'message',?,1,?)",
      )
      .run('n-' + id, recipient, sender, id, read);
  };
  return { sql, queries, message, readUnreadMessageCount, notificationsGet };
}

await test('muting suppresses personal message and gift alerts without changing unread history or channel gifts', async (t) => {
  const f = fixture(t);
  f.message('personal');
  f.message('other', 'carol');
  f.sql
    .exec(`INSERT INTO direct_chat_notifications(userId,peerId,muted,updated) VALUES('alice','bob',1,0);
    INSERT INTO users(id,name,kind,ownerId,created) VALUES('channel-muted-test','Channel','channel','alice',1);
    INSERT INTO star_transfers(id,sender,recipient,amount,kind,created) VALUES('gift-pay','bob','noctgram_gifts',75,'gift',1),('channel-pay','bob','noctgram_gifts',75,'gift',1);
    INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,created) VALUES('personal-gift','gift-pay','toy_bear','bob','alice',1),('channel-gift','channel-pay','toy_bear','bob','channel-muted-test',1);
    INSERT INTO notifications(id,userId,actorId,kind,targetId,created) VALUES('personal-gift','alice','bob','gift','personal-gift',1),('channel-gift','alice','bob','gift','channel-gift',1);`);
  assert.equal(await f.readUnreadMessageCount('alice'), 2);
  const alerts = await (
    await f.notificationsGet('notifications', 'alice')
  ).json();
  assert.deepEqual(alerts.map((n) => n.id).sort(), ['channel-gift', 'n-other']);
});

void test('background message badge excludes read, outgoing, hidden, deleted and inaccessible messages', async (t) => {
  const f = fixture(t);
  f.message('unread');
  f.message('second', 'carol');
  f.message('read', 'bob', 'alice', 1);
  f.message('outgoing', 'alice', 'bob');
  f.message('hidden');
  f.message('removed');
  for (const id of ['deleted', 'restricted', 'unfinished'])
    f.message('from-' + id, id);
  f.sql.exec(
    "UPDATE users SET deletedAt=1 WHERE id='deleted'; UPDATE users SET onboardingComplete=0 WHERE id='unfinished'",
  );
  f.sql.exec(
    "INSERT INTO hidden_messages(userId,messageId) VALUES('alice','hidden'); UPDATE messages SET deletedAt=1 WHERE id='removed'",
  );
  assert.equal(await f.readUnreadMessageCount('alice'), 2);
  assert.equal(await f.readUnreadMessageCount('bob'), 1);
  f.sql.exec("UPDATE messages SET read=1 WHERE id IN('unread','second')");
  assert.equal(await f.readUnreadMessageCount('alice'), 0);
  assert.ok(f.queries.every((q) => !q.includes('premium_entitlements')));
});

void test('notification count and full list enforce the same visibility, including personal blocks', async (t) => {
  const f = fixture(t);
  for (const sender of ['bob', 'carol', 'deleted', 'restricted', 'unfinished'])
    f.message(sender, sender);
  f.message('hidden');
  f.message('removed');
  f.message('read', 'bob', 'alice', 1);
  f.sql.exec(
    "UPDATE users SET deletedAt=1 WHERE id='deleted'; UPDATE users SET onboardingComplete=0 WHERE id='unfinished'",
  );
  f.sql.exec(
    "INSERT INTO hidden_messages(userId,messageId) VALUES('alice','hidden'); UPDATE messages SET deletedAt=1 WHERE id='removed'; INSERT INTO user_blocks(blocker,blocked,created) VALUES('alice','carol',1)",
  );
  const count = await (
    await f.notificationsGet('notificationCount', 'alice')
  ).json();
  const list = await (
    await f.notificationsGet('notifications', 'alice')
  ).json();
  assert.equal(count.unread, 1);
  assert.equal(count.unread, list.filter((n) => !n.read).length);
  assert.equal(
    (await (await f.notificationsGet('notificationCount', 'carol')).json())
      .unread,
    0,
  );
  f.sql.exec("UPDATE notifications SET read=1 WHERE userId='alice'");
  assert.equal(
    (await (await f.notificationsGet('notificationCount', 'alice')).json())
      .unread,
    0,
  );
});

void test('badge counts stop at the displayed 99+ / 9+ caps', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 120; i++) f.message('many-' + i);
  assert.equal(await f.readUnreadMessageCount('alice'), 100);
  assert.equal(
    (await (await f.notificationsGet('notificationCount', 'alice')).json())
      .unread,
    10,
  );
});

void test('channel gift notifications route to the channel and remain visible only to its current owner', async (t) => {
  const f = fixture(t);
  f.sql.exec(`
    INSERT INTO users(id,name,kind,ownerId,created) VALUES('gifts-channel','Gift channel','channel','alice',1);
    INSERT INTO star_transfers(id,sender,recipient,amount,kind,created) VALUES('channel-gift-transfer','bob','noctgram_gifts',25,'gift',1);
    INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,created) VALUES('channel-gift','channel-gift-transfer','toy_bear','bob','gifts-channel',1);
    INSERT INTO notifications(id,userId,actorId,kind,targetId,created) VALUES('channel-gift','alice','bob','gift','channel-gift',1);
  `);
  const list = await (
    await f.notificationsGet('notifications', 'alice')
  ).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].giftRecipient, 'gifts-channel');
  assert.equal(
    (await (await f.notificationsGet('notificationCount', 'alice')).json())
      .unread,
    1,
  );
  f.sql.exec("UPDATE users SET ownerId='carol' WHERE id='gifts-channel'");
  assert.equal(
    (await (await f.notificationsGet('notifications', 'alice')).json()).length,
    0,
    'Former owners lose access',
  );
  f.sql.exec(
    "UPDATE users SET ownerId='alice' WHERE id='gifts-channel'; INSERT INTO user_blocks(blocker,blocked,created) VALUES('bob','gifts-channel',1)",
  );
  assert.equal(
    (await (await f.notificationsGet('notifications', 'alice')).json()).length,
    0,
    'Channel blocks suppress its gift notification',
  );
});
