import assert from 'node:assert/strict';
import { build } from 'esbuild';

// The group outbox mirrors direct chats: one send at a time per room and
// author, optimistic copies with the server's ID, and retries with the same key.
const { outputFiles } = await build({
  entryPoints: ['lib/room-outbox.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { createRoomOutbox, mergeRoomOutgoing } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const calls = [];
const outbox = createRoomOutbox(
  (body) =>
    new Promise((resolve, reject) => calls.push({ body, resolve, reject })),
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
let changes = 0;
outbox.subscribe(() => changes++);
const author = { id: 'alice', name: 'Alice', avatar: '' };
const file = { id: 'f1', name: 'a.png', type: 'image/png', kind: 'image', size: 3 };
const first = outbox.enqueue(author, 'room-1', {
  text: '  Привет  ',
  attachments: [file],
  reply: { id: 'r0', sender: 'bob', name: 'Bob', text: 'Фото', unavailable: false },
});
assert.match(first, /^[0-9a-f-]{36}$/);
assert.equal(changes, 1);
const [entry] = outbox.getSnapshot();
assert.equal(entry.message.text, 'Привет');
assert.equal(entry.message.replyTo, 'r0');
assert.deepEqual(entry.message.attachments, [file]);
assert.notEqual(entry.message.attachments[0], file, 'Draft files are copied');
const second = outbox.enqueue(author, 'room-1', { text: 'Второе' });
const other = outbox.enqueue(author, 'room-2', { text: 'Другая группа' });
await tick();
assert.deepEqual(
  calls.map((call) => [call.body.id, call.body.key]),
  [
    ['room-1', first],
    ['room-2', other],
  ],
  'Rooms send independently; a room sends one message at a time',
);
assert.deepEqual(calls[0].body, {
  actor: 'alice',
  action: 'send',
  id: 'room-1',
  key: first,
  text: 'Привет',
  attachments: ['f1'],
  replyTo: 'r0',
});
calls[0].reject(Object.assign(new Error('Нет сети'), { status: 503 }));
await tick();
assert.equal(outbox.getSnapshot()[0].status, 'failed');
assert.equal(outbox.getSnapshot()[0].error, 'Нет сети');
assert.equal(calls[2].body.key, second, 'The next message is not blocked');
calls[2].resolve({ id: second });
await tick();
outbox.retry(first, 'bob');
assert.equal(calls.length, 3, 'Only the author retries');
outbox.retry(first, 'alice');
await tick();
assert.equal(calls[3].body.key, first, 'A retry reuses the key');
calls[3].resolve({ ok: true, queued: true, id: 'group:' + first, notice: 'На проверке' });
await tick();
const held = outbox.getSnapshot().find((item) => item.message.id === first);
assert.equal(held.status, 'queued');
assert.equal(held.notice, 'На проверке');
const server = [{ id: second, roomId: 'room-1' }];
const merged = mergeRoomOutgoing(server, outbox.getSnapshot());
assert.deepEqual(
  merged.map((message) => message.id),
  [second, other],
  'Held messages are hidden; confirmed ones are not duplicated',
);
outbox.dismiss(first);
outbox.acknowledge('room-1', server);
assert.deepEqual(
  outbox.getSnapshot().map((item) => item.message.id),
  [other],
);
calls[1].resolve({ id: 'unexpected' });
await tick();
assert.equal(outbox.getSnapshot()[0].status, 'failed');
