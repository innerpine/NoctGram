import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const sqlite = new DatabaseSync(':memory:');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const entry of journal.entries)
  sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
sqlite.exec(
  "INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1)",
);
const plans = [];
globalThis.__libraryDb = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async first() {
        plans.push(
          ...sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...values),
        );
        return sqlite.prepare(sql).get(...values);
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
    };
  },
};
const { outputFiles } = await build({
  stdin: {
    contents:
      "export * from './lib/chat-library-server'; export * from './lib/chat-library';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'library-fixtures',
      setup(build) {
        build.onResolve(
          { filter: /^\.\/(storage|account-access)$/ },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === './storage'
              ? 'export const db=()=>globalThis.__libraryDb;'
              : "export async function assertAccountVisible(id){if(!['alice','bob','carol'].includes(id))throw new Error('Unavailable account');}",
        }));
      },
    },
  ],
});
const { readChatLibrary, chatLinks } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const insert = sqlite.prepare(
  'INSERT INTO messages(id,sender,recipient,text,created,media,deletedAt) VALUES(?,?,?,?,?,?,?)',
);
const file = (id, kind = 'image', type = 'image/png') => ({
  id,
  name: id,
  kind,
  type,
  size: 12,
});
const message = (
  id,
  sender,
  recipient,
  text,
  created,
  media = [],
  deleted = 0,
) => {
  for (const attachment of media)
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO uploads(id,userId,type,name,created,state) VALUES(?,?,?,?,?,'ready')",
      )
      .run(attachment.id, sender, attachment.type, attachment.name, created);
  return insert.run(
    id,
    sender,
    recipient,
    text,
    created,
    JSON.stringify(media),
    deleted,
  );
};
message('old-photo', 'alice', 'bob', 'old', 1, [file('old-image')]);
for (let i = 0; i < 350; i++)
  message('recent-' + i, 'bob', 'alice', 'hello', 100 + i);
for (let i = 0; i < 35; i++)
  message('album-' + String(i).padStart(2, '0'), 'alice', 'bob', '', 1000, [
    file('photo-' + i + 'a'),
    file('photo-' + i + 'b'),
  ]);
message(
  'types',
  'bob',
  'alice',
  'https://example.com/first https://example.com/second',
  1200,
  [
    file('movie', 'video', 'video/mp4'),
    file('song', 'file', 'audio/mpeg'),
    file('pdf', 'file', 'application/pdf'),
  ],
);
message('hidden', 'bob', 'alice', 'https://hidden.example', 1300, [
  file('hidden-photo'),
]);
sqlite
  .prepare('INSERT INTO hidden_messages(messageId,userId) VALUES(?,?)')
  .run('hidden', 'alice');
message(
  'deleted',
  'bob',
  'alice',
  'https://deleted.example',
  1400,
  [file('deleted-photo')],
  1,
);
message('private', 'bob', 'carol', 'https://private.example', 1400, [
  file('private-photo'),
]);
message('other-peer', 'carol', 'alice', 'https://other.example', 1400, [
  file('other-photo'),
]);
message('moderated', 'alice', 'bob', '', 1500, [file('moderated-image')]);
sqlite.exec(
  "INSERT INTO content_removals(id,targetType,targetId,postId,authorId,moderatorId,text,snapshot,reason,created) VALUES('fixture-removal','upload','moderated-image','','alice','bob','','{}','fixture',1500)",
);
sqlite.exec(
  "INSERT INTO moderated_uploads(uploadId,removalId) VALUES('moderated-image','fixture-removal')",
);

await test('stats cover the full conversation and respect actor visibility', async () => {
  const stats = await readChatLibrary('alice', 'bob');
  assert.equal(stats.messages, 388);
  assert.equal(stats.sent, 37);
  assert.equal(stats.received, 351);
  assert.equal(stats.first, 1);
  assert.deepEqual(
    [stats.photos, stats.videos, stats.files, stats.audio],
    [71, 1, 1, 1],
  );
  assert.ok(
    plans.some((row) => /SEARCH m USING INDEX messages_/.test(row.detail)),
    'conversation uses an existing messages index',
  );
  const other = await readChatLibrary('bob', 'alice');
  assert.equal(
    other.photos,
    72,
    'hide for me does not hide for the other participant',
  );
});
await test('attachment pagination preserves same-time albums and reaches old history', async () => {
  const ids = [];
  let next = '';
  do {
    const page = await readChatLibrary('alice', 'bob', 'photos', next);
    assert.ok(page.items.length <= 30);
    ids.push(...page.items.map((item) => item.file.id));
    next = page.next;
  } while (next);
  assert.equal(ids.length, 71);
  assert.equal(new Set(ids).size, 71);
  assert.equal(ids.at(-1), 'old-image');
  for (const id of [
    'hidden-photo',
    'deleted-photo',
    'private-photo',
    'other-photo',
    'moderated-image',
  ])
    assert.ok(!ids.includes(id));
});
await test('files, audio and video are distinct; link entries stay in the participant scope', async () => {
  for (const [kind, id] of [
    ['files', 'pdf'],
    ['audio', 'song'],
    ['videos', 'movie'],
  ]) {
    assert.deepEqual(
      (await readChatLibrary('alice', 'bob', kind)).items.map(
        (item) => item.file.id,
      ),
      [id],
    );
  }
  assert.deepEqual(
    (await readChatLibrary('alice', 'bob', 'links')).items.map(
      (item) => item.url,
    ),
    ['https://example.com/first', 'https://example.com/second'],
  );
  assert.deepEqual(
    (await readChatLibrary('carol', 'alice', 'photos')).items.map(
      (item) => item.file.id,
    ),
    ['other-photo'],
  );
});
await test('link pagination covers every link in a message and never duplicates boundary messages', async () => {
  for (let i = 0; i < 35; i++)
    message(
      'link-' + String(i).padStart(2, '0'),
      'alice',
      'bob',
      `https://example.com/a${i} https://example.com/b${i}`,
      2000,
    );
  let next = '';
  const urls = [];
  do {
    const page = await readChatLibrary('alice', 'bob', 'links', next);
    urls.push(...page.items.map((item) => item.url));
    next = page.next;
  } while (next);
  assert.equal(urls.length, 72);
  assert.equal(new Set(urls).size, 72);
});
await test('empty history and invalid input are handled', async () => {
  assert.equal((await readChatLibrary('alice', 'carol')).messages, 1);
  assert.deepEqual(await readChatLibrary('alice', 'carol', 'videos'), {
    items: [],
    next: null,
  });
  for (const [peer, kind, before] of [
    ['alice', '', ''],
    ['missing', '', ''],
    ['bob', 'invalid', ''],
    ['bob', 'photos', 'invalid'],
    ['bob', 'photos', JSON.stringify({ created: 1, id: 'x', part: 100 })],
  ])
    await assert.rejects(readChatLibrary('alice', peer, kind, before));
});
await test('links use only web protocols and preserve balanced paths', () => {
  assert.deepEqual(
    chatLinks(
      'https://example.com/a, (https://example.com/wiki_(test)) www.example.org. https://user:pass@example.com javascript:alert(1) https://example.com/a',
    ),
    [
      'https://example.com/a',
      'https://example.com/wiki_(test)',
      'https://www.example.org/',
    ],
  );
});
