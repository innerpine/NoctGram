import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({
  stdin: {
    contents:
      "export * from './lib/track-lyrics-cache'; export * from './lib/music-lyrics-search';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { TrackLyricsCache, LyricsUnavailable, LyricsRateLimit } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64')
);
let now = Date.now(),
  calls = 0,
  finish;
const recording = {
  title: 'Fixture song',
  artist: 'Fixture artist',
  duration: 169587,
};
const lyrics = {
  lines: [{ time: 0, text: 'Invented fixture text' }],
  plain: '',
  instrumental: false,
};
const cache = new TrackLyricsCache(
  async (_recording, signal) => {
    calls++;
    assert.equal(signal.aborted, false);
    return new Promise((resolve) => (finish = resolve));
  },
  () => now,
);
const a = cache.load('track', recording);
const b = cache.load('track', { ...recording, duration: 169611 });
const c = cache.load('track', { ...recording, duration: 169580 }, true);
assert.equal(a, b);
assert.equal(a, c, 'Concurrent remounts/retries share a request');
await Promise.resolve();
assert.equal(calls, 1);
finish(lyrics);
assert.equal((await a).lyrics, lyrics);
for (const duration of [169610, 169587, 169588, 169800])
  assert.equal(
    (await cache.load('track', { ...recording, duration })).lyrics,
    lyrics,
  );
assert.equal(
  calls,
  1,
  'Sub-second metadata differences across repeat plays hit the cache',
);
const other = cache.load('track', { ...recording, duration: 180000 });
await Promise.resolve();
assert.equal(calls, 2);
finish(null);
assert.equal((await other).lyrics, null);
for (let i = 0; i < 25; i++)
  await cache.load('track', { ...recording, duration: 180021 });
assert.equal(calls, 2, 'Missing lyrics do not trigger repeated lookups');
await cache.load('track', { ...recording, duration: 180000 }, true);
assert.equal(calls, 2, 'Rapid retry clicks do not flood requests');
now += 16000;
const retry = cache.load('track', { ...recording, duration: 180000 }, true);
await Promise.resolve();
assert.equal(calls, 3);
finish(null);
await retry;
now += 14 * 60000;
await cache.load('track', { ...recording, duration: 180000 });
assert.equal(calls, 3, 'A missing song remains cached for fifteen minutes');
now += 61000;
const expired = cache.load('track', { ...recording, duration: 180000 });
await Promise.resolve();
assert.equal(calls, 4);
finish(lyrics);
await expired;
// A request continues to a bounded completion even when its first view closes.
const unfinished = cache.load('unmounted-view', recording);
await Promise.resolve();
assert.equal(calls, 5);
finish(lyrics);
await unfinished;
assert.equal((await cache.load('unmounted-view', recording)).lyrics, lyrics);
assert.equal(calls, 5);

for (const failure of [
  () => new LyricsUnavailable(now + 60000),
  () => new LyricsRateLimit(now + 120000),
  () => new TypeError('Network failed'),
  () => new DOMException('Timed out', 'AbortError'),
]) {
  let requests = 0,
    broken = false;
  const service = new TrackLyricsCache(
    async () => {
      requests++;
      if (broken) throw failure();
      return lyrics;
    },
    () => now,
  );
  await service.load('cached-song', recording);
  broken = true;
  assert.equal((await service.load('failure', recording)).error, true);
  for (let i = 0; i < 20; i++)
    assert.equal(
      (await service.load('failure-' + i, recording, true)).error,
      true,
    );
  assert.equal(
    requests,
    2,
    'An outage pauses lookups for all songs, including manual retries',
  );
  assert.equal(
    (await service.load('cached-song', recording)).lyrics,
    lyrics,
    'Cached lyrics remain available during an outage',
  );
  now += 121000;
  broken = false;
  assert.equal((await service.load('failure', recording, true)).lyrics, lyrics);
  assert.equal(requests, 3, 'Lookup recovers after the cooldown');
}
let memoryCalls = 0;
const bounded = new TrackLyricsCache(
  async () => {
    memoryCalls++;
    return lyrics;
  },
  () => now,
);
for (let i = 0; i < 51; i++) await bounded.load('song-' + i, recording);
await bounded.load('song-50', recording);
assert.equal(memoryCalls, 51);
await bounded.load('song-0', recording);
assert.equal(
  memoryCalls,
  52,
  'Old entries are evicted instead of growing memory indefinitely',
);
console.log(
  'Lyrics cache: concurrent lookups, replay duration jitter, misses, bounded memory, retries, outages, cached availability and recovery passed.',
);
