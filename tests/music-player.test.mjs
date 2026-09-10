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
  stableLyricDuration,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);

// A playing HLS recording retains its lyrics while duration metadata settles.
const settledDuration = 102947;
for (const correction of [102984, 102942, 103201, 102500, 105447])
  assert.equal(stableLyricDuration(settledDuration, correction), settledDuration);
// A temporary unknown duration must not blank text already on screen.
for (const unavailable of [0, -1, NaN, Infinity])
  assert.equal(stableLyricDuration(settledDuration, unavailable), settledDuration);
// Late metadata starts the lookup; a materially different recording is checked
// again. Compare against the original duration so small changes cannot drift.
assert.equal(stableLyricDuration(0, 102946.802), settledDuration);
assert.equal(stableLyricDuration(settledDuration, 105448), 105448);
assert.equal(stableLyricDuration(settledDuration, 99000), 99000);
assert.equal(stableLyricDuration(0, 0), 0);

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
const { releaseSoundCloudWidget, SoundCloudStateMonitor } = await import(
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

// Reproduce a missed PAUSE event and delayed cross-frame getter responses.
const savedPerformance = Object.getOwnPropertyDescriptor(
  globalThis,
  'performance',
);
let clock = 0;
Object.defineProperty(globalThis, 'performance', {
  configurable: true,
  value: { now: () => clock },
});
try {
  const states = [],
    positions = [],
    stateReads = [],
    positionReads = [];
  const monitor = new SoundCloudStateMonitor(
    {
      isPaused: (callback) => stateReads.push(callback),
      getPosition: (callback) => positionReads.push(callback),
    },
    (value) => states.push(value),
    (value) => positions.push(value),
  );
  monitor.playing(true);
  monitor.refresh();
  monitor.refresh();
  assert.equal(stateReads.length, 1, 'Only one confirmation is in flight');
  stateReads.shift()(true); // Audio paused, but the PAUSE event never arrived.
  positionReads.shift()(94191);
  assert.equal(
    states.at(-1),
    false,
    'Real audio state repairs a stuck playing icon',
  );
  assert.equal(
    positions.at(-1),
    94191,
    'Paused position comes from the actual engine',
  );

  monitor.refresh();
  monitor.playing(false);
  stateReads.shift()(false); // A playing sample from before the pause.
  positionReads.shift()(92000);
  assert.equal(
    states.at(-1),
    false,
    'An old getter cannot undo a newer pause event',
  );
  assert.equal(positions.at(-1), 94191);

  monitor.refresh();
  monitor.invalidate(); // A new seek command invalidates both pending getters.
  monitor.position(50000);
  stateReads.shift()(false);
  positionReads.shift()(94000);
  assert.equal(states.at(-1), false);
  assert.equal(
    positions.at(-1),
    50000,
    'An old getter cannot rewind a new seek',
  );

  monitor.refresh();
  monitor.position(52000); // A newer PLAY_PROGRESS arrived during the query.
  stateReads.shift()(false);
  positionReads.shift()(51000);
  assert.equal(
    positions.at(-1),
    52000,
    'New progress wins over delayed position reads',
  );
  assert.equal(
    states.at(-1),
    true,
    'Confirmation also recovers a missed PLAY event',
  );

  monitor.refresh();
  clock += 3000; // A frame did not answer; the next poll must recover.
  monitor.refresh();
  stateReads.shift()(false);
  positionReads.shift()(53000);
  stateReads.shift()(true);
  positionReads.shift()(54000);
  assert.equal(states.at(-1), false);
  assert.equal(
    positions.at(-1),
    54000,
    'Expired replies cannot replace a new snapshot',
  );

  monitor.refresh();
  monitor.dispose();
  stateReads.shift()(false);
  positionReads.shift()(55000);
  monitor.refresh();
  assert.equal(states.at(-1), false);
  assert.equal(
    positions.at(-1),
    54000,
    'Callbacks from a removed player are ignored',
  );
  assert.equal(stateReads.length, 0, 'Disposed monitors stop querying');
  console.log(
    'SoundCloud state: missed play/pause, delayed getters, seek races, timeout and disposal passed.',
  );
} finally {
  if (savedPerformance)
    Object.defineProperty(globalThis, 'performance', savedPerformance);
  else delete globalThis.performance;
}
