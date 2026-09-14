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

for (const [failure, delay, global] of [
  [() => new LyricsUnavailable(now + 8000), 8000, false],
  [() => new LyricsRateLimit(now + 120000), 120000, true],
  [() => new TypeError('Network failed'), 8000, false],
  [() => new DOMException('Timed out', 'AbortError'), 8000, false],
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
  const failed = await service.load('failure', recording);
  assert.equal(failed.error, true);
  assert.equal(failed.retryAt, now + delay);
  for (let i = 0; i < 20; i++)
    assert.equal((await service.load('failure', recording, true)).error, true);
  assert.equal(
    requests,
    2,
    'Rapid retries share the error until its advertised retry time',
  );
  assert.equal(
    (await service.load('cached-song', recording)).lyrics,
    lyrics,
    'Cached lyrics remain available during an outage',
  );
  broken = false;
  const unrelated = await service.load('other-song', recording);
  assert.equal(
    unrelated.error === true,
    global,
    'Only 429 blocks unrelated songs',
  );
  now += delay + 1;
  assert.equal((await service.load('failure', recording, true)).lyrics, lyrics);
  assert.equal(
    requests,
    global ? 3 : 4,
    'Lookup really runs after the displayed wait',
  );
}
let saved = null;
const store = {
  async read() {
    return saved;
  },
  async write(_key, _duration, value) {
    saved = value;
  },
};
let savedCalls = 0;
const online = new TrackLyricsCache(
  async () => {
    savedCalls++;
    return lyrics;
  },
  () => now,
  store,
);
await online.load('persisted', recording);
const offline = new TrackLyricsCache(
  async () => {
    savedCalls++;
    throw new TypeError('Offline');
  },
  () => now,
  store,
);
assert.equal(
  (await offline.load('persisted', recording)).lyrics,
  lyrics,
  'Lyrics survive a new cache instance/page reload',
);
assert.equal(savedCalls, 1);
now += 16000;
assert.equal(
  (await offline.load('persisted', recording, true)).lyrics,
  lyrics,
  'A failed refresh cannot erase good lyrics',
);
assert.equal(savedCalls, 2);
const unavailableStore = new TrackLyricsCache(
  async () => lyrics,
  () => now,
  {
    async read() {
      throw new Error('Storage disabled');
    },
    async write() {
      throw new Error('Quota');
    },
  },
);
assert.equal((await unavailableStore.load('track', recording)).lyrics, lyrics);
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
