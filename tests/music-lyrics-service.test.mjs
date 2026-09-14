import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

globalThis.__lyricsAuth = {
  id: 'fixture-user',
  blocked: false,
  limited: false,
  budgets: [],
};
const compiled = await build({
  stdin: {
    contents: `export * from './lib/music-lyrics-server'; export * from './lib/music-lyrics-client'; export * from './lib/lyrics-storage'; export * from './lib/music-lyrics-search'; export * from './app/api/music/lyrics/route';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'auth-fixtures',
      setup(build) {
        build.onResolve(
          { filter: /^@\/lib\/(server|account-access|rate-limit)$/ },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          resolveDir: process.cwd(),
          contents: `import { ApiError } from ${JSON.stringify(resolve('lib/api-error.ts'))}; export { ApiError, failure } from ${JSON.stringify(resolve('lib/api-error.ts'))};
        export async function viewer() { if (!globalThis.__lyricsAuth.id) throw new ApiError(401, 'Login'); return globalThis.__lyricsAuth.id; }
        export async function assertReadable() { if (globalThis.__lyricsAuth.blocked) throw new ApiError(403, 'Blocked'); }
        export async function rateLimit(...args) { globalThis.__lyricsAuth.budgets.push(args); if (globalThis.__lyricsAuth.limited) throw new ApiError(429, 'Limit'); }`,
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const {
  serverTrackLyrics,
  requestTrackLyrics,
  browserLyricsStore,
  LyricsRateLimit,
  LyricsUnavailable,
  chooseLyricMatch,
  GET,
} = api;
const recording = {
  title: 'LONOWN, Asenssia - addiction (Slowed)',
  artist: 'LONOWN',
  duration: 234000,
};
const row = {
  id: 1,
  trackName: 'addiction - Slowed',
  artistName: 'LONOWN & Asenssia',
  duration: 233,
  syncedLyrics: '[00:00.00]Synthetic fixture\n[00:10.00]Another fixture',
  plainLyrics: '',
};
const lyrics = chooseLyricMatch([row], recording);
assert.equal(lyrics.lines.length, 2);
for (const wrong of [
  { ...row, duration: 208 },
  { ...row, trackName: 'addiction - Ultra Slowed' },
  { ...row, artistName: 'Different artist' },
])
  assert.equal(chooseLyricMatch([wrong], recording), null);
assert.deepEqual(
  chooseLyricMatch(
    [{ ...row, trackName: 'addiction', duration: 208 }, row],
    recording,
  ),
  lyrics,
);

class MemoryCache {
  entries = new Map();
  async match(key) {
    return this.entries.get(typeof key === 'string' ? key : key.url)?.clone();
  }
  async put(key, response) {
    this.entries.set(typeof key === 'string' ? key : key.url, response.clone());
  }
  async delete(key) {
    return this.entries.delete(typeof key === 'string' ? key : key.url);
  }
  async keys() {
    return [...this.entries.keys()].map((key) => new Request(key));
  }
}
let now = Date.now(),
  calls = 0;
const signal = new AbortController().signal;
const provider = async () => {
  calls++;
  return lyrics;
};
const cache = new MemoryCache();
assert.deepEqual(
  await serverTrackLyrics(recording, signal, cache, provider, () => now),
  lyrics,
);
assert.deepEqual(
  await serverTrackLyrics(recording, signal, cache, provider, () => now),
  lyrics,
);
assert.equal(calls, 1, 'Independent requests share only stored response data');
const networkFailure = async () => {
  throw new TypeError('Provider unavailable');
};
now += 8 * 86400000;
assert.deepEqual(
  await serverTrackLyrics(recording, signal, cache, networkFailure, () => now),
  lyrics,
  'Stale good lyrics survive an upstream outage',
);
assert.deepEqual(
  await serverTrackLyrics(
    recording,
    signal,
    cache,
    async () => null,
    () => now,
  ),
  lyrics,
  'A temporary search miss cannot remove known lyrics',
);
await assert.rejects(
  serverTrackLyrics(
    { ...recording, duration: 208000 },
    signal,
    cache,
    networkFailure,
    () => now,
  ),
);
now += 31 * 86400000;
await assert.rejects(
  serverTrackLyrics(recording, signal, cache, networkFailure, () => now),
);
assert.deepEqual(
  await serverTrackLyrics(
    recording,
    signal,
    {
      async match() {
        throw new Error('Cache unavailable');
      },
      async put() {
        throw new Error('Cache unavailable');
      },
    },
    provider,
  ),
  lyrics,
);
const misses = new MemoryCache();
assert.equal(
  await serverTrackLyrics(recording, signal, misses, async () => null),
  null,
);
assert.equal(
  misses.entries.size,
  0,
  'No negative or outage responses are persisted on the server',
);

const disk = new MemoryCache();
const store = browserLyricsStore(
  async () => disk,
  () => now,
);
await store.write('track', recording.duration, lyrics);
assert.deepEqual(
  await browserLyricsStore(
    async () => disk,
    () => now,
  ).read('track', 234150),
  lyrics,
);
assert.equal(await store.read('track', 208000), null);
assert.equal(await store.read('other', 234000), null);
for (let i = 0; i < 51; i++) await store.write('track-' + i, 234000, lyrics);
assert.equal(disk.entries.size, 50);
assert.equal(await store.read('track', 234000), null);
now += 31 * 86400000;
assert.equal(await store.read('track-50', 234000), null);
assert.equal(
  await browserLyricsStore(async () => {
    throw new Error('Private mode');
  }).read('track', 234000),
  null,
);
await browserLyricsStore(async () => {
  throw new Error('Quota');
}).write('track', 234000, lyrics);

const request = async (url, init) => {
  assert.equal(
    new URL(url, 'https://noctgram.com').pathname,
    '/api/music/lyrics',
  );
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.signal, signal);
  return Response.json({ lyrics });
};
assert.deepEqual(await requestTrackLyrics(recording, signal, request), lyrics);
assert.equal(
  await requestTrackLyrics(recording, signal, async () =>
    Response.json({ lyrics: null }),
  ),
  null,
);
await assert.rejects(
  requestTrackLyrics(recording, signal, async () =>
    Response.json({ lyrics: { lines: 'invalid' } }),
  ),
  LyricsUnavailable,
);
await assert.rejects(
  requestTrackLyrics(
    recording,
    signal,
    async () =>
      new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
  ),
  (error) =>
    error instanceof LyricsRateLimit && error.until >= Date.now() + 119000,
);
await assert.rejects(
  requestTrackLyrics(
    recording,
    signal,
    async () => new Response('', { status: 503 }),
  ),
  (error) =>
    error instanceof LyricsUnavailable && error.until < Date.now() + 9000,
);
assert.equal(
  api.lyricRetryAt(
    new Response('', {
      status: 503,
      headers: { 'Retry-After': new Date(now + 45000).toUTCString() },
    }),
    now,
  ),
  Math.floor((now + 45000) / 1000) * 1000,
);

const savedFetch = globalThis.fetch;
const savedCaches = globalThis.caches;
globalThis.caches = { default: new MemoryCache() };
let upstreamCalls = 0;
globalThis.fetch = async (url, init) => {
  upstreamCalls++;
  assert.equal(new URL(url).origin, 'https://lrclib.net');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.headers, undefined, 'No account credentials are forwarded');
  return Response.json([row]);
};
const req = (params = recording) =>
  new Request(
    'https://noctgram.com/api/music/lyrics?' + new URLSearchParams(params),
  );
try {
  const response = await GET(req());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual((await response.json()).lyrics, lyrics);
  assert.equal((await GET(req())).status, 200);
  assert.equal(upstreamCalls, 1);
  assert.deepEqual(globalThis.__lyricsAuth.budgets[0], [
    'music-lyrics',
    'fixture-user',
    30,
    60,
  ]);
  for (const params of [
    { ...recording, duration: 0 },
    { ...recording, duration: 'NaN' },
    { ...recording, title: 'x'.repeat(501) },
    { ...recording, artist: '' },
  ])
    assert.equal((await GET(req(params))).status, 400);
  globalThis.__lyricsAuth.blocked = true;
  assert.equal((await GET(req())).status, 403);
  globalThis.__lyricsAuth.blocked = false;
  globalThis.__lyricsAuth.id = '';
  assert.equal((await GET(req())).status, 401);
  globalThis.__lyricsAuth.id = 'fixture-user';
  globalThis.__lyricsAuth.limited = true;
  assert.equal((await GET(req())).status, 429);
  globalThis.__lyricsAuth.limited = false;
  globalThis.caches = { default: new MemoryCache() };
  globalThis.fetch = async () =>
    new Response('', { status: 429, headers: { 'Retry-After': '120' } });
  const limited = await GET(req());
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) >= 119);
  globalThis.fetch = networkFailure;
  assert.equal((await GET(req())).status, 503);
} finally {
  globalThis.fetch = savedFetch;
  if (savedCaches === undefined) delete globalThis.caches;
  else globalThis.caches = savedCaches;
  delete globalThis.__lyricsAuth;
}
console.log(
  'Lyrics service: exact slowed recording, same-origin request, authentication, limits, positive caches, persistence, stale recovery and failure handling passed.',
);
