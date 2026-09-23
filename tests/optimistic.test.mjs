import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: `export * from './lib/optimistic'; export { withOwnReaction } from './lib/message-reactions';`,
    resolveDir: '.',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const { createLatestRequests, choosePost, withOwnReaction } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

const gate = () => {
  const waiting = [];
  return {
    send: (value) =>
      new Promise((resolve, reject) =>
        waiting.push({ value, resolve, reject }),
      ),
    waiting,
  };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

void test('rapid taps keep one request in flight and the last tap wins', async () => {
  const latest = createLatestRequests(),
    server = gate();
  const run = latest('post:like', true, server.send);
  assert.equal(latest('post:like', false, server.send), undefined);
  assert.equal(latest('post:like', true, server.send), undefined);
  assert.equal(latest('post:like', false, server.send), undefined);
  assert.equal(server.waiting.length, 1, 'taps join the running request');
  const other = latest('post:save', true, server.send);
  assert.ok(other, 'another kind of the same post is independent');
  server.waiting.shift().resolve();
  await tick();
  assert.deepEqual(
    server.waiting.map((request) => request.value),
    [true, false],
  );
  server.waiting.splice(0).forEach((request) => request.resolve());
  await Promise.all([run, other]);
  // Liked, then unliked: the second request ends the server on "not liked".
  const back = latest('post:like', true, server.send);
  assert.ok(back, 'a finished key starts a new run');
  latest('post:like', false, server.send);
  latest('post:like', true, server.send);
  server.waiting.shift().resolve();
  await back;
  assert.equal(server.waiting.length, 0, 'returning to the sent value is free');
});

void test('a failed request ends the run so the caller can revert', async () => {
  const latest = createLatestRequests(),
    server = gate();
  const run = latest('m1', '🔥', server.send);
  latest('m1', null, server.send);
  server.waiting.shift().reject(new Error('offline'));
  await assert.rejects(run, /offline/);
  assert.equal(server.waiting.length, 0);
  assert.ok(latest('m1', '👍', server.send), 'the key is free again');
});

void test('post choices flip likes, saves and votes from the server copy', () => {
  const post = {
    liked: 0,
    likes: 4,
    saved: 1,
    voted: 0,
    votes: [{ option: 0, count: 2 }],
  };
  assert.equal(choosePost(post, {}), post);
  assert.deepEqual(choosePost(post, { like: true, save: false, vote: 2 }), {
    liked: 1,
    likes: 5,
    saved: 0,
    voted: 2,
    votes: [
      { option: 0, count: 1 },
      { option: 2, count: 1 },
    ],
  });
  // Once the server copy agrees, nothing is counted twice.
  const confirmed = { ...post, liked: 1, likes: 5 };
  assert.equal(choosePost(confirmed, { like: true }), confirmed);
  assert.equal(choosePost({ ...post, likes: 0 }, { like: false }).likes, 0);
  assert.equal(
    choosePost({ ...post, liked: 1, likes: 0 }, { like: false }).likes,
    0,
  );
});

void test('own reaction replaces, removes and keeps the catalogue order', () => {
  const reactions = [
    { emoji: '❤️', count: 2, own: true },
    { emoji: '🎉', count: 1, own: false },
  ];
  assert.equal(withOwnReaction(reactions, '❤️'), reactions);
  assert.deepEqual(withOwnReaction(reactions, '🔥'), [
    { emoji: '❤️', count: 1, own: false },
    { emoji: '🔥', count: 1, own: true },
    { emoji: '🎉', count: 1, own: false },
  ]);
  assert.deepEqual(withOwnReaction(reactions, null), [
    { emoji: '❤️', count: 1, own: false },
    { emoji: '🎉', count: 1, own: false },
  ]);
  assert.deepEqual(withOwnReaction(undefined, '👍'), [
    { emoji: '👍', count: 1, own: true },
  ]);
  assert.deepEqual(
    withOwnReaction([{ emoji: '👍', count: 1, own: true }], null),
    [],
  );
});
