import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Group attachments: drafts scoped to one group, binding on send, access that
// follows live message copies, cleanup references and account removal.
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
const objects = new Map();
globalThis.__roomMediaDb = {
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
        return {
          meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
        };
      },
    };
  },
  async batch(statements) {
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
  },
};
globalThis.__roomMediaBucket = {
  async put(id, bytes, metadata) {
    objects.set(id, { bytes, metadata });
  },
  async delete(id) {
    objects.delete(id);
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
globalThis.__roomMediaViewer = 'alice';
const root = fileURLToPath(new URL('..', import.meta.url));
const compiled = await build({
  stdin: {
    contents: `export * from './lib/rooms'; export * from './lib/chat-uploads';
      export * from './lib/media-access'; export { uploadReferenced } from './lib/upload-storage';
      export { deleteAccount } from './lib/account-removal';
      export { GET as mediaGET } from './app/api/media/[id]/route';
      export { POST as uploadPOST } from './app/api/chat-upload/route';`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'room-media-fixtures',
      setup(build) {
        build.onResolve({ filter: /^\.\/auth-session$/ }, ({ path }) => ({
          path,
          namespace: 'auth-fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'auth-fixture' }, () => ({
          contents:
            'import {createHash} from "node:crypto"; export const setting=()=> "1"; export const tokenHash=async(value)=>createHash("sha256").update(value).digest("hex");',
        }));
        build.onResolve(
          { filter: /^(\.\/|@\/lib\/)(storage|server)$/ },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `import { ApiError } from './lib/api-error';
          export { ApiError, failure } from './lib/api-error';
          export const db=()=>globalThis.__roomMediaDb, bucket=()=>globalThis.__roomMediaBucket, clean=value=>value;
          export const viewer=async()=>{if(!globalThis.__roomMediaViewer) throw new ApiError(401,'Войдите'); return globalThis.__roomMediaViewer;};`,
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
let now = Date.now();
const change = (me, body) => api.changeRoom(me, body, ++now);
const deny = (promise, status = 403) =>
  assert.rejects(promise, (error) => error.status === status);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const photo = (name = 'photo.png') =>
  new File([png], name, { type: 'image/png' });
const one = (sql, ...values) => sqlite.prepare(sql).get(...values);

const group = await change('alice', {
  action: 'create',
  kind: 'group',
  name: 'Media',
  memberIds: ['bob', 'carol'],
});
const secret = await change('alice', {
  action: 'create',
  kind: 'secret',
  peerId: 'bob',
});

// Drafts: only writable members of an ordinary group may upload.
const draft = await api.storeRoomUpload('alice', group.id, photo());
assert.equal(draft.kind, 'image');
assert.equal(one('SELECT roomId FROM chat_room_uploads WHERE uploadId=?', draft.id).roomId, group.id);
await deny(api.storeRoomUpload('dave', group.id, photo()));
await deny(api.storeRoomUpload('alice', secret.id, photo()));
await assert.rejects(
  api.storeRoomUpload('alice', group.id, new File([png], 'fake.webm', { type: 'video/webm' })),
  (error) => error.status === 400,
);
// Only the uploader previews an unsent draft.
await api.assertMediaRead(draft.id, 'alice', 'alice');
await deny(api.assertMediaRead(draft.id, 'bob', 'alice'), 404);

// Sending binds the draft; the ref index follows the stored copy.
const key = crypto.randomUUID();
await change('alice', {
  action: 'send',
  id: group.id,
  key,
  attachments: [draft.id],
});
assert.equal(one('SELECT messageId FROM chat_room_uploads WHERE uploadId=?', draft.id).messageId, key);
assert.equal(one("SELECT COUNT(*) AS n FROM chat_media_refs WHERE uploadId=? AND surface='room'", draft.id).n, 1);
// The same request is idempotent; changing its attachments is a conflict.
await change('alice', { action: 'send', id: group.id, key, attachments: [draft.id] });
const other = await api.storeRoomUpload('alice', group.id, photo('other.png'));
await deny(
  change('alice', { action: 'send', id: group.id, key, attachments: [other.id] }),
  409,
);
// A bound file cannot be attached again, and nobody else can send alice's draft.
await deny(
  change('alice', { action: 'send', id: group.id, key: crypto.randomUUID(), attachments: [draft.id] }),
);
await deny(
  change('bob', { action: 'send', id: group.id, key: crypto.randomUUID(), attachments: [other.id] }),
);
// Group messages still need text or a file.
await deny(change('alice', { action: 'send', id: group.id, key: crypto.randomUUID(), text: '  ' }), 400);
await deny(
  change('alice', { action: 'send', id: group.id, key: crypto.randomUUID(), media: [] }),
  400,
);

// Members read the attachment; outsiders and former members do not.
await api.assertMediaRead(draft.id, 'bob', 'alice');
await deny(api.assertMediaRead(draft.id, 'dave', 'alice'), 404);

// Room history carries attachments and a server-side reply preview.
const replyKey = crypto.randomUUID();
await change('bob', { action: 'send', id: group.id, key: replyKey, text: 'Красиво', replyTo: key });
let detail = await api.readRoom('carol', group.id);
const sent = detail.messages.find((message) => message.id === key);
assert.deepEqual(sent.attachments.map((file) => [file.id, file.kind]), [[draft.id, 'image']]);
// Ordinary files keep the same five keys as direct-message media.
assert.deepEqual(Object.keys(sent.attachments[0]).sort(), ['id', 'kind', 'name', 'size', 'type']);
const reply = detail.messages.find((message) => message.id === replyKey);
assert.deepEqual(reply.reply, {
  id: key,
  sender: 'alice',
  name: 'Alice',
  text: 'Фото',
  unavailable: false,
});
let listed = (await api.listRooms('carol')).rooms.find((room) => room.id === group.id);
assert.equal(listed.lastMessage.text, 'Красиво');
const photoOnly = await api.storeRoomUpload('bob', group.id, photo('last.png'));
await change('bob', { action: 'send', id: group.id, key: crypto.randomUUID(), attachments: [photoOnly.id] });
listed = (await api.listRooms('carol')).rooms.find((room) => room.id === group.id);
assert.equal(listed.lastMessage.text, 'Фото');

// A copy of the file in a direct message is readable by that DM's participants.
const copyId = 'message:carol:' + crypto.randomUUID();
sqlite
  .prepare("INSERT INTO messages(id,sender,recipient,text,media,created) VALUES(?,?,?,?,(SELECT media FROM chat_room_messages WHERE id=?),?)")
  .run(copyId, 'carol', 'dave', '', key, ++now);
await api.assertMediaRead(draft.id, 'dave', 'alice');

// Leaving the group removes access through the group copy; a sent file is no
// longer a private draft of its uploader.
await change('bob', { action: 'leave', id: group.id });
await deny(api.assertMediaRead(photoOnly.id, 'bob', 'bob'), 404);

// Deleting the group message hides its files and drops the cleanup reference.
const referenced = (id) =>
  one(`SELECT (${api.uploadReferenced('?')}) AS live`, ...Array(api.uploadReferenced('?').split('?').length - 1).fill(id)).live;
assert.equal(referenced(draft.id), 1);
await change('alice', { action: 'deleteMessage', id: group.id, messageId: key });
detail = await api.readRoom('carol', group.id);
assert.deepEqual(detail.messages.find((message) => message.id === key).attachments, []);
// The DM copy still keeps the file alive for its own participants only.
assert.equal(referenced(draft.id), 1);
await api.assertMediaRead(draft.id, 'dave', 'alice');
await api.assertMediaRead(draft.id, 'carol', 'alice');
await deny(api.assertMediaRead(draft.id, 'alice', 'alice'), 404);

// HTTP: one target at a time, and group files are served inline.
globalThis.__roomMediaViewer = 'alice';
const form = new FormData();
form.set('file', photo());
form.set('peer', 'bob');
form.set('room', group.id);
const both = await api.uploadPOST(
  new Request('http://local/api/chat-upload', { method: 'POST', body: form }),
);
assert.equal(both.status, 400);
const roomForm = new FormData();
roomForm.set('file', photo('route.png'));
roomForm.set('room', group.id);
const uploaded = await api.uploadPOST(
  new Request('http://local/api/chat-upload', { method: 'POST', body: roomForm }),
);
assert.equal(uploaded.status, 200);
const routed = await uploaded.json();
assert.equal(routed.kind, 'image');
const served = await api.mediaGET(new Request('http://local/api/media/' + routed.id), {
  params: Promise.resolve({ id: routed.id }),
});
assert.equal(served.status, 200);
assert.equal(served.headers.get('Content-Type'), 'image/png');
assert.equal(served.headers.get('Content-Disposition'), null);

// Group files cannot be reused as a group avatar or post media.
await deny(change('alice', { action: 'update', id: group.id, avatar: '/api/media/' + routed.id }), 400);

// Removing the sender's account keeps foreign keys valid and forgets their refs.
const carolKey = crypto.randomUUID();
const carolFile = await api.storeRoomUpload('carol', group.id, photo('carol.png'));
await change('carol', { action: 'send', id: group.id, key: carolKey, attachments: [carolFile.id] });
sqlite
  .prepare("INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) VALUES('carol-session','carol',?,?,?)")
  .run(Date.now(), Date.now() + 3600000, Date.now());
await api.deleteAccount('carol', 'carol-session', false);
assert.equal(one('SELECT COUNT(*) AS n FROM chat_room_messages WHERE id=?', carolKey).n, 0);
assert.equal(one('SELECT messageId FROM chat_room_uploads WHERE uploadId=?', carolFile.id).messageId, null);
assert.equal(one('SELECT COUNT(*) AS n FROM chat_media_refs WHERE messageId=?', carolKey).n, 0);
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
