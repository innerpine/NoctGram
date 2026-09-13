import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
const migrations = await Promise.all(
  journal.entries.map(({ tag }) => readFile(`drizzle/${tag}.sql`, 'utf8')),
);
let sql,
  beforeWrite,
  tail = Promise.resolve();
const execute = (query, values) => {
  if (/^\s*(INSERT|DELETE|UPDATE)/i.test(query) && beforeWrite) {
    const hook = beforeWrite;
    beforeWrite = null;
    hook();
  }
  const statement = sql.prepare(query);
  if (statement.columns().length)
    return { results: statement.all(...values), meta: { changes: 0 } };
  return {
    results: [],
    meta: { changes: Number(statement.run(...values).changes) },
  };
};
globalThis.__reactionsDb = {
  prepare(query) {
    let values = [];
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async first() {
        return execute(query, values).results[0] || null;
      },
      async all() {
        return execute(query, values);
      },
      async run() {
        return execute(query, values);
      },
    };
  },
  batch(statements) {
    const task = tail.then(async () => {
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    });
    tail = task.catch(() => {});
    return task;
  },
};
const root = fileURLToPath(new URL('..', import.meta.url));
const compiled = await build({
  stdin: {
    contents: `export * from './lib/chat-messages'; export * from './lib/chat-actions';
    export * from './lib/rooms'; export * from './lib/account-removal'; export * from './lib/message-reactions';`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'reactions-fixture',
      setup(build) {
        build.onResolve({ filter: /^\.\/auth-session$/ }, ({ path }) => ({
          path,
          namespace: 'auth',
        }));
        build.onLoad({ filter: /.*/, namespace: 'auth' }, () => ({
          contents: 'export const setting=()=>"1";',
        }));
        build.onResolve(
          { filter: /^(\.\/|@\/lib\/)(storage|server)$/ },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export { ApiError, failure } from './lib/api-error';
        export const db=()=>globalThis.__reactionsDb,bucket=()=>({}),clean=v=>v;`,
          resolveDir: root,
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const now = Date.now();
beforeEach(() => {
  sql?.close();
  sql = new DatabaseSync(':memory:');
  beforeWrite = null;
  for (const migration of migrations) sql.exec(migration);
  sql.exec(`PRAGMA foreign_keys=ON;
    INSERT INTO users(id,name,created,onboardingComplete) VALUES('alice','Alice',1,1),('bob','Bob',1,1),('carol','Carol',1,1),('eve','Eve',1,1);
    INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bob','bob',1),('carol','carol',1),('eve','eve',1);
    INSERT INTO messages(id,sender,recipient,text,created) VALUES('dm','alice','bob','Hello',1),('other-dm','alice','carol','Private',2);
    INSERT INTO chat_rooms(id,kind,ownerId,name,created,updatedAt) VALUES('group','group','alice','Group',1,1),('other','group','carol','Other',1,1),('secret','secret','alice','Secret',1,1);
    INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt) VALUES
      ('group','alice','owner','active',1),('group','bob','member','active',1),('group','carol','member','active',1),
      ('other','carol','owner','active',1),('other','bob','member','active',1),
      ('secret','alice','owner','active',1),('secret','bob','member','active',1);
    INSERT INTO chat_room_messages(id,roomId,sender,text,created) VALUES('msg','group','alice','Hello group',1),('other-msg','other','carol','Other',2);
    INSERT INTO chat_room_messages(id,roomId,sender,ciphertext,created) VALUES('encrypted','secret','alice','encrypted payload',1);`);
});
after(() => sql.close());
const dm = (actor, emoji, extra = {}) =>
  api.reactToMessage(actor, {
    id: 'dm',
    peer: actor === 'alice' ? 'bob' : 'alice',
    emoji,
    ...extra,
  });
const group = (actor, emoji, extra = {}) =>
  api.changeRoom(actor, {
    action: 'reaction',
    id: 'group',
    messageId: 'msg',
    emoji,
    ...extra,
  });
const deny = (promise, status = 403) =>
  assert.rejects(promise, (error) => error.status === status);
const rows = (table) => sql.prepare(`SELECT * FROM ${table}`).all();
const restrict = (user, mode = 'read_only') => {
  const event = crypto.randomUUID();
  sql
    .prepare(
      'INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,?,?,?,?)',
    )
    .run(event, user, 'alice', mode, 'test', now);
  sql
    .prepare(
      'INSERT OR REPLACE INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,?,?,?)',
    )
    .run(user, event, mode, 'test', now);
};

void test('direct reactions: all emoji, idempotency, replacement, counts and viewer ownership', async () => {
  for (const { emoji } of api.MESSAGE_REACTIONS) {
    await dm('bob', emoji);
    await dm('bob', emoji);
    assert.equal(rows('message_reactions').length, 1);
    assert.equal(rows('message_reactions')[0].emoji, emoji);
  }
  await dm('bob', '❤️');
  await dm('alice', '❤️');
  assert.deepEqual((await api.readConversation('bob', 'alice'))[0].reactions, [
    { emoji: '❤️', count: 2, own: true },
  ]);
  await dm('alice', '🔥');
  assert.deepEqual((await api.readConversation('bob', 'alice'))[0].reactions, [
    { emoji: '❤️', count: 1, own: true },
    { emoji: '🔥', count: 1, own: false },
  ]);
  await dm('bob', null);
  await dm('bob', null);
  assert.equal(rows('message_reactions').length, 1);
});
void test('invalid reaction, outsider, wrong peer, hidden/deleted messages cannot be mutated', async () => {
  for (const emoji of [undefined, '', '💩', '<img>', {}, ['👍']])
    await deny(dm('bob', emoji), 400);
  await deny(dm('eve', '👍'));
  await deny(dm('bob', '👍', { peer: 'carol' }));
  await deny(dm('bob', '👍', { id: 'other-dm' }));
  await dm('alice', '🔥');
  sql.exec("INSERT INTO hidden_messages(messageId,userId) VALUES('dm','bob')");
  await deny(dm('bob', '👍'));
  await deny(dm('bob', null));
  assert.equal((await api.readConversation('bob', 'alice')).length, 0);
  assert.equal(rows('message_reactions').length, 1);
  sql.exec("UPDATE messages SET deletedAt=1 WHERE id='dm'");
  await deny(dm('alice', '👍'));
});
void test('direct reactions enforce bilateral blocks, message privacy and account restrictions', async () => {
  for (const [from, to] of [
    ['alice', 'bob'],
    ['bob', 'alice'],
  ]) {
    sql
      .prepare('INSERT INTO user_blocks(blocker,blocked,created) VALUES(?,?,1)')
      .run(from, to);
    await deny(dm('bob', '👍'));
    sql.exec('DELETE FROM user_blocks');
  }
  sql.exec(
    "INSERT INTO user_privacy(userId,messagePolicy) VALUES('alice','nobody')",
  );
  await deny(dm('bob', '👍'));
  sql.exec('DELETE FROM user_privacy');
  for (const mode of ['read_only', 'blocked']) {
    restrict('bob', mode);
    await deny(dm('bob', '👍'));
    sql.exec('DELETE FROM account_restrictions');
  }
  assert.equal(rows('message_reactions').length, 0);
});
void test('direct auth changes at write time cannot add/remove reactions', async () => {
  beforeWrite = () =>
    sql.exec(
      "INSERT INTO user_blocks(blocker,blocked,created) VALUES('alice','bob',1)",
    );
  await deny(dm('bob', '👍'));
  assert.equal(rows('message_reactions').length, 0);
  sql.exec('DELETE FROM user_blocks');
  await dm('bob', '🔥');
  beforeWrite = () => restrict('bob');
  await deny(dm('bob', null));
  assert.equal(rows('message_reactions')[0].emoji, '🔥');
});
void test('group reactions aggregate, replace, remove and survive refetch', async () => {
  await Promise.all([group('bob', '🎉'), group('carol', '🎉')]);
  await group('bob', '🎉');
  assert.deepEqual(
    (await api.readRoom('alice', 'group')).messages[0].reactions,
    [{ emoji: '🎉', count: 2, own: false }],
  );
  await group('bob', '🔥');
  assert.deepEqual((await api.readRoom('bob', 'group')).messages[0].reactions, [
    { emoji: '🔥', count: 1, own: true },
    { emoji: '🎉', count: 1, own: false },
  ]);
  await group('carol', null);
  await group('carol', null);
  assert.equal(rows('chat_room_message_reactions').length, 1);
});
void test('groups reject outsiders, wrong room, left/banned members and blocked senders', async () => {
  await deny(group('eve', '👍'), 404);
  await deny(group('bob', '👍', { messageId: 'other-msg' }));
  for (const status of ['left', 'banned']) {
    sql
      .prepare(
        "UPDATE chat_room_members SET status=? WHERE roomId='group' AND userId='bob'",
      )
      .run(status);
    await assert.rejects(group('bob', '👍'), (error) =>
      [403, 404].includes(error.status),
    );
  }
  sql.exec(
    "UPDATE chat_room_members SET status='active' WHERE roomId='group' AND userId='bob'; INSERT INTO user_blocks(blocker,blocked,created) VALUES('bob','carol',1); UPDATE chat_room_messages SET sender='carol' WHERE id='msg'",
  );
  await deny(group('bob', '👍'));
  assert.equal(rows('chat_room_message_reactions').length, 0);
});
void test('groups repeat authorization at mutation time including same-remove requests', async () => {
  beforeWrite = () =>
    sql.exec(
      "UPDATE chat_room_members SET status='banned' WHERE roomId='group' AND userId='bob'",
    );
  await deny(group('bob', '👍'));
  assert.equal(rows('chat_room_message_reactions').length, 0);
  sql.exec(
    "UPDATE chat_room_members SET status='active' WHERE roomId='group' AND userId='bob'",
  );
  beforeWrite = () => restrict('bob');
  await deny(group('bob', null));
});
void test('secret chats never accept or return plaintext reactions', async () => {
  await deny(group('bob', '👍', { id: 'secret', messageId: 'encrypted' }));
  sql.exec(
    "INSERT INTO chat_room_message_reactions VALUES('encrypted','alice','👍',1)",
  );
  const message = (await api.readRoom('bob', 'secret')).messages[0];
  assert.equal(Object.hasOwn(message, 'reactions'), false);
});
void test('deleting messages cleans reactions; local hide preserves peer reaction', async () => {
  await dm('bob', '👍');
  await dm('alice', '❤️');
  await api.deleteMessages('bob', {
    ids: ['dm'],
    peer: 'alice',
    everyone: false,
  });
  assert.equal(rows('message_reactions').length, 2);
  await api.deleteMessages('alice', {
    ids: ['dm'],
    peer: 'bob',
    everyone: true,
  });
  assert.equal(rows('message_reactions').length, 0);
  await group('bob', '🔥');
  await api.changeRoom('alice', {
    action: 'deleteMessage',
    id: 'group',
    messageId: 'msg',
  });
  assert.equal(rows('chat_room_message_reactions').length, 0);
  assert.deepEqual(
    (await api.readRoom('bob', 'group')).messages[0].reactions,
    [],
  );
  await deny(group('bob', '👍'));
});
void test('foreign keys clean hard deletes; database rejects unknown emoji', async () => {
  await dm('bob', '👍');
  await group('bob', '👍');
  assert.throws(
    () =>
      sql.exec(
        "INSERT INTO message_reactions VALUES('dm','alice','unknown',1)",
      ),
    /CHECK/,
  );
  sql.exec(
    "DELETE FROM messages WHERE id='dm'; DELETE FROM chat_room_messages WHERE id='msg'",
  );
  assert.equal(
    rows('message_reactions').length +
      rows('chat_room_message_reactions').length,
    0,
  );
});
void test('account removal cleans its reactions on surviving messages', async () => {
  await group('bob', '👍');
  await group('carol', '❤️');
  await dm('bob', '🔥');
  sql
    .prepare(
      'INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) VALUES(?,?,?,?,?)',
    )
    .run('session', 'bob', now, now + 86400000, now);
  await api.deleteAccount('bob', 'session', false);
  assert.equal(rows('message_reactions').length, 0);
  assert.deepEqual(
    rows('chat_room_message_reactions').map((row) => row.userId),
    ['carol'],
  );
  assert.equal(
    sql
      .prepare("SELECT COUNT(*) AS n FROM chat_room_messages WHERE id='msg'")
      .get().n,
    1,
  );
});
void test('reaction export only includes own accessible group data and rechecks every page', async () => {
  await group('bob', '👍');
  await group('carol', '🔥');
  const section = api
    .groupRoomExportSections('bob')
    .find((s) => s.name === 'groupMessageReactions');
  assert.deepEqual(
    (await section.page('')).rows.map((row) => [row.id, row.emoji]),
    [['msg', '👍']],
  );
  sql.exec(
    "UPDATE chat_room_members SET status='left' WHERE roomId='group' AND userId='bob'",
  );
  assert.deepEqual((await section.page('')).rows, []);
});
