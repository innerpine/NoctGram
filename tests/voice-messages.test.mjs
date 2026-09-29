import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Voice messages and round videos through the real upload, media, social and
// room code: container checks, metadata, solo sending, playback and "listened".
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const { tag } of journal.entries)
  sql.exec(await readFile('drizzle/' + tag + '.sql', 'utf8'));
sql.exec(`INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1);
  INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bob','bob',1),('carol','carol',1);`);
const objects = new Map();
globalThis.__voiceDB = {
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
        return {
          meta: { changes: Number(sql.prepare(query).run(...this.args).changes) },
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
globalThis.__voiceBucket = {
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
globalThis.__voiceHeaders = new Headers();
const { outputFiles } = await build({
  stdin: {
    contents: `export { GET as socialGET, POST as socialPOST } from './app/api/social/route';
      export { POST as uploadPOST } from './app/api/chat-upload/route';
      export { GET as mediaGET } from './app/api/media/[id]/route';
      export { changeRoom, readRoom } from './lib/rooms';
      export { readConversation } from './lib/chat-messages';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'voice-fixture',
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
                  ? 'export const headers=async()=>globalThis.__voiceHeaders; export const cookies=async()=>({get:()=>undefined,set:()=>{}});'
                  : path === 'next/navigation'
                    ? 'export const redirect=()=>{throw new Error("Unexpected redirect")};'
                    : 'export const db=()=>globalThis.__voiceDB; export const bucket=()=>globalThis.__voiceBucket;',
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
  globalThis.__voiceHeaders = new Headers({
    'oai-authenticated-user-id': viewer,
    'oai-authenticated-user-email': viewer + '@example.test',
  });
};
const webm = new Uint8Array([26, 69, 223, 163, 1, 0, 0, 0, 0, 0, 0, 31, 66]);
const ogg = new Uint8Array([79, 103, 103, 83, 0, 2, 0, 0, 0, 0, 0, 0, 0]);
const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32, 0]);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
async function upload(viewer, target, bytes, type, fields = {}) {
  as(viewer);
  // The shared upload limit (15 per minute) is covered by its own tests.
  sql.exec('DELETE FROM auth_limits');
  const form = new FormData();
  form.set('file', new File([bytes], 'record', { type }));
  for (const [key, value] of Object.entries({ ...target, ...fields }))
    form.set(key, String(value));
  const response = await api.uploadPOST(
    new Request('http://localhost/api/chat-upload', { method: 'POST', body: form }),
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
const wave = '0123456789abcdefghijklmnopqrstuv';

// Upload validation: container signature, type per intent and metadata.
const voice = await upload('alice', { peer: 'bob' }, webm, 'audio/webm;codecs=opus', {
  intent: 'voice',
  duration: 4200,
  waveform: wave,
});
assert.equal(voice.status, 200);
assert.deepEqual(
  { kind: voice.body.kind, type: voice.body.type, duration: voice.body.duration, waveform: voice.body.waveform },
  { kind: 'voice', type: 'audio/webm', duration: 4200, waveform: wave },
);
for (const [bytes, type] of [
  [ogg, 'audio/ogg'],
  [mp4, 'audio/mp4'],
  [new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 0, 0]), 'audio/mpeg'],
])
  assert.equal(
    (await upload('alice', { peer: 'bob' }, bytes, type, { intent: 'voice', duration: 900, waveform: '' })).status,
    200,
    type,
  );
for (const [bytes, type, fields, why] of [
  [png, 'audio/webm', { intent: 'voice', duration: 900 }, 'forged container'],
  [mp4, 'video/mp4', { intent: 'voice', duration: 900 }, 'video as voice'],
  [webm, 'audio/webm', { intent: 'voice', duration: 0 }, 'zero duration'],
  [webm, 'audio/webm', { intent: 'voice', duration: 3600001 }, 'too long'],
  [webm, 'audio/webm', { intent: 'voice', duration: 12.5 }, 'fractional'],
  [webm, 'audio/webm', { intent: 'voice', duration: 900, waveform: 'xyz' }, 'bad waveform'],
  [webm, 'audio/webm', { intent: 'voice', duration: 900, waveform: '0'.repeat(101) }, 'long waveform'],
  [webm, 'video/webm', { intent: 'round', duration: 61001 }, 'round over a minute'],
  [webm, 'audio/webm', { intent: 'sticker', duration: 900 }, 'unknown intent'],
])
  assert.equal(
    (await upload('alice', { peer: 'bob' }, bytes, type, fields)).status,
    400,
    why,
  );
const round = await upload('alice', { peer: 'bob' }, mp4, 'video/mp4', {
  intent: 'round',
  duration: 12000,
  waveform: wave,
});
assert.equal(round.status, 200);
assert.equal(round.body.kind, 'round');
assert.equal(round.body.waveform, '', 'Round videos keep no waveform');

// Recordings are sent alone and keep their metadata in the message.
const key = () => crypto.randomUUID();
assert.equal(
  (await social('alice', { action: 'message', id: 'bob', text: 'Подпись', attachments: [voice.body.id], key: key() })).status,
  400,
);
const photo = await upload('alice', { peer: 'bob' }, png, 'image/png');
assert.equal(
  (await social('alice', { action: 'message', id: 'bob', text: '', attachments: [voice.body.id, photo.body.id], key: key() })).status,
  400,
);
const sent = await social('alice', { action: 'message', id: 'bob', text: '', attachments: [voice.body.id], key: key() });
assert.equal(sent.status, 200);
const stored = JSON.parse(sql.prepare('SELECT media FROM messages WHERE id=?').get(sent.body.id).media);
assert.deepEqual(stored, [
  { id: voice.body.id, name: 'record', type: 'audio/webm', size: webm.length, kind: 'voice', duration: 4200, waveform: wave },
]);
const photoMessage = await social('alice', { action: 'message', id: 'bob', text: '', attachments: [photo.body.id], key: key() });
assert.deepEqual(
  Object.keys(JSON.parse(sql.prepare('SELECT media FROM messages WHERE id=?').get(photoMessage.body.id).media)[0]).sort(),
  ['id', 'kind', 'name', 'size', 'type'],
  'Other files keep the original media keys',
);

// Recordings are streamed inline with their real type.
as('bob');
const served = await api.mediaGET(new Request('http://localhost/api/media/' + voice.body.id), {
  params: Promise.resolve({ id: voice.body.id }),
});
assert.equal(served.status, 200);
assert.equal(served.headers.get('Content-Type'), 'audio/webm');
assert.equal(served.headers.get('Content-Disposition'), null);

// Only the recipient marks a recording as listened, once.
assert.equal((await social('alice', { action: 'messageListened', peer: 'bob', id: sent.body.id })).status, 200);
assert.equal(sql.prepare('SELECT listenedAt FROM messages WHERE id=?').get(sent.body.id).listenedAt, 0);
await social('bob', { action: 'messageListened', peer: 'carol', id: sent.body.id });
assert.equal(sql.prepare('SELECT listenedAt FROM messages WHERE id=?').get(sent.body.id).listenedAt, 0);
await social('bob', { action: 'messageListened', peer: 'alice', id: photoMessage.body.id });
assert.equal(sql.prepare('SELECT listenedAt FROM messages WHERE id=?').get(photoMessage.body.id).listenedAt, 0);
await social('bob', { action: 'messageListened', peer: 'alice', id: sent.body.id });
const heard = sql.prepare('SELECT listenedAt FROM messages WHERE id=?').get(sent.body.id).listenedAt;
assert.ok(heard > 0);
await social('bob', { action: 'messageListened', peer: 'alice', id: sent.body.id });
assert.equal(sql.prepare('SELECT listenedAt FROM messages WHERE id=?').get(sent.body.id).listenedAt, heard);

// Conversations and previews name the recording.
const replyKey = key();
await social('bob', { action: 'message', id: 'alice', text: 'Ответ', attachments: [], key: replyKey, replyTo: sent.body.id });
const history = await api.readConversation('alice', 'bob');
assert.equal(history.find((m) => m.id === sent.body.id).listenedAt, heard);
assert.equal(history.find((m) => m.id === 'message:bob:' + replyKey).reply.text, 'Голосовое сообщение');
const roundMessage = await social('alice', { action: 'message', id: 'bob', text: '', attachments: [round.body.id], key: key() });
assert.equal(roundMessage.status, 200);
as('bob');
const threads = await (await api.socialGET(new Request('http://localhost/api/social?action=threads&archived=0&actor=bob'))).json();
assert.equal(threads.find((t) => t.id === 'alice').lastText, 'Видеосообщение');

// Groups follow the same rules.
const group = await api.changeRoom('alice', { action: 'create', kind: 'group', name: 'Голос', memberIds: ['bob'] });
const roomVoice = await upload('alice', { room: group.id }, ogg, 'audio/ogg', { intent: 'voice', duration: 1500, waveform: 'abc' });
assert.equal(roomVoice.status, 200);
await assert.rejects(
  api.changeRoom('alice', { action: 'send', id: group.id, key: key(), text: 'Подпись', attachments: [roomVoice.body.id] }),
  (error) => error.status === 400,
);
const roomKey = key();
await api.changeRoom('alice', { action: 'send', id: group.id, key: roomKey, attachments: [roomVoice.body.id] });
const detail = await api.readRoom('bob', group.id);
assert.deepEqual(detail.messages.find((m) => m.id === roomKey).attachments[0], {
  id: roomVoice.body.id,
  name: 'record',
  type: 'audio/ogg',
  size: ogg.length,
  kind: 'voice',
  duration: 1500,
  waveform: 'abc',
});
