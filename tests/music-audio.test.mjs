import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['lib/spotify-metadata.ts', 'lib/music-audio.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'work/unused',
  write: false,
});
const modules = {};
for (const file of compiled.outputFiles)
  modules[file.path.split(/[\\/]/).at(-1)] = await import(
    'data:text/javascript;base64,' + Buffer.from(file.text).toString('base64')
  );
const { spotifyPageMetadata } = modules['spotify-metadata.js'];
const { audioRange, musicAudioType } = modules['music-audio.js'];
assert.deepEqual(
  spotifyPageMetadata(
    `<meta content="Test &amp; Artist · Album · Song · 2020" property="og:description"><meta name='music:duration' content='214'><meta name="music:musician" content="https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt">`,
  ),
  {
    artist: 'Test & Artist',
    durationMs: 214000,
    authorUrl: 'https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt',
  },
);
assert.equal(
  spotifyPageMetadata('<meta name="music:duration" content="Infinity">')
    .durationMs,
  0,
);
assert.equal(
  spotifyPageMetadata(
    '<meta name="music:musician" content="https://evil.test">',
  ).authorUrl,
  '',
);
assert.deepEqual(audioRange(null, 100), {
  offset: 0,
  length: 100,
  partial: false,
});
assert.deepEqual(audioRange('bytes=0-9', 100), {
  offset: 0,
  length: 10,
  partial: true,
});
assert.deepEqual(audioRange('bytes=50-', 100), {
  offset: 50,
  length: 50,
  partial: true,
});
assert.deepEqual(audioRange('bytes=-20', 100), {
  offset: 80,
  length: 20,
  partial: true,
});
assert.deepEqual(audioRange('bytes=90-999', 100), {
  offset: 90,
  length: 10,
  partial: true,
});
for (const value of [
  'bytes=100-',
  'bytes=-0',
  'bytes=20-10',
  'bytes=1-2,4-5',
  'bytes=-',
  'items=0-10',
  'bytes=9999999999999999999999-',
])
  assert.equal(audioRange(value, 100), null);
assert.equal(
  musicAudioType(new TextEncoder().encode('<html>not-audio</html>')),
  null,
);
assert.equal(
  musicAudioType(new TextEncoder().encode('ID31234567890123')),
  'audio/mpeg',
);
assert.equal(
  musicAudioType(new TextEncoder().encode('RIFF1234WAVEdata')),
  'audio/wav',
);
assert.equal(
  musicAudioType(new TextEncoder().encode('RIFF1234WEBPdata')),
  null,
);
assert.equal(
  musicAudioType(new TextEncoder().encode('fLaC1234567890123')),
  'audio/flac',
);
assert.equal(
  musicAudioType(new TextEncoder().encode('OggS1234567890123')),
  'audio/ogg',
);
console.log('Spotify public metadata, audio types and seek ranges passed.');
