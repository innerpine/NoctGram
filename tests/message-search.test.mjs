import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Message search and chat folders through the real routes and SQL: Cyrillic
// case folding, escaping, legacy rows, paging, access, context windows and
// folder limits.
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const { tag } of journal.entries)
  sql.exec(await readFile('drizzle/' + tag + '.sql', 'utf8'));
sql.exec(`INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1);
  INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bob','bob',1),('carol','carol',1);`);
globalThis.__searchDB = {
  prepare(query) {
    return {
      query,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        return sql.prepare(query).get(...this.args) || null;
      },
      async all() {
        return { results: sql.prepare(query).all(...this.args) };
      },
      async run() {
        if (/^\s*SELECT\b/i.test(query))
          return {
            results: sql.prepare(query).all(...this.args),
            meta: { changes: 0 },
          };
        return {
          meta: {
            changes: Number(sql.prepare(query).run(...this.args).changes),
          },
        };
      },
    };
  },
  async batch(statements) {
    sql.exec('BEGIN');
    try {
      const results = [];
      for (const s of statements) results.push(await s.run());
      sql.exec('COMMIT');
      return results;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
globalThis.__searchHeaders = new Headers();
const { outputFiles } = await build({
  stdin: {
    contents: `export { POST as socialPOST } from './app/api/social/route';
      export { GET as searchGET } from './app/api/chat-search/route';
      export { GET as foldersGET, POST as foldersPOST } from './app/api/chat-folders/route';
      export { changeRoom, readRoom } from './lib/rooms';
      export { readConversation } from './lib/chat-messages';
      export { backfillSearchText } from './lib/message-search';
      export { normalizeSearch, searchSnippet } from './lib/search-text';
      export { folderIncludes } from './lib/chat-folders-filter';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'search-fixture',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(cloudflare:workers|next\/headers|next\/server|next\/navigation|(\.\/|@\/lib\/)storage)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'cloudflare:workers'
              ? 'export const env={NOCT_AUTH_MODE:"hybrid"};'
              : path === 'next/server'
                ? 'export const after=()=>{};'
                : path === 'next/headers'
                  ? 'export const headers=async()=>globalThis.__searchHeaders; export const cookies=async()=>({get:()=>undefined,set:()=>{}});'
                  : path === 'next/navigation'
                    ? 'export const redirect=()=>{throw new Error("Unexpected redirect")};'
                    : 'export const db=()=>globalThis.__searchDB; export const bucket=()=>null;',
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const as = (viewer) => {
  sql.exec('DELETE FROM auth_limits');
  globalThis.__searchHeaders = new Headers({
    'oai-authenticated-user-id': viewer,
    'oai-authenticated-user-email': viewer + '@example.test',
  });
};
async function say(viewer, peer, text) {
  as(viewer);
  const response = await api.socialPOST(
    new Request('http://localhost/api/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'message',
        id: peer,
        text,
        key: crypto.randomUUID(),
      }),
    }),
  );
  assert.equal(response.status, 200);
  return (await response.json()).id;
}
async function search(viewer, params) {
  as(viewer);
  const response = await api.searchGET(
    new Request(
      'http://localhost/api/chat-search?' + new URLSearchParams(params),
    ),
  );
  return { status: response.status, body: await response.json() };
}
const texts = (result) => result.body.items.map((item) => item.text);

// Normalisation: case, ё and custom emoji tokens.
assert.equal(
  api.normalizeSearch('  ЁЖИК  в\nТумане :noct_moon: '),
  'ежик в тумане',
);
const snippet = api.searchSnippet(
  'Очень длинное начало. Встречаемся завтра у метро!',
  'ВСТРЕЧ',
  10,
);
assert.equal(
  snippet.text.slice(snippet.start, snippet.start + snippet.length),
  'Встреч',
);

// Direct chat search is case-insensitive for Cyrillic and treats ё as е.
await say('alice', 'bob', 'Привет, как дела?');
const hedgehog = await say('bob', 'alice', 'ЁЖИК в тумане');
await say('alice', 'bob', 'Встречаемся у метро в 19:00');
await say('bob', 'alice', 'code_100% ready');
await say('bob', 'alice', 'code 1000 ready');
assert.deepEqual(
  texts(await search('alice', { scope: 'chat', peer: 'bob', q: 'ежик' })),
  ['ЁЖИК в тумане'],
);
assert.deepEqual(
  texts(await search('bob', { scope: 'chat', peer: 'alice', q: 'ПРИВЕТ' })),
  ['Привет, как дела?'],
);
assert.deepEqual(
  texts(await search('alice', { scope: 'chat', peer: 'bob', q: '100%' })),
  ['code_100% ready'],
  'LIKE wildcards are literal',
);
assert.deepEqual(
  texts(await search('alice', { scope: 'chat', peer: 'bob', q: 'e_1' })),
  ['code_100% ready'],
);
const first = await search('alice', { scope: 'chat', peer: 'bob', q: 'code' });
assert.equal(first.body.total, 2);
assert.equal(first.body.items[0].senderName, 'Bob');
assert.equal(first.body.items[0].chatId, 'bob');
for (const q of ['', ' ', 'x'.repeat(101)])
  assert.equal(
    (await search('alice', { scope: 'chat', peer: 'bob', q })).status,
    400,
  );
assert.equal(
  (
    await search('alice', {
      scope: 'chat',
      peer: 'bob',
      q: 'ежик',
      before: 'broken',
    })
  ).status,
  400,
);

// Rows written before searchText existed are found and indexed later.
sql.prepare('UPDATE messages SET searchText=NULL WHERE id=?').run(hedgehog);
assert.deepEqual(
  texts(await search('alice', { scope: 'chat', peer: 'bob', q: 'ЁЖИК' })),
  ['ЁЖИК в тумане'],
);
assert.ok((await api.backfillSearchText()) >= 1);
assert.equal(
  sql.prepare('SELECT searchText FROM messages WHERE id=?').get(hedgehog)
    .searchText,
  'ежик в тумане',
);
assert.deepEqual(
  texts(await search('alice', { scope: 'chat', peer: 'bob', q: 'ежик' })),
  ['ЁЖИК в тумане'],
);

// Edits update the index; messages hidden or deleted are not found.
const draft = await say('alice', 'bob', 'Черновик');
as('alice');
await api.socialPOST(
  new Request('http://localhost/api/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'messageEdit',
      id: draft,
      peer: 'bob',
      text: 'Чистовик',
      revision: 0,
    }),
  }),
);
assert.deepEqual(
  texts(await search('alice', { scope: 'chat', peer: 'bob', q: 'черновик' })),
  [],
);
assert.deepEqual(
  texts(await search('alice', { scope: 'chat', peer: 'bob', q: 'чистовик' })),
  ['Чистовик'],
);
sql
  .prepare("INSERT INTO hidden_messages(messageId,userId) VALUES(?,'alice')")
  .run(draft);
assert.deepEqual(
  texts(await search('alice', { scope: 'chat', peer: 'bob', q: 'чистовик' })),
  [],
);
assert.deepEqual(
  texts(await search('bob', { scope: 'chat', peer: 'alice', q: 'чистовик' })),
  ['Чистовик'],
);

// Paging: 30 per page, newest first, with a total on the first page.
for (let i = 0; i < 35; i++) await say('bob', 'alice', 'повтор ' + i);
const one = await search('alice', { scope: 'chat', peer: 'bob', q: 'повтор' });
assert.equal(one.body.items.length, 30);
assert.equal(one.body.total, 35);
assert.equal(one.body.items[0].text, 'повтор 34');
const two = await search('alice', {
  scope: 'chat',
  peer: 'bob',
  q: 'повтор',
  before: one.body.next,
});
assert.deepEqual(texts(two), [
  'повтор 4',
  'повтор 3',
  'повтор 2',
  'повтор 1',
  'повтор 0',
]);
assert.equal(two.body.next, null);
assert.equal(two.body.total, undefined);

// Others' chats stay private.
assert.deepEqual(
  texts(await search('carol', { scope: 'chat', peer: 'bob', q: 'повтор' })),
  [],
);

// Groups, topics and search across all chats.
let now = Date.now();
const group = await api.changeRoom(
  'alice',
  { action: 'create', kind: 'group', name: 'Встречи', memberIds: ['bob'] },
  ++now,
);
const roomSay = (me, text, extra = {}) =>
  api.changeRoom(
    me,
    { action: 'send', id: group.id, key: crypto.randomUUID(), text, ...extra },
    ++now,
  );
await roomSay('bob', 'Встречаемся у кинотеатра');
const removed = await roomSay('bob', 'Встречаемся тайно');
await api.changeRoom(
  'bob',
  { action: 'deleteMessage', id: group.id, messageId: removed.id },
  ++now,
);
assert.deepEqual(
  texts(await search('alice', { scope: 'chat', room: group.id, q: 'встреча' })),
  ['Встречаемся у кинотеатра'],
);
assert.equal(
  (await search('carol', { scope: 'chat', room: group.id, q: 'встреча' }))
    .status,
  404,
);
await api.changeRoom(
  'alice',
  { action: 'forum', id: group.id, enabled: true },
  ++now,
);
const topic = await api.changeRoom(
  'alice',
  { action: 'topicCreate', id: group.id, title: 'Кино' },
  ++now,
);
await roomSay('bob', 'Встречаемся в кино', { topic: topic.id });
assert.deepEqual(
  texts(
    await search('alice', {
      scope: 'chat',
      room: group.id,
      topic: topic.id,
      q: 'встреча',
    }),
  ),
  ['Встречаемся в кино'],
);
assert.deepEqual(
  texts(
    await search('alice', {
      scope: 'chat',
      room: group.id,
      topic: 'general',
      q: 'встреча',
    }),
  ),
  ['Встречаемся у кинотеатра'],
);
const all = await search('alice', { scope: 'all', q: 'встреча' });
assert.deepEqual(texts(all), [
  'Встречаемся в кино',
  'Встречаемся у кинотеатра',
  'Встречаемся у метро в 19:00',
]);
assert.deepEqual(
  all.body.items.map((item) => [
    item.kind,
    item.chatName,
    item.forum ?? null,
    item.topicId ?? null,
  ]),
  [
    ['room', 'Встречи', true, topic.id],
    ['room', 'Встречи', true, null],
    ['dm', 'Bob', null, null],
  ],
);
assert.deepEqual(
  texts(await search('carol', { scope: 'all', q: 'встреча' })),
  [],
);

// Opening an old message brings its neighbours along.
const burst = [];
for (let i = 0; i < 360; i++)
  burst.push(await say('alice', 'carol', 'сообщение ' + i));
const window = await api.readConversation('carol', 'alice', burst[10]);
const around = window.map((message) => message.text);
assert.ok(around.includes('сообщение 10'));
assert.ok(around.includes('сообщение 9') && around.includes('сообщение 11'));
assert.ok(around.includes('сообщение 359'), 'The latest messages stay loaded');
assert.ok(!around.includes('сообщение 55'), 'Only a window around the target');
const chatter = await api.changeRoom(
  'alice',
  { action: 'create', kind: 'group', name: 'Болтовня', memberIds: ['carol'] },
  ++now,
);
const roomIds = [];
for (let i = 0; i < 150; i++)
  roomIds.push(
    (
      await api.changeRoom(
        'carol',
        {
          action: 'send',
          id: chatter.id,
          key: crypto.randomUUID(),
          text: 'реплика ' + i,
        },
        ++now,
      )
    ).id,
  );
const opened = await api.readRoom('alice', chatter.id, null, {
  around: roomIds[20],
});
assert.equal(opened.around, roomIds[20]);
const openedTexts = opened.messages.map((message) => message.text);
assert.equal(openedTexts.at(-1), 'реплика 60', '40 newer messages follow');
assert.equal(openedTexts[0], 'реплика 0');
assert.ok(openedTexts.includes('реплика 20'));
assert.equal(opened.nextCursor, null);
await assert.rejects(
  api.readRoom('alice', chatter.id, null, { around: 'missing' }),
  (error) => error.status === 404,
);

// Chat folders: validation, limits, ownership and ordering.
async function folders(viewer, body) {
  as(viewer);
  const response = body
    ? await api.foldersPOST(
        new Request('http://localhost/api/chat-folders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
    : await api.foldersGET(new Request('http://localhost/api/chat-folders'));
  return { status: response.status, body: await response.json() };
}
assert.deepEqual((await folders('alice')).body, { folders: [], limit: 10 });
for (const body of [
  { title: '', includeGroups: true },
  { title: 'Очень длинное имя', includeGroups: true },
  { title: 'Пусто' },
  { title: 'Плохо', includePeers: ['bob'] },
  {
    title: 'Плохо',
    includePeers: ['person:bob'],
    excludePeers: ['person:bob'],
  },
  { title: 'Плохо', includeGroups: 'yes' },
  {
    title: 'Плохо',
    includePeers: Array.from({ length: 101 }, (_, i) => 'person:u' + i),
  },
])
  assert.equal(
    (await folders('alice', { action: 'save', ...body })).status,
    400,
    JSON.stringify(body).slice(0, 60),
  );
const work = await folders('alice', {
  action: 'save',
  title: 'Работа',
  emoji: '💼',
  includeGroups: true,
  excludePeers: ['room:x'],
});
assert.equal(work.status, 200);
const friends = await folders('alice', {
  action: 'save',
  title: 'Друзья',
  includePeers: ['person:bob'],
  excludeRead: true,
});
let list = (await folders('alice')).body.folders;
assert.deepEqual(
  list.map((folder) => [folder.title, folder.position]),
  [
    ['Работа', 0],
    ['Друзья', 1],
  ],
);
assert.deepEqual(list[0].excludePeers, ['room:x']);
assert.equal(list[1].excludeRead, true);
assert.equal(
  (
    await folders('bob', {
      action: 'save',
      id: work.body.id,
      title: 'Чужая',
      includeGroups: true,
    })
  ).status,
  404,
);
assert.equal(
  (await folders('bob', { action: 'delete', id: work.body.id })).status,
  404,
);
await folders('alice', {
  action: 'save',
  id: work.body.id,
  title: 'Проекты',
  includeGroups: true,
});
await folders('alice', {
  action: 'reorder',
  ids: [friends.body.id, work.body.id],
});
list = (await folders('alice')).body.folders;
assert.deepEqual(
  list.map((folder) => folder.title),
  ['Друзья', 'Проекты'],
);
for (let i = 0; i < 8; i++)
  assert.equal(
    (
      await folders('alice', {
        action: 'save',
        title: 'П' + i,
        includePersonal: true,
      })
    ).status,
    200,
  );
assert.equal(
  (
    await folders('alice', {
      action: 'save',
      title: 'Лишняя',
      includePersonal: true,
    })
  ).status,
  400,
);
assert.equal(
  (await folders('alice', { action: 'delete', id: friends.body.id })).status,
  200,
);
assert.equal((await folders('alice')).body.folders.length, 9);

// Which chats a folder shows.
const folder = {
  includePersonal: false,
  includeGroups: true,
  includeSecret: false,
  excludeRead: false,
  excludeArchived: true,
  includePeers: ['person:bob'],
  excludePeers: ['room:noisy'],
};
const chat = (key, kind, unread = 0, archived = false) => ({
  key,
  kind,
  unread,
  archived,
});
assert.equal(api.folderIncludes(folder, chat('room:g', 'group')), true);
assert.equal(api.folderIncludes(folder, chat('room:noisy', 'group', 5)), false);
assert.equal(api.folderIncludes(folder, chat('person:bob', 'person')), true);
assert.equal(
  api.folderIncludes(folder, chat('person:carol', 'person', 3)),
  false,
);
assert.equal(
  api.folderIncludes(folder, chat('room:old', 'group', 1, true)),
  false,
);
assert.equal(
  api.folderIncludes({ ...folder, excludeRead: true }, chat('room:g', 'group')),
  false,
);
assert.equal(
  api.folderIncludes(
    { ...folder, excludeRead: true },
    chat('room:g', 'group', 2),
  ),
  true,
);
console.log(
  'Message search and chat folders: folding, escaping, paging, access, context windows and limits passed.',
);
