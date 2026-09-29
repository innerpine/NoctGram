import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Production has group attachments in the 0051 model (room_uploads with the
// room_media_insert_guard/room_media_claim triggers). 0059 moves them into
// chat_room_uploads and chat_media_refs; afterwards reading, sending and
// forwarding still follow the old guard: own ready drafts only, ordinary
// groups only, never next to ciphertext, never a moderated file.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
).entries;
const apply = async (entries) => {
  for (const entry of entries)
    sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
};
assert.equal(journal[58].tag, '0058_profile_details');
await apply(journal.slice(0, 59));

// Old model: a sent photo, a draft and a file that moderation removes later.
sqlite.exec(`
  INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1);
  INSERT INTO chat_rooms(id,kind,ownerId,name,created,updatedAt) VALUES('group','group','alice','Group',1,1),('secret','secret','alice','',1,1);
  INSERT INTO chat_room_members(roomId,userId,role,joinedAt) VALUES('group','alice','owner',1),('group','bob','member',1),('secret','alice','owner',1),('secret','bob','member',1);
  INSERT INTO uploads(id,userId,name,type,bytes,state,created) VALUES
    ('sent','alice','photo.png','image/png',4,'ready',1),
    ('draft','alice','draft.png','image/png',4,'ready',1),
    ('removed','alice','bad.png','image/png',4,'ready',1);
  INSERT INTO room_uploads(uploadId,roomId,size,kind) VALUES('sent','group',4,'image'),('draft','group',4,'image'),('removed','group',4,'image');
`);
const file = (id) => ({
  id,
  name: id + '.png',
  type: 'image/png',
  size: 4,
  kind: 'image',
});
sqlite
  .prepare(
    "INSERT INTO chat_room_messages(id,roomId,sender,text,media,created) VALUES('old-message','group','alice','Old photo',?,5)",
  )
  .run(JSON.stringify([file('sent')]));
const one = (sql, ...values) => ({ ...sqlite.prepare(sql).get(...values) });
assert.equal(
  one("SELECT messageId FROM room_uploads WHERE uploadId='sent'").messageId,
  'old-message',
  'The 0051 claim trigger bound the sent file',
);

await apply(journal.slice(59));
assert.deepEqual(
  sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE name IN ('room_uploads','room_uploads_message','room_media_insert_guard','room_media_claim')",
    )
    .all(),
  [],
  'The old table, its index and its triggers are gone',
);
assert.deepEqual(
  sqlite
    .prepare(
      'SELECT uploadId,roomId,messageId,size,kind,duration,waveform FROM chat_room_uploads ORDER BY uploadId',
    )
    .all()
    .map((row) => ({ ...row })),
  [
    {
      uploadId: 'draft',
      roomId: 'group',
      messageId: null,
      size: 4,
      kind: 'image',
      duration: 0,
      waveform: '',
    },
    {
      uploadId: 'removed',
      roomId: 'group',
      messageId: null,
      size: 4,
      kind: 'image',
      duration: 0,
      waveform: '',
    },
    {
      uploadId: 'sent',
      roomId: 'group',
      messageId: 'old-message',
      size: 4,
      kind: 'image',
      duration: 0,
      waveform: '',
    },
  ],
);
assert.deepEqual(
  sqlite
    .prepare('SELECT uploadId,surface,messageId,created FROM chat_media_refs')
    .all()
    .map((row) => ({ ...row })),
  [{ uploadId: 'sent', surface: 'room', messageId: 'old-message', created: 5 }],
);

globalThis.__upgradeDb = {
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
const root = fileURLToPath(new URL('..', import.meta.url));
const compiled = await build({
  stdin: {
    contents: `export { changeRoom, readRoom } from './lib/rooms';
      export { assertMediaRead } from './lib/media-access';
      export { assertUploadAvailable } from './lib/account-access';
      export { forwardToChats } from './lib/chat-forward';`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'upgrade-fixtures',
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
          contents: `export { ApiError, failure } from './lib/api-error';
          export const db=()=>globalThis.__upgradeDb, bucket=()=>({}), clean=value=>value;`,
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
const deny = (promise, status = 403) =>
  assert.rejects(promise, (error) => error.status === status);
const blocked = (sql, ...values) =>
  assert.throws(() => sqlite.prepare(sql).run(...values), /MEDIA_NOT_ALLOWED/);
let now = Date.now();
const send = (me, room, body) =>
  api.changeRoom(
    me,
    { action: 'send', id: room, key: crypto.randomUUID(), ...body },
    ++now,
  );

// Migrated attachments stay readable by members only; drafts by their owner.
assert.equal(
  (await api.readRoom('bob', 'group')).messages[0].attachments[0].id,
  'sent',
);
await api.assertMediaRead('sent', 'alice', 'alice');
await api.assertMediaRead('sent', 'bob', 'alice');
await deny(api.assertMediaRead('sent', 'carol', 'alice'), 404);
await api.assertMediaRead('draft', 'alice', 'alice');
await deny(api.assertMediaRead('draft', 'bob', 'alice'), 404);

// A migrated draft is still alice's own: bob cannot send it, alice can.
await deny(send('bob', 'group', { attachments: ['draft'] }));
const sent = await send('alice', 'group', { attachments: ['draft'] });
assert.equal(
  one("SELECT messageId FROM chat_room_uploads WHERE uploadId='draft'")
    .messageId,
  sent.id,
);
await deny(send('alice', 'group', { attachments: ['draft'] }));

// Whatever the write path: no media in secret chats or next to ciphertext.
blocked(
  "INSERT INTO chat_room_messages(id,roomId,sender,media,ciphertext,created) VALUES('secret-media','secret','alice',?,NULL,9)",
  JSON.stringify([file('sent')]),
);
blocked(
  "INSERT INTO chat_room_messages(id,roomId,sender,media,ciphertext,created) VALUES('cipher-media','group','alice',?,'x',9)",
  JSON.stringify([file('sent')]),
);
blocked(
  "UPDATE chat_room_messages SET ciphertext='x',media=? WHERE id='old-message'",
  JSON.stringify([file('removed')]),
);

// A moderated file is never attached, forwarded or served again.
sqlite.exec(`
  INSERT INTO content_removals(id,targetType,targetId,postId,authorId,moderatorId,text,snapshot,reason,created)
    VALUES('removal','message','old-message','','alice','carol','','{}','fixture',1);
  INSERT INTO moderated_uploads(uploadId,removalId) VALUES('removed','removal');
`);
await deny(send('alice', 'group', { attachments: ['removed'] }));
blocked(
  "INSERT INTO chat_room_messages(id,roomId,sender,media,created) VALUES('moderated-copy','group','bob',?,9)",
  JSON.stringify([file('removed')]),
);
await deny(api.assertUploadAvailable('removed'), 404);

// Forwarding needs read access to the source and an ordinary group target.
const forward = (me, targets) =>
  api.forwardToChats(me, {
    key: crypto.randomUUID(),
    source: { room: { roomId: 'group', ids: ['old-message'] } },
    targets,
  });
await deny(forward('carol', [{ dm: { peer: 'alice' } }]));
await deny(forward('bob', [{ room: { roomId: 'secret' } }]));
const copied = await forward('bob', [{ dm: { peer: 'carol' } }]);
assert.equal(copied.results[0].ok, true);
await api.assertMediaRead('sent', 'carol', 'alice');
sqlite.exec(
  "INSERT INTO moderated_uploads(uploadId,removalId) VALUES('sent','removal')",
);
await deny(forward('bob', [{ dm: { peer: 'alice' } }]));
await deny(api.assertUploadAvailable('sent'), 404);

delete globalThis.__upgradeDb;
sqlite.close();
console.log(
  'Room attachments upgrade: 0051 files moved to chat_room_uploads and chat_media_refs, old guard rules kept for sends, forwards and moderation.',
);
