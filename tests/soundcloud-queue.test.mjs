import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents:
      "export * from './lib/soundcloud-queue'; export * from './lib/music-queue'; export { musicLabel } from './lib/music-links';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { soundCloudQueue, moveMusicItem, nextMusicMove, musicLabel } =
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );

await test('widget placeholders cannot crash reorder and native song indices survive filtering', () => {
  const sounds = [
    {
      id: 1,
      title: 'First',
      permalink_url: 'https://soundcloud.com/artist/first',
    },
    { id: 2 },
    null,
    { id: 3, permalink_url: 'https://soundcloud.com/artist/third' },
    {
      id: 4,
      title: 'Fourth',
      permalink_url: 'https://soundcloud.com/artist/fourth',
      user: { username: 'Artist' },
    },
    {
      id: 1,
      permalink_url: 'https://soundcloud.com/artist/first?utm_source=widget',
    },
    { id: 5, permalink_url: 'https://soundcloud.com/artist/sets/playlist' },
    {
      id: 6,
      permalink_url:
        'https://soundcloud.com/artist/private?secret_token=private',
    },
  ];
  const entries = soundCloudQueue(sounds);
  assert.deepEqual(
    entries.map((e) => e.nativeIndex),
    [0, 3, 4],
  );
  const reordered = moveMusicItem(
    entries.map((e) => e.track),
    2,
    0,
  );
  assert.deepEqual(
    reordered.map((t) => t.title || musicLabel(t)),
    ['Fourth', 'First', 'third'],
  );
  assert.deepEqual(
    reordered.map(
      (t) => entries.find((e) => e.track.url === t.url).nativeIndex,
    ),
    [4, 0, 3],
  );
  assert.equal(new Set(reordered.map((t) => t.url)).size, 3);
  assert.deepEqual(soundCloudQueue(undefined), []);
  assert.deepEqual(soundCloudQueue([{ id: 7 }]), []);
});

await test('queued saves: one move for a dragged row, converging for any order', () => {
  assert.deepEqual(
    nextMusicMove(['1', '2', '3', '4', '5'], ['1', '2', '5', '3', '4'], '5'),
    { from: 4, to: 2 },
  );
  assert.deepEqual(nextMusicMove(['a', 'b', 'c'], ['b', 'c', 'a']), {
    from: 0,
    to: 2,
  });
  assert.equal(nextMusicMove(['a', 'b'], ['a', 'b']), null);
  assert.equal(nextMusicMove(['a', 'b'], ['a', 'c']), null, 'other rows');
  let order = ['a', 'b', 'c', 'd', 'e'],
    step,
    moves = 0;
  const wanted = ['e', 'c', 'a', 'd', 'b'];
  while ((step = nextMusicMove(order, wanted))) {
    order = moveMusicItem(order, step.from, step.to);
    moves++;
  }
  assert.deepEqual(order, wanted);
  assert.ok(moves < wanted.length);
});
