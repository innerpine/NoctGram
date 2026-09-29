import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Forum topics and reply threads in groups through the real room code: who
// manages topics, closed topics, per-topic unread, deletion and threads.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const entry of journal.entries)
  sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
sqlite.exec(
  "INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1),('dave','Dave',1)",
);
sqlite.exec(
  "INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bob','bob',1),('carol','carol',1),('dave','dave',1)",
);
function statement(sql) {
  let values = [];
  const execute = (mode) => {
    try {
      return sqlite.prepare(sql)[mode](...values);
    } catch (error) {
      error.message += '\nSQL: ' + sql + '\nBinding count: ' + values.length;
      throw error;
    }
  };
  return {
    bind(...args) {
      values = args;
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
globalThis.__topicsDb = {
  prepare: statement,
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const item of statements) results.push(await item.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};
const { outputFiles } = await build({
  entryPoints: ['lib/rooms.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'topics-sqlite',
      setup(build) {
        build.onResolve({ filter: /^\.\/auth-session$/ }, () => ({
          path: 'auth',
          namespace: 'fixture-settings',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture-settings' }, () => ({
          contents:
            "export const setting=()=> '1'; export const tokenHash=async value=>value;",
        }));
        build.onResolve({ filter: /^\.\/storage$/ }, () => ({
          path: 'storage',
          namespace: 'fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const db = () => globalThis.__topicsDb;',
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
let now = Date.now();
const change = (me, body) => api.changeRoom(me, body, ++now);
const deny = (promise, status = 403) =>
  assert.rejects(promise, (error) => error.status === status);
const send = (me, room, text, extra = {}) =>
  change(me, {
    action: 'send',
    id: room,
    key: crypto.randomUUID(),
    text,
    ...extra,
  });
const unread = async (me, id) =>
  (await api.listRooms(me)).rooms.find((room) => room.id === id).unread;

const group = await change('alice', {
  action: 'create',
  kind: 'group',
  name: 'Клуб',
  memberIds: ['bob', 'carol'],
});
await change('alice', {
  action: 'role',
  id: group.id,
  userId: 'bob',
  role: 'admin',
});
assert.equal(group.forum, false);
await deny(
  change('alice', { action: 'topicCreate', id: group.id, title: 'Кино' }),
  400,
);
await deny(send('alice', group.id, 'Вне темы', { topic: 'x' }), 400);

// Owners and admins switch topics on; members cannot.
await deny(change('carol', { action: 'forum', id: group.id, enabled: true }));
const forum = await change('alice', {
  action: 'forum',
  id: group.id,
  enabled: true,
});
assert.equal(forum.forum, true);
assert.deepEqual(forum.messages, [], 'The topic list view carries no messages');
assert.deepEqual(
  forum.topics.map((topic) => [topic.id, topic.title]),
  [['general', 'Общее']],
);
assert.equal((await api.listRooms('carol')).rooms[0].forum, true);

// Admins create topics with a colour and an emoji.
await deny(
  change('carol', { action: 'topicCreate', id: group.id, title: 'Моя тема' }),
);
const movies = await change('bob', {
  action: 'topicCreate',
  id: group.id,
  title: '  Кино   и сериалы ',
  color: 2,
});
const games = await change('alice', {
  action: 'topicCreate',
  id: group.id,
  title: 'Игры',
  emoji: '🎮',
});
for (const body of [
  { title: '' },
  { title: 'x'.repeat(129) },
  { title: 'Ок', color: 6 },
  { title: 'Ок', color: 1.5 },
  { title: 'Ок', emoji: 'a b' },
])
  await deny(
    change('alice', { action: 'topicCreate', id: group.id, ...body }),
    400,
  );
let topics = (await api.readRoom('carol', group.id, null, { view: 'topics' }))
  .topics;
assert.deepEqual(
  topics.map((topic) => [topic.id, topic.title, topic.color, topic.emoji]),
  [
    ['general', 'Общее', 0, ''],
    [games.id, 'Игры', 0, '🎮'],
    [movies.id, 'Кино и сериалы', 2, ''],
  ],
);

// Messages stay in their topic; the full history still has all of them.
const film = await send('carol', group.id, 'Что посмотреть?', {
  topic: movies.id,
});
const hello = await send('carol', group.id, 'Всем привет', {
  topic: 'general',
});
await send('carol', group.id, 'Кто в игру?', { topic: games.id });
const inMovies = await api.readRoom('alice', group.id, null, {
  topic: movies.id,
});
assert.equal(inMovies.topic, movies.id);
assert.deepEqual(
  inMovies.messages.map((m) => m.text),
  ['Что посмотреть?'],
);
assert.equal(inMovies.messages[0].topicId, movies.id);
const inGeneral = await api.readRoom('alice', group.id, null, {
  topic: 'general',
});
assert.deepEqual(
  inGeneral.messages.map((m) => m.text),
  ['Всем привет'],
);
assert.equal(
  'topicId' in inGeneral.messages[0],
  false,
  '«Общее» has no topic id',
);
assert.equal(
  (await api.readRoom('alice', group.id)).messages.length,
  3,
  'Older clients see every topic as one history',
);
await deny(send('carol', group.id, 'Нет такой', { topic: 'missing' }), 404);

// The chat list counts unread topics; each topic is read on its own.
assert.equal(await unread('alice', group.id), 3);
await change('alice', {
  action: 'read',
  id: group.id,
  through: film.id,
  topic: movies.id,
});
assert.equal(await unread('alice', group.id), 2);
topics = (await api.readRoom('alice', group.id, null, { view: 'topics' }))
  .topics;
assert.deepEqual(
  Object.fromEntries(topics.map((topic) => [topic.id, topic.unread])),
  { general: 1, [games.id]: 1, [movies.id]: 0 },
);
assert.equal(
  topics.find((t) => t.id === movies.id).lastMessage.senderName,
  'Carol',
);
await change('alice', {
  action: 'read',
  id: group.id,
  through: hello.id,
  topic: 'general',
});
assert.equal(await unread('alice', group.id), 1);
await send('alice', group.id, 'Я!', { topic: games.id });
assert.equal(
  await unread('alice', group.id),
  1,
  'Own messages are never unread',
);

// Replies stay in the topic of the message they answer.
await deny(
  send('alice', group.id, 'Не туда', { replyTo: film.id, topic: 'general' }),
  400,
);
const answer = await send('alice', group.id, 'Дюну', {
  replyTo: film.id,
  topic: movies.id,
});

// A closed topic accepts messages only from its creator and admins.
await deny(
  change('carol', { action: 'topicClose', id: group.id, topicId: movies.id }),
);
await change('bob', { action: 'topicClose', id: group.id, topicId: movies.id });
await deny(send('carol', group.id, 'Можно?', { topic: movies.id }));
await send('bob', group.id, 'Закрыто', { topic: movies.id });
await send('alice', group.id, 'Админ может', { topic: movies.id });
assert.ok(
  (await api.readRoom('carol', group.id, null, { view: 'topics' })).topics.find(
    (topic) => topic.id === movies.id,
  ).closedAt > 0,
);
await change('alice', {
  action: 'topicReopen',
  id: group.id,
  topicId: movies.id,
});
await send('carol', group.id, 'Теперь можно', { topic: movies.id });

// The creator or an admin edits a topic; «Общее» stays as it is.
await deny(
  change('carol', {
    action: 'topicUpdate',
    id: group.id,
    topicId: movies.id,
    title: 'Моё',
  }),
);
await change('bob', {
  action: 'topicUpdate',
  id: group.id,
  topicId: movies.id,
  title: 'Фильмы',
  color: 4,
  emoji: '🎬',
});
await deny(
  change('alice', {
    action: 'topicUpdate',
    id: group.id,
    topicId: 'general',
    title: 'Главная',
  }),
  400,
);
assert.equal(
  sqlite.prepare('SELECT title FROM chat_room_topics WHERE id=?').get(movies.id)
    .title,
  'Фильмы',
);

// Only admins delete a topic, and its messages go with it.
await deny(
  change('carol', { action: 'topicDelete', id: group.id, topicId: games.id }),
);
await change('bob', { action: 'topicDelete', id: group.id, topicId: games.id });
assert.equal(
  sqlite
    .prepare(
      'SELECT COUNT(*) AS n FROM chat_room_messages WHERE topicId=? AND deletedAt=0',
    )
    .get(games.id).n,
  0,
);
assert.equal(
  (await api.readRoom('carol', group.id, null, { view: 'topics' })).topics.some(
    (topic) => topic.id === games.id,
  ),
  false,
);
await deny(send('carol', group.id, 'Поздно', { topic: games.id }), 404);

// Outsiders see nothing of a forum.
await deny(api.readRoom('dave', group.id, null, { view: 'topics' }), 404);
await deny(
  change('dave', { action: 'topicCreate', id: group.id, title: 'Чужая' }),
  404,
);

// Threads: a reply joins the thread of the message it answers.
const plain = await change('alice', {
  action: 'create',
  kind: 'group',
  name: 'Ветки',
  memberIds: ['bob'],
});
const root = await send('alice', plain.id, 'Куда поедем летом?');
const first = await send('bob', plain.id, 'На море', { replyTo: root.id });
const second = await send('alice', plain.id, 'Какое?', { replyTo: first.id });
await send('bob', plain.id, 'Отдельно');
const nested = sqlite
  .prepare(
    'SELECT id,threadRootId FROM chat_room_messages WHERE roomId=? ORDER BY created',
  )
  .all(plain.id);
assert.deepEqual(
  nested.map((row) => row.threadRootId),
  [null, root.id, root.id, null],
);
const history = await api.readRoom('bob', plain.id);
assert.equal(history.messages.find((m) => m.id === root.id).replies, 2);
assert.equal(
  'replies' in history.messages.find((m) => m.id === first.id),
  false,
);
assert.equal(
  history.messages.find((m) => m.id === second.id).threadRootId,
  root.id,
);
const thread = await api.readRoom('bob', plain.id, null, { thread: root.id });
assert.equal(thread.threadRoot.id, root.id);
assert.equal(thread.threadRoot.replies, 2);
assert.deepEqual(
  thread.messages.map((m) => m.text),
  ['На море', 'Какое?'],
);
await change('bob', {
  action: 'deleteMessage',
  id: plain.id,
  messageId: first.id,
});
assert.equal(
  (await api.readRoom('bob', plain.id)).messages.find((m) => m.id === root.id)
    .replies,
  1,
  'Deleted replies are not counted',
);
await deny(api.readRoom('bob', plain.id, null, { thread: 'missing' }), 404);
await deny(api.readRoom('dave', plain.id, null, { thread: root.id }), 404);
assert.equal(answer.id.length, 36);

// Turning topics off keeps them for later but stops topic sends.
await change('alice', { action: 'forum', id: group.id, enabled: false });
await deny(send('carol', group.id, 'Куда?', { topic: movies.id }), 400);
assert.equal((await api.readRoom('carol', group.id)).topics, undefined);
assert.equal(
  sqlite
    .prepare(
      'SELECT COUNT(*) AS n FROM chat_room_topics WHERE roomId=? AND deletedAt=0',
    )
    .get(group.id).n,
  1,
);
console.log(
  'Room topics and threads: permissions, closed topics, unread per topic, deletion and threads passed.',
);
