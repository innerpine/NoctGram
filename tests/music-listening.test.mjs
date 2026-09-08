import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/music-listening.ts', import.meta.url),
  'utf8',
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { MusicListenTracker, adjacentPlayable } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
let time = 0,
  day = 1,
  counts = 0;
const changes = [],
  requests = [];
const api = async (action, body) => {
  requests.push({ action, body });
  return action === 'start' ? { session: 's' } : { counted: true };
};
const tracker = new MusicListenTracker(
  api,
  (s) => changes.push(s),
  () => counts++,
  () => time,
  () => day * 86400000,
);
await tracker.start('song');
tracker.sample(0, true);
for (let i = 1; i <= 10; i++) {
  time += 1000;
  tracker.sample(i * 1000, true);
}
assert.equal(changes.at(-1).seconds, 10);
time += 60000;
tracker.sample(70000, false); // A long pause contributes nothing.
tracker.resetPosition();
tracker.sample(100000, true); // Seeking contributes nothing.
time += 1000;
tracker.sample(101000, true);
assert.equal(changes.at(-1).seconds, 11);
time += 15000;
tracker.sample(116000, true); // Suspended background tab.
assert.equal(changes.at(-1).seconds, 11);
tracker.resetPosition();
tracker.sample(0, true); // Repeating a short song retains elapsed audio.
for (let i = 1; i <= 19; i++) {
  time += 1000;
  tracker.sample(i * 1000, true);
}
await tick();
assert.equal(counts, 1);
assert.equal(changes.at(-1).status, 'counted');
assert.deepEqual(
  requests.map((r) => r.action),
  ['start', 'progress'],
);
for (let i = 20; i < 60; i++) {
  time += 1000;
  tracker.sample(i * 1000, true);
}
await tick();
assert.equal(requests.length, 2);
day++;
tracker.sample(0, true);
await tick();
assert.equal(requests.at(-1).action, 'start');
assert.equal(changes.at(-1).seconds, 0);

let acknowledge;
const seen = [];
const stale = new MusicListenTracker(
  () => new Promise((resolve) => (acknowledge = resolve)),
  (s) => seen.push(s),
  () => assert.fail('stale count'),
);
const pending = stale.start('old');
stale.dispose();
acknowledge({ session: 'old' });
await pending;
assert.equal(seen.at(-1).status, 'checking');

let attempt = 0,
  retryCounts = 0;
const retry = new MusicListenTracker(
  async (action) => {
    if (action === 'start') return { session: 'retry' };
    if (++attempt === 1) throw Error('Network interrupted');
    return { counted: true };
  },
  () => {},
  () => retryCounts++,
  () => time,
);
await retry.start('song');
retry.sample(0, true);
for (let i = 1; i <= 30; i++) {
  time += 1000;
  retry.sample(i * 1000, true);
}
await tick();
assert.equal(attempt, 1);
for (let i = 31; i <= 40; i++) {
  time += 1000;
  retry.sample(i * 1000, true);
}
await tick();
assert.equal(attempt, 2);
assert.equal(retryCounts, 1);

const off = new MusicListenTracker(
  async () => ({ session: null }),
  (s) => seen.push(s),
  () => assert.fail('opt out count'),
);
await off.start('song');
assert.equal(seen.at(-1).status, 'off');
const counted = new MusicListenTracker(
  async () => ({ session: null, counted: true }),
  (s) => seen.push(s),
  () => assert.fail('already counted'),
);
await counted.start('song');
assert.equal(seen.at(-1).status, 'counted');

const queue = [
  { url: 'a', provider: 'soundcloud' },
  { url: 'b', provider: 'spotify' },
  { url: 'c', provider: 'spotify', audioUrl: '/audio' },
];
assert.equal(adjacentPlayable(queue, 'a').url, 'c');
assert.equal(adjacentPlayable(queue, 'c', -1).url, 'a');
assert.equal(adjacentPlayable(queue, 'c').url, 'a');
assert.equal(adjacentPlayable(queue, 'a', -1).url, 'c');
assert.equal(adjacentPlayable(queue, 'c', 1, true).url, 'a');
assert.equal(adjacentPlayable(queue, 'b', -1, true).url, 'a');
assert.equal(adjacentPlayable(queue, 'a', 1, true).playback, 'spotify');
assert.equal(adjacentPlayable([queue[1], queue[2]], 'c', 1, true).url, 'b');
assert.equal(adjacentPlayable([queue[0], queue[1]], 'a'), undefined);
assert.equal(adjacentPlayable([queue[0]], 'a'), undefined);
assert.equal(adjacentPlayable(queue, 'missing'), undefined);
console.log(
  'Listening: elapsed audio, pause/seek/suspension, repeat, UTC rollover, stale responses, retries, consent and playable queue passed.',
);
