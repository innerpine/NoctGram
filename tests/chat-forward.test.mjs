import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Избранное (a chat with yourself), quotes and forwarding between direct
// messages, groups and the feed, through the real routes and SQL.
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const { tag } of journal.entries)
  sql.exec(await readFile('drizzle/' + tag + '.sql', 'utf8'));
sql.exec(`INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1),('dave','Dave',1),('erin','Erin',1);
  INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bob','bob',1),('carol','carol',1),('dave','dave',1),('erin','erin',1);`);
const objects = new Map();
globalThis.__forwardDB = {
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
        // D1 batches return rows for read statements too.
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
globalThis.__forwardBucket = {
  async put(id, bytes, metadata) {
    objects.set(id, { bytes, metadata });
  },
  async delete(id) {
    objects.delete(id);
  },
  async head(id) {
    return objects.has(id) ? { size: objects.get(id).bytes.length } : null;
  },
  async get(id) {
    const object = objects.get(id);
    if (!object) return null;
    return {
      body: object.bytes,
      size: object.bytes.length,
      httpEtag: '"fixture"',
      writeHttpMetadata(headers) {
        headers.set('Content-Type', object.metadata.httpMetadata.contentType);
      },
    };
  },
};
globalThis.__forwardHeaders = new Headers();
const { outputFiles } = await build({
  stdin: {
    contents: `export { GET as socialGET, POST as socialPOST } from './app/api/social/route';
      export { POST as uploadPOST } from './app/api/chat-upload/route';
      export { POST as forwardPOST } from './app/api/chat-forward/route';
      export { GET as mediaGET } from './app/api/media/[id]/route';
      export { changeRoom, readRoom, listRooms } from './lib/rooms';
      export { readConversation } from './lib/chat-messages';
      export { forwardRoomMessageId } from './lib/chat-forward';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'forward-fixture',
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
                  ? 'export const headers=async()=>globalThis.__forwardHeaders; export const cookies=async()=>({get:()=>undefined,set:()=>{}});'
                  : path === 'next/navigation'
                    ? 'export const redirect=()=>{throw new Error("Unexpected redirect")};'
                    : 'export const db=()=>globalThis.__forwardDB; export const bucket=()=>globalThis.__forwardBucket;',
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
  // Rate limits have their own tests; each step here starts fresh.
  sql.exec('DELETE FROM auth_limits');
  globalThis.__forwardHeaders = new Headers({
    'oai-authenticated-user-id': viewer,
    'oai-authenticated-user-email': viewer + '@example.test',
  });
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const key = () => crypto.randomUUID();
async function upload(viewer, target) {
  as(viewer);
  const form = new FormData();
  form.set('file', new File([png], 'photo.png', { type: 'image/png' }));
  for (const [name, value] of Object.entries(target)) form.set(name, value);
  const response = await api.uploadPOST(
    new Request('http://localhost/api/chat-upload', {
      method: 'POST',
      body: form,
    }),
  );
  return { status: response.status, body: await response.json() };
}
async function social(viewer, body) {
  as(viewer);
  const response = await api.socialPOST(
    new Request('http://localhost/api/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}
async function read(viewer, query) {
  as(viewer);
  const response = await api.socialGET(
    new Request('http://localhost/api/social?' + query + '&actor=' + viewer),
  );
  return { status: response.status, body: await response.json() };
}
async function forward(viewer, body) {
  as(viewer);
  const response = await api.forwardPOST(
    new Request('http://localhost/api/chat-forward', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}
async function media(viewer, id) {
  as(viewer);
  return (
    await api.mediaGET(new Request('http://localhost/api/media/' + id), {
      params: Promise.resolve({ id }),
    })
  ).status;
}
const row = (id) => sql.prepare('SELECT * FROM messages WHERE id=?').get(id);

// «Избранное»: a chat with yourself works like any other direct chat.
const note = await social('alice', {
  action: 'message',
  id: 'alice',
  text: 'Купить молоко',
  key: key(),
});
assert.equal(note.status, 200);
assert.equal(row(note.body.id).read, 1, 'Saved messages are never unread');
assert.equal(
  sql
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE userId='alice'")
    .get().n,
  0,
  'Saving a message does not notify yourself',
);
assert.deepEqual((await read('alice', 'action=threadsUnread')).body, {
  unread: 0,
});
const savedThread = (
  await read('alice', 'action=threads&archived=0')
).body.find((t) => t.id === 'alice');
assert.equal(savedThread.lastText, 'Купить молоко');
assert.equal(savedThread.unread, 0);
assert.deepEqual(
  (await read('alice', 'action=messageAccess&peer=alice')).body,
  {
    allowed: true,
    blockedByMe: false,
  },
);
const snapshot = await read(
  'alice',
  'action=messages&peer=alice&includeTheme=1',
);
assert.equal(snapshot.status, 200);
assert.deepEqual(
  snapshot.body.messages.map((m) => m.text),
  ['Купить молоко'],
);
assert.equal(
  snapshot.body.theme.shared,
  'noct',
  'Избранное uses the default theme',
);
assert.equal(
  (
    await social('alice', {
      action: 'chatTheme',
      peer: 'alice',
      scope: 'shared',
      theme: 'noct',
    })
  ).status,
  400,
  'Избранное has no theme to share',
);
const savedPhoto = await upload('alice', { peer: 'alice' });
assert.equal(savedPhoto.status, 200);
const savedPhotoMessage = await social('alice', {
  action: 'message',
  id: 'alice',
  text: '',
  attachments: [savedPhoto.body.id],
  key: key(),
});
assert.equal(savedPhotoMessage.status, 200);
assert.equal(await media('alice', savedPhoto.body.id), 200);
assert.equal(
  await media('bob', savedPhoto.body.id),
  404,
  'Saved files stay private',
);
assert.equal(
  (
    await social('alice', {
      action: 'messageReaction',
      id: note.body.id,
      peer: 'alice',
      emoji: '👍',
    })
  ).status,
  200,
);
assert.equal(
  (
    await social('alice', {
      action: 'messagePin',
      id: note.body.id,
      peer: 'alice',
      value: true,
    })
  ).status,
  200,
);
assert.ok(
  (await api.readConversation('alice', 'alice')).find(
    (m) => m.id === note.body.id,
  ).pinnedAt,
);
assert.equal(
  (
    await social('alice', {
      action: 'messageEdit',
      id: note.body.id,
      peer: 'alice',
      text: 'Купить кефир',
      revision: 0,
    })
  ).status,
  200,
);
assert.equal(row(note.body.id).text, 'Купить кефир');
const library = await read('alice', 'action=chatLibrary&peer=alice');
assert.equal(library.status, 200);
assert.equal(library.body.photos, 1);
const scrap = await social('alice', {
  action: 'message',
  id: 'alice',
  text: 'Удалить',
  key: key(),
});
assert.equal(
  (
    await social('alice', {
      action: 'messageDelete',
      ids: [scrap.body.id],
      peer: 'alice',
      everyone: true,
    })
  ).status,
  200,
);
assert.ok(row(scrap.body.id).deletedAt > 0);
assert.equal(
  (
    await social('alice', {
      action: 'messageForward',
      ids: [note.body.id],
      peer: 'alice',
      recipient: 'alice',
      key: key(),
    })
  ).status,
  200,
  'The legacy forward also saves to Избранное',
);

// Quotes: a reply may quote a fragment of the replied message's text.
const question = await social('bob', {
  action: 'message',
  id: 'alice',
  text: 'Встречаемся завтра в восемь у входа?',
  key: key(),
});
const quoteKey = key();
const quoted = await social('alice', {
  action: 'message',
  id: 'bob',
  text: 'Да, буду',
  key: quoteKey,
  replyTo: question.body.id,
  quote: 'в восемь',
});
assert.equal(quoted.status, 200);
assert.equal(row(quoted.body.id).replyQuote, 'в восемь');
assert.deepEqual(
  (await api.readConversation('bob', 'alice')).find(
    (m) => m.id === quoted.body.id,
  ).reply,
  {
    id: question.body.id,
    sender: 'bob',
    name: 'Bob',
    text: 'Встречаемся завтра в восемь у входа?',
    unavailable: false,
    quote: 'в восемь',
  },
);
assert.equal(
  (
    await social('alice', {
      action: 'message',
      id: 'bob',
      text: 'Да, буду',
      key: quoteKey,
      replyTo: question.body.id,
      quote: 'в восемь',
    })
  ).status,
  200,
  'A retried quote reply is idempotent',
);
assert.equal(
  (
    await social('alice', {
      action: 'message',
      id: 'bob',
      text: 'Да, буду',
      key: quoteKey,
      replyTo: question.body.id,
      quote: 'завтра',
    })
  ).status,
  409,
  'A key cannot be reused for another quote',
);
for (const [body, status, why] of [
  [
    { replyTo: question.body.id, quote: 'в девять' },
    403,
    'a quote must occur in the message',
  ],
  [{ quote: 'в восемь' }, 400, 'a quote needs a reply'],
  [
    { replyTo: question.body.id, quote: 'x'.repeat(1025) },
    400,
    'a quote is at most 1024 characters',
  ],
  [{ replyTo: question.body.id, quote: '   ' }, 400, 'a quote is not blank'],
  [{ replyTo: question.body.id, quote: 42 }, 400, 'a quote is text'],
])
  assert.equal(
    (
      await social('alice', {
        action: 'message',
        id: 'bob',
        text: 'Ответ',
        key: key(),
        ...body,
      })
    ).status,
    status,
    why,
  );
const plainReply = await social('alice', {
  action: 'message',
  id: 'bob',
  text: 'Ок',
  key: key(),
  replyTo: question.body.id,
});
assert.equal(
  'quote' in
    (await api.readConversation('alice', 'bob')).find(
      (m) => m.id === plainReply.body.id,
    ).reply,
  false,
  'A reply without a quote keeps its old shape',
);
await social('bob', {
  action: 'messageDelete',
  ids: [question.body.id],
  peer: 'alice',
  everyone: true,
});
assert.deepEqual(
  (await api.readConversation('alice', 'bob')).find(
    (m) => m.id === quoted.body.id,
  ).reply,
  {
    id: question.body.id,
    sender: '',
    name: '',
    text: 'Сообщение недоступно',
    unavailable: true,
  },
  'A deleted message takes its quote with it',
);

// Group quotes.
const group = await api.changeRoom('alice', {
  action: 'create',
  kind: 'group',
  name: 'Друзья',
  memberIds: ['bob', 'carol'],
});
const plan = key();
await api.changeRoom('bob', {
  action: 'send',
  id: group.id,
  key: plan,
  text: 'Кино в субботу, сеанс в 19:30',
});
const groupQuote = key();
await api.changeRoom('alice', {
  action: 'send',
  id: group.id,
  key: groupQuote,
  text: 'Беру билеты',
  replyTo: plan,
  quote: 'сеанс в 19:30',
});
const groupReply = (await api.readRoom('carol', group.id)).messages.find(
  (m) => m.id === groupQuote,
).reply;
assert.equal(groupReply.quote, 'сеанс в 19:30');
await api.changeRoom('alice', {
  action: 'send',
  id: group.id,
  key: groupQuote,
  text: 'Беру билеты',
  replyTo: plan,
  quote: 'сеанс в 19:30',
});
await assert.rejects(
  api.changeRoom('alice', {
    action: 'send',
    id: group.id,
    key: groupQuote,
    text: 'Беру билеты',
    replyTo: plan,
    quote: 'Кино',
  }),
  (error) => error.status === 409,
);
await assert.rejects(
  api.changeRoom('alice', {
    action: 'send',
    id: group.id,
    key: key(),
    text: 'Нет',
    replyTo: plan,
    quote: 'в кино',
  }),
  (error) => error.status === 409,
);
await assert.rejects(
  api.changeRoom('alice', {
    action: 'send',
    id: group.id,
    key: key(),
    text: 'Нет',
    quote: 'Кино',
  }),
  (error) => error.status === 400,
);

// Forwarding a direct message with a photo into a group: members outside the
// original chat can open the photo through the group's reference.
const bobPhoto = await upload('bob', { peer: 'alice' });
const bobPhotoMessage = await social('bob', {
  action: 'message',
  id: 'alice',
  text: 'Смотри закат',
  attachments: [bobPhoto.body.id],
  key: key(),
});
assert.equal(await media('carol', bobPhoto.body.id), 404);
const forwardKey = key();
const toGroup = await forward('alice', {
  key: forwardKey,
  source: { dm: { peer: 'bob', ids: [bobPhotoMessage.body.id] } },
  targets: [{ room: { roomId: group.id } }],
});
assert.equal(toGroup.status, 200);
assert.equal(toGroup.body.results.length, 1);
assert.equal(toGroup.body.results[0].ok, true);
const [copyId] = toGroup.body.results[0].ids;
assert.match(
  copyId,
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  'Room copies get UUIDs',
);
assert.equal(
  copyId,
  await api.forwardRoomMessageId(`forward:alice:${forwardKey}-0:0`),
);
const copy = (await api.readRoom('carol', group.id)).messages.find(
  (m) => m.id === copyId,
);
assert.equal(copy.text, 'Смотри закат');
assert.equal(copy.forwardedName, 'Bob');
assert.equal(copy.forwardedFrom, 'bob');
assert.equal(copy.attachments[0].id, bobPhoto.body.id);
assert.equal(
  await media('carol', bobPhoto.body.id),
  200,
  'The group reference grants access',
);
assert.equal(await media('dave', bobPhoto.body.id), 404);
assert.equal(
  (
    await forward('alice', {
      key: forwardKey,
      source: { dm: { peer: 'bob', ids: [bobPhotoMessage.body.id] } },
      targets: [{ room: { roomId: group.id } }],
    })
  ).body.results[0].ids[0],
  copyId,
  'A retried forward reuses its ids',
);
assert.equal(
  sql
    .prepare(
      'SELECT COUNT(*) AS n FROM chat_room_messages WHERE roomId=? AND forwardedName<>?',
    )
    .get(group.id, '').n,
  1,
);
assert.equal(
  sql
    .prepare('SELECT forwardedName FROM chat_room_messages WHERE id=?')
    .get(plan).forwardedName,
  '',
  'Ordinary group messages carry no attribution',
);

// Forwarding from a group to a direct chat keeps the original author, even
// through another forward.
const toDave = await forward('carol', {
  key: key(),
  source: { room: { roomId: group.id, ids: [copyId, plan] } },
  targets: [{ dm: { peer: 'dave' } }],
});
assert.equal(toDave.status, 200);
const [photoCopy, planCopy] = toDave.body.results[0].ids;
const daveChat = await api.readConversation('dave', 'carol');
assert.equal(daveChat.find((m) => m.id === photoCopy).forwardedName, 'Bob');
assert.equal(daveChat.find((m) => m.id === photoCopy).forwardedSender, 'bob');
assert.equal(daveChat.find((m) => m.id === planCopy).forwardedSender, 'bob');
assert.equal(
  daveChat.find((m) => m.id === planCopy).text,
  'Кино в субботу, сеанс в 19:30',
);
assert.ok(
  daveChat.find((m) => m.id === photoCopy).created <
    daveChat.find((m) => m.id === planCopy).created,
  'Forwarded messages keep their order',
);
assert.equal(await media('dave', bobPhoto.body.id), 200);
assert.equal(
  sql
    .prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE userId='dave' AND kind='message'",
    )
    .get().n,
  2,
);
assert.equal(
  (
    await social('carol', {
      action: 'messageEdit',
      id: planCopy,
      peer: 'dave',
      text: 'Подмена',
      revision: 0,
    })
  ).status,
  403,
  'Forwarded messages cannot be edited',
);

// A feed post shared to several chats at once, with a comment first.
sql
  .prepare(
    "INSERT INTO posts(id,userId,text,created) VALUES('post-1','carol','Мой новый рассказ',?)",
  )
  .run(Date.now());
const share = await forward('alice', {
  key: key(),
  source: { post: { postId: 'post-1' } },
  targets: [
    { dm: { peer: 'alice' } },
    { dm: { peer: 'bob' } },
    { room: { roomId: group.id } },
  ],
  comment: 'Почитайте',
});
assert.equal(share.status, 200);
assert.deepEqual(
  share.body.results.map((result) => result.ok),
  [true, true, true],
);
assert.ok(share.body.results.every((result) => result.ids.length === 2));
const [savedComment, savedShare] = share.body.results[0].ids;
assert.equal(row(savedComment).text, 'Почитайте');
assert.equal(row(savedShare).postShareId, 'post-1');
assert.equal(row(savedShare).read, 1);
const savedChat = await api.readConversation('alice', 'alice');
assert.deepEqual(savedChat.find((m) => m.id === savedShare).postShare, {
  id: 'post-1',
});
assert.equal(savedChat.find((m) => m.id === savedComment).postShare, undefined);
assert.equal(
  (await read('bob', 'action=threads&archived=0')).body.find(
    (t) => t.id === 'alice',
  ).lastText,
  'Публикация',
);
const roomShare = (await api.readRoom('bob', group.id)).messages.find(
  (m) => m.id === share.body.results[2].ids[1],
);
assert.deepEqual(roomShare.postShare, { id: 'post-1' });
assert.equal(roomShare.forwardedName, undefined);
assert.equal(
  (await api.listRooms('bob')).rooms.find((room) => room.id === group.id)
    .lastMessage.text,
  'Публикация',
);

// Post previews follow each viewer's feed rules.
const previews = await read('bob', 'action=postPreviews&ids=post-1,missing');
assert.equal(previews.status, 200);
assert.deepEqual(
  previews.body.map((preview) => [
    preview.id,
    preview.name,
    preview.text,
    preview.media,
  ]),
  [['post-1', 'Carol', 'Мой новый рассказ', null]],
);
sql.exec(
  "INSERT INTO user_blocks(blocker,blocked,created) VALUES('bob','carol',1)",
);
assert.deepEqual(
  (await read('bob', 'action=postPreviews&ids=post-1')).body,
  [],
);
sql.exec("DELETE FROM user_blocks WHERE blocker='bob'");
assert.equal((await read('bob', 'action=postPreviews&ids=')).status, 400);
assert.equal(
  (
    await read(
      'bob',
      'action=postPreviews&ids=' +
        Array.from({ length: 31 }, (_, i) => 'p' + i).join(','),
    )
  ).status,
  400,
);

// Each chat succeeds or fails on its own.
sql.exec(
  "INSERT INTO user_privacy(userId,hideAdult,messagePolicy) VALUES('erin',0,'nobody')",
);
const partial = await forward('alice', {
  key: key(),
  source: { dm: { peer: 'alice', ids: [note.body.id] } },
  targets: [{ dm: { peer: 'erin' } }, { dm: { peer: 'bob' } }],
});
assert.equal(partial.status, 200);
assert.deepEqual(
  partial.body.results.map((result) => result.ok),
  [false, true],
);
assert.match(partial.body.results[0].error, /недоступна/);
assert.equal(
  (
    await forward('alice', {
      key: key(),
      source: { dm: { peer: 'alice', ids: [note.body.id] } },
      targets: [{ dm: { peer: 'erin' } }],
    })
  ).status,
  403,
  'A single failed chat fails the request',
);

// Sources and targets are checked for the forwarding person.
for (const [viewer, body, status, why] of [
  [
    'dave',
    {
      source: { dm: { peer: 'alice', ids: [bobPhotoMessage.body.id] } },
      targets: [{ dm: { peer: 'dave' } }],
    },
    403,
    'another chat',
  ],
  [
    'dave',
    {
      source: { room: { roomId: group.id, ids: [plan] } },
      targets: [{ dm: { peer: 'dave' } }],
    },
    403,
    'a group you are not in',
  ],
  [
    'dave',
    {
      source: { dm: { peer: 'carol', ids: [planCopy] } },
      targets: [{ room: { roomId: group.id } }],
    },
    403,
    'into a group you are not in',
  ],
  [
    'alice',
    {
      source: { dm: { peer: 'bob', ids: [] } },
      targets: [{ dm: { peer: 'alice' } }],
    },
    400,
    'nothing selected',
  ],
  [
    'alice',
    {
      source: { dm: { peer: 'bob', ids: [bobPhotoMessage.body.id] } },
      targets: [],
    },
    400,
    'no chats',
  ],
  [
    'alice',
    {
      source: { dm: { peer: 'bob', ids: [bobPhotoMessage.body.id] } },
      targets: Array.from({ length: 11 }, (_, i) => ({
        dm: { peer: 'u' + i },
      })),
    },
    400,
    'too many chats',
  ],
  [
    'alice',
    {
      source: { dm: { peer: 'bob', ids: [bobPhotoMessage.body.id] } },
      targets: [{ dm: { peer: 'bob' } }, { dm: { peer: 'bob' } }],
    },
    400,
    'the same chat twice',
  ],
  [
    'alice',
    {
      source: { post: { postId: 'missing' } },
      targets: [{ dm: { peer: 'alice' } }],
    },
    404,
    'a missing post',
  ],
  [
    'alice',
    {
      source: {
        dm: { peer: 'bob', ids: [bobPhotoMessage.body.id] },
        post: { postId: 'post-1' },
      },
      targets: [{ dm: { peer: 'alice' } }],
    },
    400,
    'two sources',
  ],
  [
    'alice',
    {
      source: { dm: { peer: 'bob', ids: [bobPhotoMessage.body.id] } },
      targets: [{ dm: { peer: 'noctgram' } }],
    },
    403,
    'the system account',
  ],
])
  assert.equal(
    (await forward(viewer, { key: key(), ...body })).status,
    status,
    why,
  );
assert.equal(
  (
    await forward('alice', {
      key: 'short',
      source: { post: { postId: 'post-1' } },
      targets: [{ dm: { peer: 'alice' } }],
    })
  ).status,
  400,
);
assert.equal(
  (
    await forward('alice', {
      key: key(),
      comment: 'x'.repeat(4001),
      source: { post: { postId: 'post-1' } },
      targets: [{ dm: { peer: 'alice' } }],
    })
  ).status,
  400,
);
const reusedKey = key();
await forward('alice', {
  key: reusedKey,
  source: { post: { postId: 'post-1' } },
  targets: [{ dm: { peer: 'alice' } }],
});
assert.equal(
  (
    await forward('alice', {
      key: reusedKey,
      source: { post: { postId: 'post-1' } },
      targets: [{ dm: { peer: 'bob' } }],
    })
  ).status,
  409,
  'A key cannot be reused for another chat',
);

// Moderated files cannot be forwarded.
sql.exec('PRAGMA foreign_keys=OFF');
sql
  .prepare(
    "INSERT INTO moderated_uploads(uploadId,removalId) VALUES(?,'removal')",
  )
  .run(bobPhoto.body.id);
sql.exec('PRAGMA foreign_keys=ON');
assert.equal(
  (
    await forward('alice', {
      key: key(),
      source: { dm: { peer: 'bob', ids: [bobPhotoMessage.body.id] } },
      targets: [{ dm: { peer: 'alice' } }],
    })
  ).status,
  403,
);

// Forum groups: a forwarded message goes to the chosen open topic.
const forumGroup = await api.changeRoom('alice', {
  action: 'create',
  kind: 'group',
  name: 'Форум',
  memberIds: ['bob'],
});
await api.changeRoom('alice', { action: 'forum', id: forumGroup.id, enabled: true });
const movies = await api.changeRoom('alice', {
  action: 'topicCreate',
  id: forumGroup.id,
  title: 'Кино',
});
const closed = await api.changeRoom('alice', {
  action: 'topicCreate',
  id: forumGroup.id,
  title: 'Архив',
});
await api.changeRoom('alice', {
  action: 'topicClose',
  id: forumGroup.id,
  topicId: closed.id,
});
const topicForward = await forward('bob', {
  key: key(),
  source: { post: { postId: 'post-1' } },
  targets: [
    { room: { roomId: forumGroup.id, topicId: movies.id } },
    { dm: { peer: 'bob' } },
  ],
});
assert.equal(topicForward.status, 200);
const [inTopic] = topicForward.body.results[0].ids;
assert.equal(
  sql.prepare('SELECT topicId FROM chat_room_messages WHERE id=?').get(inTopic)
    .topicId,
  movies.id,
);
const general = await forward('bob', {
  key: key(),
  source: { post: { postId: 'post-1' } },
  targets: [{ room: { roomId: forumGroup.id, topicId: 'general' } }],
});
assert.equal(
  sql
    .prepare('SELECT topicId FROM chat_room_messages WHERE id=?')
    .get(general.body.results[0].ids[0]).topicId,
  '',
  '«Общее» is the empty topic',
);
assert.equal(
  (
    await forward('bob', {
      key: key(),
      source: { post: { postId: 'post-1' } },
      targets: [{ room: { roomId: forumGroup.id, topicId: closed.id } }],
    })
  ).status,
  403,
  'A member cannot forward into a closed topic',
);
assert.equal(
  (
    await forward('alice', {
      key: key(),
      source: { post: { postId: 'post-1' } },
      targets: [{ room: { roomId: forumGroup.id, topicId: closed.id } }],
    })
  ).status,
  200,
  'The owner still can',
);
assert.equal(
  (
    await forward('bob', {
      key: key(),
      source: { post: { postId: 'post-1' } },
      targets: [{ room: { roomId: group.id, topicId: movies.id } }],
    })
  ).status,
  403,
  'A topic of another group is refused',
);
