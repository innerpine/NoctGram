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
const { soundCloudQueue, moveMusicItem, musicLabel } = await import(
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
