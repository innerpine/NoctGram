import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  new URL('../lib/music-player.ts', import.meta.url),
  'utf8',
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const {
  defaultAppearance,
  readAppearance,
  playerArtwork,
  parseLrc,
  currentLyric,
  readLyrics,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);

// Old/corrupted browser storage must not produce an invisible or invalid player.
for (const value of [null, false, 'bad', [], {}])
  assert.deepEqual(readAppearance(value), defaultAppearance);
assert.deepEqual(
  readAppearance({
    darkness: 300,
    blur: -30,
    textSize: Infinity,
    motion: false,
    softLyrics: false,
  }),
  {
    darkness: 85,
    blur: 24,
    textSize: 32,
    motion: false,
    softLyrics: false,
  },
);
assert.equal(readAppearance({ darkness: NaN }).darkness, 55);
assert.equal(readAppearance({ textSize: 16 }).textSize, 24);

assert.equal(
  playerArtwork('https://i1.sndcdn.com/art-large.jpg', true),
  'https://i1.sndcdn.com/art-t500x500.jpg',
);
assert.equal(
  playerArtwork('https://i2.sndcdn.com/art-t100x100.png', true),
  'https://i2.sndcdn.com/art-t500x500.png',
);
assert.equal(
  playerArtwork('https://i1.sndcdn.com/unknown-size.jpg', true),
  'https://i1.sndcdn.com/unknown-size.jpg',
);
for (const url of [
  'javascript:alert(1)',
  'http://i1.sndcdn.com/art.jpg',
  'https://i1.sndcdn.com.evil.test/art.jpg',
  'https://name:secret@i1.sndcdn.com/art.jpg',
  'https://i1.sndcdn.com:8443/art.jpg',
  undefined,
])
  assert.equal(playerArtwork(url, true), '');

// Use invented fixture text only; repeated timestamps, fractions and gaps are real LRC cases.
const lines = parseLrc(
  '[ar:Fixture]\n[00:05.25][00:15.250]Line B\n[00:01.5]Line A\n[00:09.00]\nnot a lyric\n[00:62.00]Invalid',
);
assert.deepEqual(lines, [
  { time: 1500, text: 'Line A' },
  { time: 5250, text: 'Line B' },
  { time: 9000, text: '' },
  { time: 15250, text: 'Line B' },
]);
assert.equal(currentLyric(lines, 0), -1);
assert.equal(currentLyric(lines, 5250), 1);
assert.equal(currentLyric(lines, 8999), 1);
assert.equal(currentLyric(lines, 9000), 2);
assert.equal(currentLyric(lines, 20000), 3);
assert.equal(currentLyric(lines, 2000), 0); // Seek backwards must undo the active line.
assert.equal(currentLyric([], 100), -1);
assert.deepEqual(parseLrc('[offset:200]\n[00:01.00]Line'), [
  { time: 800, text: 'Line' },
]);
assert.deepEqual(parseLrc('[offset:-300]\n[00:01.00]Line'), [
  { time: 1300, text: 'Line' },
]);
assert.equal(parseLrc('[00:01]Line\n'.repeat(2000)).length, 1000);

assert.equal(
  readLyrics({ duration: 220, syncedLyrics: '[00:01]Wrong remix' }, 180000),
  null,
);
assert.equal(
  readLyrics({ duration: Infinity, plainLyrics: 'Invalid' }, 180000),
  null,
);
assert.equal(readLyrics({ duration: 180 }, 180000), null);
assert.equal(readLyrics(null, 180000), null);
assert.deepEqual(readLyrics({ duration: 180, instrumental: true }, 180000), {
  lines: [],
  plain: '',
  instrumental: true,
});
assert.deepEqual(
  readLyrics({ duration: 180, plainLyrics: 'Untimed fixture' }, 180000),
  { lines: [], plain: 'Untimed fixture', instrumental: false },
);
assert.deepEqual(
  readLyrics({ duration: 180, syncedLyrics: '[00:01]Fixture' }, 181500)?.lines,
  [{ time: 1000, text: 'Fixture' }],
);
console.log(
  'Music player: appearance, artwork boundaries, timed lyrics and recording matching passed.',
);

const widgetSource = await readFile(
  new URL('../lib/soundcloud-widget.ts', import.meta.url),
  'utf8',
);
const widgetJs = ts.transpileModule(widgetSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { releaseSoundCloudWidget } = await import(
  'data:text/javascript;base64,' + Buffer.from(widgetJs).toString('base64')
);
const disposed = [];
releaseSoundCloudWidget(
  {
    unbind: (event) => disposed.push(event),
    pause: () => disposed.push('paused'),
  },
  { PLAY: 'play', PAUSE: 'pause' },
);
assert.deepEqual(disposed, ['play', 'pause', 'paused']);
let attempts = 0;
assert.doesNotThrow(() =>
  releaseSoundCloudWidget(
    {
      unbind() {
        attempts++;
        throw new TypeError('Detached iframe');
      },
      pause() {
        attempts++;
        throw new TypeError('Detached iframe');
      },
    },
    { PLAY: 'play', PAUSE: 'pause' },
  ),
);
assert.equal(attempts, 3);
console.log('Music player: detached SoundCloud iframe cleanup passed.');
