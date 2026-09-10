import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['lib/music-session.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { musicSession, readMusicSession } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64')
);
const track = {
  url: 'https://soundcloud.com/fixture/song',
  provider: 'soundcloud',
  kind: 'track',
  title: 'Saved song',
  artist: 'Artist',
  artwork: 'https://i1.sndcdn.com/artwork.jpg',
  audioUrl: 'https://signed.example/stream?token=secret',
  token: 'secret',
};
const input = {
  version: 1,
  track,
  queue: [
    { url: track.url },
    { ...track, url: 'https://soundcloud.com/fixture/next' },
  ],
  position: 45250,
  duration: 180000,
  playing: true,
  room: { token: 'secret' },
};
const saved = musicSession(input);
assert.equal(saved.position, 45250);
assert.equal(
  saved.queue[0].title,
  'Saved song',
  'Selected queue entry must retain resolved metadata',
);
assert.equal(saved.queue.length, 2);
assert.equal(saved.playing, undefined, 'Playback intent is never restored');
assert.equal(saved.room, undefined);
assert.equal(saved.track.token, undefined);
assert.equal(
  saved.track.audioUrl,
  undefined,
  'Expiring stream URLs are resolved again',
);
assert.deepEqual(readMusicSession(JSON.stringify(saved)), saved);
for (const value of [
  null,
  '',
  '{broken',
  'null',
  '[]',
  '{"version":2}',
  JSON.stringify({ ...input, track: { url: 'javascript:alert(1)' } }),
  JSON.stringify({
    ...input,
    track: { url: track.url + '?secret_token=secret' },
  }),
])
  assert.equal(readMusicSession(value), null);
assert.equal(musicSession({ ...input, position: -10 }).position, 0);
assert.equal(musicSession({ ...input, position: Infinity }).position, 0);
assert.equal(musicSession({ ...input, position: 999999 }).position, 180000);
assert.equal(musicSession({ ...input, duration: NaN }).position, 0);
assert.equal(
  musicSession({
    ...input,
    track: { ...track, artwork: 'javascript:alert(1)' },
  }).track.artwork,
  '',
);
assert.equal(musicSession({ ...input, queue: [] }).queue[0].url, track.url);
assert.ok(
  musicSession({
    ...input,
    queue: Array.from({ length: 1000 }, (_, i) => ({
      ...track,
      url: 'https://soundcloud.com/fixture/song-' + i,
    })),
  }).queue.length <= 201,
);
console.log(
  'Music session: metadata and queue round-trip, resume position, malformed storage, bounded data and exclusion of autoplay/credentials passed.',
);
