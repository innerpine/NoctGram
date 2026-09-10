import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['lib/music-lyrics-search.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const {
  cleanLyricTitle,
  chooseLyricMatch,
  findTrackLyrics,
  LyricsRateLimit,
  LyricsUnavailable,
} = await import(
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
const reupload = {
  title: 'LIZER & FLESH - FALSE MIRROR (Prod. by Taz Taylor)',
  artist: 'ЗАКАТ 99.1',
  duration: 142000,
};
const mirror = {
  ...correct,
  trackName: 'False Mirror',
  artistName: 'FLESH, LIZER',
  duration: 142,
};
// LRCLIB 14191291 has its title and artist fields reversed.
const reversedMirror = {
  ...mirror,
  trackName: 'LIZER & FLESH',
  artistName: 'False Mirror',
};
for (const entry of [mirror, reversedMirror]) {
  assert.equal(chooseLyricMatch([entry], reupload)?.lines.length, 1);
  assert.equal(
    chooseLyricMatch([entry], {
      ...reupload,
      title: 'FALSE MIRROR — LIZER & FLESH',
    })?.lines.length,
    1,
  );
  assert.equal(
    chooseLyricMatch([entry], {
      ...reupload,
      title: reupload.title + ' by ЗАКАТ 99.1',
    })?.lines.length,
    1,
  );
}
assert.equal(
  chooseLyricMatch([mirror], {
    title: 'FALSE MIRROR',
    artist: 'LIZER and FLESH',
    duration: 142000,
  })?.lines.length,
  1,
);
for (const entry of [
  { ...mirror, artistName: 'Unrelated artist' },
  { ...mirror, trackName: 'Broken Mirror' },
  { ...mirror, trackName: 'False Mirror II' },
  { ...mirror, trackName: 'False Mirror (slowed)' },
  { ...mirror, duration: 136 },
  { ...reversedMirror, artistName: 'False Mirror (sped up)' },
  { ...reversedMirror, trackName: 'Different performer' },
])
  assert.equal(chooseLyricMatch([entry], reupload), null);
assert.equal(
  chooseLyricMatch([mirror, reversedMirror], {
    ...reupload,
    title: reupload.title + ' (sped up)',
  }),
  null,
  'Reversed fields must not bypass recording version checks',
);
assert.equal(
  chooseLyricMatch([mirror], { ...reupload, title: 'FALSE MIRROR' }),
  null,
  'A title and duration alone cannot identify an unknown uploader recording',
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
assert.equal(calls.length, 1);
assert.equal(calls[0].pathname, '/api/search');
assert.equal(calls[0].searchParams.get('q'), 'Sadfriendd Vendetta!');
const reuploadCalls = [];
const reuploadLyrics = await findTrackLyrics(
  reupload,
  new AbortController().signal,
  async (url) => {
    const u = new URL(url);
    reuploadCalls.push(u);
    if (!u.pathname.endsWith('/search'))
      return new Response(null, { status: 404 });
    // An uploader in this query produces no results on the real service.
    return Response.json(
      u.searchParams.get('q').includes('ЗАКАТ') ? [] : [reversedMirror],
    );
  },
);
assert.equal(reuploadLyrics?.lines.length, 1);
assert.equal(reuploadCalls.length, 1);
assert.equal(
  reuploadCalls
    .find((url) => url.pathname.endsWith('/search'))
    .searchParams.get('q'),
  'LIZER & FLESH FALSE MIRROR',
);
// Search candidates must still pass metadata validation.
assert.equal(
  await findTrackLyrics(reupload, new AbortController().signal, async () =>
    Response.json([{ ...mirror, artistName: 'Wrong artist' }]),
  ),
  null,
);
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
for (const status of [500, 503, 504]) {
  count = 0;
  await assert.rejects(
    findTrackLyrics(reupload, new AbortController().signal, async () => {
      count++;
      return new Response(null, { status });
    }),
    (error) => error instanceof LyricsUnavailable,
  );
  assert.equal(count, 1, 'A server outage stops all fallback requests');
}
const missing = [];
assert.equal(
  await findTrackLyrics(reupload, new AbortController().signal, async (url) => {
    missing.push(new URL(url));
    return Response.json([]);
  }),
  null,
);
assert.equal(
  missing.length,
  2,
  'At most performer and uploader searches; no reversed duplicate or /get probes',
);
assert.ok(missing.every((url) => url.pathname === '/api/search'));
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
  for (const sample of [recording, reupload]) {
    const lyrics = await findTrackLyrics(sample, AbortSignal.timeout(20000));
    assert.ok(lyrics?.lines.length > 0, sample.title);
    console.log(
      `Live LRCLIB: ${sample.title} -> synchronized lyrics found (${lyrics.lines.length} lines).`,
    );
  }
}
