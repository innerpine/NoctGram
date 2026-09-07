import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['lib/music-lyrics-search.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { cleanLyricTitle, chooseLyricMatch, findTrackLyrics, LyricsRateLimit } =
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(result.outputFiles[0].text).toString('base64')
  );
const recording = {
  title: 'Vendetta! (prod. Mupp)',
  artist: 'Sadfriendd',
  duration: 107000,
};
assert.equal(cleanLyricTitle(recording.title), 'Vendetta!');
assert.equal(
  cleanLyricTitle('vendetta! (official music video) Dir. by @director'),
  'vendetta!',
);
assert.equal(cleanLyricTitle('Song (live)'), 'Song (live)');
const correct = {
  id: 1,
  trackName: 'vendetta!',
  artistName: 'MUPP, Sadfriendd',
  duration: 107,
  syncedLyrics: '[00:00.00]Synthetic test line',
  plainLyrics: 'Synthetic test line',
};
const wrong = [
  { ...correct, trackName: 'vendetta II' },
  { ...correct, trackName: 'vendetta! (sped up)' },
  { ...correct, artistName: 'Other artist' },
  { ...correct, duration: 92 },
];
assert.equal(chooseLyricMatch(wrong, recording), null);
assert.equal(chooseLyricMatch([...wrong, correct], recording).lines.length, 1);
const video = {
  ...correct,
  trackName:
    'vendetta! - Sadfriendd x Mupp (official music video) Dir. by @nashbrowin',
  artistName: 'Sadfriendd',
  duration: 108,
};
assert.equal(chooseLyricMatch([video], recording).lines.length, 1);
assert.equal(
  chooseLyricMatch([{ ...correct, syncedLyrics: '' }, video], recording).lines
    .length,
  1,
);
const calls = [];
const fake = async (url, init) => {
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  const u = new URL(url);
  calls.push(u);
  return u.pathname.endsWith('/search')
    ? Response.json([...wrong, correct])
    : new Response(null, { status: 404 });
};
const found = await findTrackLyrics(
  recording,
  new AbortController().signal,
  fake,
);
assert.equal(found.lines.length, 1);
assert.equal(calls.length, 3);
assert.equal(calls[1].searchParams.get('track_name'), 'Vendetta!');
assert.equal(calls[2].searchParams.get('q'), 'Sadfriendd Vendetta!');
let count = 0;
await assert.rejects(
  findTrackLyrics(recording, new AbortController().signal, async () => {
    count++;
    return new Response(null, {
      status: 429,
      headers: { 'Retry-After': '120' },
    });
  }),
  (error) =>
    error instanceof LyricsRateLimit && error.until >= Date.now() + 119000,
);
assert.equal(count, 1, '429 stops the fallback request chain');
const abort = new AbortController();
abort.abort();
await assert.rejects(
  findTrackLyrics(recording, abort.signal, async (_url, init) => {
    init.signal.throwIfAborted();
  }),
  (error) => error.name === 'AbortError',
);
console.log(
  'Lyrics lookup: production credits, artist/duration/version matching, fallback search, rate limit and cancellation passed.',
);
if (process.argv.includes('--live')) {
  const lyrics = await findTrackLyrics(recording, AbortSignal.timeout(20000));
  assert.ok(lyrics?.lines.length > 0);
  console.log(
    'Live LRCLIB regression: Vendetta! (prod. Mupp), Sadfriendd, 107 seconds -> synchronized lyrics found (' +
      lyrics.lines.length +
      ' lines).',
  );
}
