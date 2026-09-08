import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { checkChatActions } from './chat-actions-harness.mjs';

// Exercise real SQL, migrations and routes without touching local conversations.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const entry of journal.entries)
  sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
sqlite.exec(
  "INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1)",
);
const objects = new Map();
let failNotification = false,
  failUpload = false,
  batchTail = Promise.resolve();
globalThis.__chatFilesDb = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) || null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      async run() {
        if (failNotification && sql.includes('INTO notifications')) {
          failNotification = false;
          throw new Error('Notification storage failed');
        }
        if (failUpload && sql.includes('INTO chat_uploads')) {
          failUpload = false;
          throw new Error('Upload storage failed');
        }
        return {
          meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
        };
      },
    };
  },
  batch(statements) {
    const transaction = batchTail.then(async () => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    });
    batchTail = transaction.catch(() => {});
    return transaction;
  },
};
globalThis.__chatFilesBucket = {
  async put(id, bytes, metadata) {
    objects.set(id, { bytes, metadata });
  },
  async delete(id) {
    objects.delete(id);
  },
  async get(id, options) {
    const object = objects.get(id);
    if (!object) return null;
    const bytes = object.bytes;
    const requested = options?.range
      ?.get('range')
      ?.match(/^bytes=(\d+)-(\d+)$/);
    const start = requested ? Number(requested[1]) : 0;
    const end = requested ? Number(requested[2]) + 1 : bytes.length;
    return {
      body: bytes.slice(start, end),
      size: bytes.length,
      httpEtag: '"fixture"',
      ...(requested ? { range: { offset: start, length: end - start } } : {}),
      writeHttpMetadata(headers) {
        headers.set('Content-Type', object.metadata.httpMetadata.contentType);
      },
    };
  },
};
globalThis.__chatFilesViewer = 'alice';
const compiled = await build({
  stdin: {
    contents: `export * from './lib/chat-files'; export * from './lib/chat-uploads';
      export * from './lib/chat-messages'; export { sendPrivateMessage } from './lib/privacy';
      export * from './lib/media-access';
      export * from './lib/chat-actions'; export * from './lib/chat-message-display'; export { sendGift } from './lib/gifts';
      export { GET as mediaGET } from './app/api/media/[id]/route';
      export { POST as uploadPOST, DELETE as uploadDELETE } from './app/api/chat-upload/route';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'isolated-chat-storage',
      setup(build) {
        build.onResolve({ filter: /^\.\/auth-session$/ }, ({ path }) => ({
          path,
          namespace: 'auth-fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'auth-fixture' }, () => ({
          contents:
            'import {createHash} from "node:crypto"; export const tokenHash=async(value)=>createHash("sha256").update(value).digest("hex");',
        }));
        build.onResolve(
          { filter: /^(\.\/|@\/lib\/)(storage|server)$/ },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `import { ApiError } from './lib/api-error';
          export { ApiError, failure } from './lib/api-error';
          export const db=()=>globalThis.__chatFilesDb, bucket=()=>globalThis.__chatFilesBucket, clean=value=>value;
          export const viewer=async()=>{if(!globalThis.__chatFilesViewer) throw new ApiError(401,'Войдите'); return globalThis.__chatFilesViewer;};`,
          resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const count = (table) =>
  Number(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
const status = (code) => (error) => error.status === code;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const mp4 = new Uint8Array([
  0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109,
]);
const file = (bytes = png, name = 'Фото.png', type = 'image/png') =>
  new File([bytes], name, { type });
const upload = (me = 'alice', peer = 'bob', item = file()) =>
  api.storeChatUpload(me, peer, item);
let sequence = 0;
const send = (
  ids,
  text = '',
  me = 'alice',
  peer = 'bob',
  key = `chat-request-${String(++sequence).padStart(8, '0')}`,
) => api.sendPrivateMessage(me, peer, text, ids, key);
async function media(id, viewer, suffix = '', headers = {}) {
  globalThis.__chatFilesViewer = viewer;
  return api.mediaGET(
    new Request('http://localhost/api/media/' + id + suffix, { headers }),
    { params: Promise.resolve({ id }) },
  );
}
async function multipart(item, peer = 'bob', headers = {}) {
  globalThis.__chatFilesViewer = 'alice';
  const body = new FormData();
  body.set('file', item);
  body.set('peer', peer);
  // Serialize the multipart envelope before testing cancellation. Node's
  // FormData encoder otherwise enqueues asynchronously into a cancelled stream.
  const encoded = new Response(body);
  return api.uploadPOST(
    new Request('http://localhost/api/chat-upload', {
      method: 'POST',
      headers: {
        'Content-Type': encoded.headers.get('content-type'),
        ...headers,
      },
      body: await encoded.arrayBuffer(),
    }),
  );
}

const photo = await upload();
assert.equal(photo.kind, 'image');
assert.equal((await media(photo.id, 'alice')).status, 200);
assert.equal(
  (await media(photo.id, 'bob')).status,
  404,
  'A recipient cannot read a draft before it is sent',
);
assert.equal((await media(photo.id, 'carol')).status, 404);
assert.equal((await media(photo.id, null)).status, 401);
const video = await upload('alice', 'bob', file(mp4, 'Видео.mp4', 'video/mp4'));
assert.equal(video.kind, 'video');
const document = await upload(
  'alice',
  'bob',
  file('<script>alert(1)</script>', 'план\n/папка\\тест.html', 'text/html'),
);
assert.equal(document.kind, 'file');
assert.equal(document.type, 'application/octet-stream');
assert.equal(document.name, 'план__папка_тест.html');
const documentResponse = await media(document.id, 'alice');
assert.equal(
  documentResponse.headers.get('content-type'),
  'application/octet-stream',
);
assert.match(
  documentResponse.headers.get('content-disposition'),
  /^attachment;.*filename\*=UTF-8''/,
);
assert.equal(documentResponse.headers.get('x-content-type-options'), 'nosniff');
await assert.rejects(
  upload('alice', 'bob', file('definitely not a png')),
  status(400),
);
await assert.rejects(upload('alice', 'alice'), status(400));
await assert.rejects(upload('alice', 'missing'), status(403));
await assert.rejects(upload('alice', 'bob', file('')), status(400));
await assert.rejects(
  upload(
    'alice',
    'bob',
    file(
      new Uint8Array(api.CHAT_FILE_LIMIT + 1),
      'large.bin',
      'application/octet-stream',
    ),
  ),
  status(400),
);
const beforeUploadFailure = [count('uploads'), objects.size];
failUpload = true;
await assert.rejects(upload(), /Upload storage failed/);
assert.deepEqual(
  [count('uploads'), objects.size],
  beforeUploadFailure.map((n) => n + 1),
  'Failed writes retain a charged reservation until durable cleanup removes the object',
);
assert.equal(
  sqlite.prepare("SELECT COUNT(*) n FROM uploads WHERE state='deleting'").get()
    .n,
  1,
);

const ids = [document.id, photo.id, video.id];
const key = 'same-message-request-0001';
const before = [count('messages'), count('notifications')];
const [sent, repeated] = await Promise.all([
  send(ids, '', 'alice', 'bob', key),
  send(ids, '', 'alice', 'bob', key),
]);
assert.deepEqual(repeated, sent);
assert.deepEqual(
  [count('messages'), count('notifications')],
  before.map((n) => n + 1),
);
assert.equal(
  sqlite
    .prepare('SELECT messageId FROM chat_uploads WHERE uploadId=?')
    .get(photo.id).messageId,
  sent.id,
);
const incoming = (await api.readConversation('bob', 'alice')).find(
  (m) => m.id === sent.id,
);
assert.deepEqual(
  incoming.attachments,
  [document, photo, video],
  'Attachment metadata and ordering come from stored uploads',
);
assert.equal(incoming.text, '', 'Files can be sent without a caption');
assert.equal((await api.readConversation('carol', 'alice')).length, 0);
assert.equal((await media(photo.id, 'bob')).status, 200);
const range = await media(video.id, 'bob', '', { Range: 'bytes=4-7' });
assert.equal(range.status, 206);
assert.equal(range.headers.get('content-range'), 'bytes 4-7/12');
assert.equal(await range.text(), 'ftyp');
assert.equal(
  (await media(video.id, 'carol', '', { Range: 'bytes=4-7' })).status,
  404,
);
assert.match(
  (await media(photo.id, 'bob', '?download=1')).headers.get(
    'content-disposition',
  ),
  /^attachment;/,
);
assert.equal((await media(photo.id, 'carol', '?download=1')).status, 404);
assert.equal(
  (await media(photo.id, 'bob')).headers.get('cache-control'),
  'private, no-store',
);

// Even a malicious old public reference must never widen a private file's ACL.
sqlite
  .prepare('UPDATE users SET avatar=? WHERE id=?')
  .run('/api/media/' + photo.id, 'alice');
assert.equal((await media(photo.id, 'carol')).status, 404);
const allowedPublic = sqlite.prepare(
  `SELECT 1 WHERE ${api.mediaPermission('?', "'alice'")}`,
);
const bindings = (api.mediaPermission('?', "'alice'").match(/\?/g) || []).map(
  () => photo.id,
);
assert.equal(
  allowedPublic.get(...bindings),
  undefined,
  'Private uploads cannot be assigned to public content even by their owner',
);
sqlite.exec("UPDATE users SET avatar='' WHERE id='alice'");
await assert.rejects(send(ids, 'Changed', 'alice', 'bob', key), status(409));
await assert.rejects(
  send([photo.id]),
  status(403),
  'A sent upload cannot be reused for a new message',
);
await assert.rejects(send([photo.id], '', 'carol', 'bob'), status(403));
const wrongPeer = await upload('alice', 'carol');
await assert.rejects(send([wrongPeer.id]), status(403));
const others = await upload('carol', 'bob');
await assert.rejects(send([others.id]), status(403));
const pending = await upload();
await assert.rejects(send([pending.id, pending.id]), status(400));
await assert.rejects(
  send(Array.from({ length: 11 }, (_, i) => 'file' + i)),
  status(400),
);
await assert.rejects(send([]), status(400));
await assert.rejects(send([pending.id], '', 'alice', 'bob', key), status(409));
assert.equal(
  sqlite
    .prepare('SELECT messageId FROM chat_uploads WHERE uploadId=?')
    .get(pending.id).messageId,
  null,
);
const beforeRollback = [count('messages'), count('notifications')];
failNotification = true;
await assert.rejects(send([pending.id]), /Notification storage failed/);
assert.deepEqual([count('messages'), count('notifications')], beforeRollback);
assert.equal(
  sqlite
    .prepare('SELECT messageId FROM chat_uploads WHERE uploadId=?')
    .get(pending.id).messageId,
  null,
  'Message/claim/notification roll back together',
);
await api.discardChatUpload('bob', pending.id);
assert.equal(objects.has(pending.id), true);
await api.discardChatUpload('alice', pending.id);
assert.equal(objects.has(pending.id), false);
assert.equal(
  sqlite.prepare('SELECT 1 FROM chat_uploads WHERE uploadId=?').get(pending.id),
  undefined,
);
await api.discardChatUpload('alice', photo.id);
assert.equal(
  objects.has(photo.id),
  true,
  'The composer cannot delete already-sent files during cleanup',
);

const pin = (me, id, value = true, peer = me === 'bob' ? 'alice' : 'bob') =>
  api.pinMessage(me, { id, peer, value });
await pin('alice', sent.id);
assert.ok(
  (await api.readConversation('bob', 'alice')).find((m) => m.id === sent.id)
    .pinnedAt,
);
await pin('bob', sent.id, false);
assert.equal(count('message_pins'), 0);
await pin('bob', sent.id);
await assert.rejects(pin('carol', sent.id), status(403));
await assert.rejects(pin('carol', sent.id, false), status(403));
assert.equal(count('message_pins'), 1);
const restrictedFile = await upload();
sqlite.exec(
  "INSERT INTO user_blocks(blocker,blocked,created) VALUES('bob','alice',1)",
);
await assert.rejects(upload(), status(403));
await assert.rejects(send([restrictedFile.id]), status(403));
await assert.rejects(pin('alice', sent.id, false), status(403));
sqlite.exec('DELETE FROM user_blocks');
sqlite.exec(
  "INSERT INTO user_privacy(userId,messagePolicy) VALUES('bob','nobody')",
);
await assert.rejects(upload(), status(403));
await assert.rejects(send([restrictedFile.id]), status(403));
await assert.rejects(pin('alice', sent.id, false), status(403));
sqlite.exec('DELETE FROM user_privacy');
sqlite.exec(
  "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('restriction','alice','carol','read_only','fixture',1)",
);
sqlite.exec(
  "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('alice','restriction','read_only','fixture',1)",
);
await assert.rejects(upload(), status(403));
await assert.rejects(send([restrictedFile.id]), status(403));
await assert.rejects(pin('alice', sent.id, false), status(403));
sqlite.exec("UPDATE account_restrictions SET mode='blocked'");
assert.equal((await media(photo.id, 'alice')).status, 403);
await assert.rejects(pin('bob', sent.id, false), status(403));
sqlite.exec('DELETE FROM account_restrictions');

sqlite.exec(
  "INSERT INTO content_removals(id,targetType,targetId,postId,authorId,moderatorId,text,snapshot,reason,created) VALUES('removal','message','fixture','','alice','carol','','{}','fixture',1)",
);
sqlite
  .prepare('INSERT INTO moderated_uploads(uploadId,removalId) VALUES(?,?)')
  .run(restrictedFile.id, 'removal');
await assert.rejects(send([restrictedFile.id]), status(403));
sqlite
  .prepare('INSERT INTO moderated_uploads(uploadId,removalId) VALUES(?,?)')
  .run(photo.id, 'removal');
assert.equal(
  (await media(photo.id, 'bob')).status,
  404,
  'Moderation still applies to private media',
);

// More than 300 messages must not evict a pinned message from the conversation.
for (let i = 0; i < 310; i++)
  sqlite
    .prepare(
      'INSERT INTO messages(id,sender,recipient,text,created) VALUES(?,?,?,?,?)',
    )
    .run(
      'history-' + i,
      'alice',
      'bob',
      'Сообщение ' + i,
      Date.now() + 1000 + i,
    );
for (let i = 0; i < 9; i++) await pin('alice', 'history-' + i);
await pin('alice', sent.id); // idempotent even at capacity
await assert.rejects(pin('alice', 'history-9'), status(400));
assert.equal(count('message_pins'), 10);
const longHistory = await api.readConversation('bob', 'alice');
assert.equal(longHistory.length, 310);
assert.equal(longHistory.filter((m) => m.pinnedAt).length, 10);
assert.ok(longHistory.some((m) => m.id === sent.id));
const changes = sqlite.prepare('SELECT total_changes() n').get().n;
await api.readConversation('bob', 'alice');
assert.equal(
  sqlite.prepare('SELECT total_changes() n').get().n,
  changes,
  'Repeated pin/history polling performs no redundant writes',
);
await pin('bob', sent.id, false);
assert.equal(
  (await api.readConversation('bob', 'alice')).some((m) => m.id === sent.id),
  false,
);

// Real multipart route: auth, origins, bounded streaming and parsing.
const accepted = await multipart(file());
assert.equal(accepted.status, 200);
const acceptedFile = await accepted.json();
assert.equal(acceptedFile.kind, 'image');
assert.equal(
  (await multipart(file(), 'bob', { Origin: 'https://elsewhere.example' }))
    .status,
  403,
);
assert.equal(
  (await multipart(file(), 'bob', { 'Sec-Fetch-Site': 'cross-site' })).status,
  403,
);
assert.equal(
  (
    await multipart(file(), 'bob', {
      'Content-Length': String(api.CHAT_FILE_LIMIT + 65537),
    })
  ).status,
  413,
);
assert.equal(
  (
    await multipart(
      file(
        new Uint8Array(api.CHAT_FILE_LIMIT + 65537),
        'large.bin',
        'application/octet-stream',
      ),
    )
  ).status,
  413,
);
const largeValid = new Uint8Array(2 * 1024 * 1024);
largeValid.set(mp4);
const multiMegabyte = await multipart(
  file(largeValid, 'movie.mp4', 'video/mp4'),
);
assert.equal(multiMegabyte.status, 200);
const multiFile = await multiMegabyte.json();
assert.equal(multiFile.size, largeValid.length);
const deleted = await api.uploadDELETE(
  new Request('http://localhost/api/chat-upload', {
    method: 'DELETE',
    body: JSON.stringify({ id: multiFile.id }),
  }),
);
assert.equal(deleted.status, 200);
assert.equal(objects.has(multiFile.id), false);
const malformed = await api.uploadPOST(
  new Request('http://localhost/api/chat-upload', {
    method: 'POST',
    body: 'not multipart',
  }),
);
assert.equal(malformed.status, 400);
globalThis.__chatFilesViewer = null;
assert.equal(
  (
    await api.uploadPOST(
      new Request('http://localhost/api/chat-upload', {
        method: 'POST',
        body: 'fixture',
      }),
    )
  ).status,
  401,
);

await checkChatActions(api, sqlite, {
  upload,
  send,
  media,
  failNextNotification: () => {
    failNotification = true;
  },
});
sqlite.close();
delete globalThis.__chatFilesDb;
delete globalThis.__chatFilesBucket;
delete globalThis.__chatFilesViewer;
console.log(
  'Private attachments/pins: real SQL, multipart limits, participant ACL, safe downloads, video ranges, idempotency, rollback, privacy/moderation and long histories passed.',
);
