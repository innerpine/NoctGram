import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the actual hook with effect cleanup and a controlled clock, including
// track changes while I/O is pending. No production requests or account writes.
let now = 100000,
  cursor = 0,
  queued = false,
  mounted = true,
  output;
let track = { url: 'one', title: 'Fixture', artist: 'Fixture artist' },
  enabled = true;
const slots = [],
  effects = [],
  timers = new Map(),
  calls = [];
let timerId = 0,
  response;
const queue = () => {
  if (!queued && mounted) {
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (mounted) render();
    });
  }
};
globalThis.__lyricHooks = {
  useState(initial) {
    const index = cursor++;
    if (!(index in slots))
      slots[index] = typeof initial === 'function' ? initial() : initial;
    return [
      slots[index],
      (next) => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) {
          slots[index] = value;
          queue();
        }
      },
    ];
  },
  useRef(initial) {
    const index = cursor++;
    return (slots[index] ||= { current: initial });
  },
  useEffect(effect, deps) {
    const index = cursor++;
    if (
      !slots[index] ||
      deps.some((value, i) => !Object.is(value, slots[index].deps[i]))
    ) {
      effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    }
  },
};
globalThis.__lyricLoader = {
  load(...args) {
    calls.push(args);
    return Promise.resolve(response(...args));
  },
};
const built = await build({
  entryPoints: ['lib/use-track-lyrics.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'hook-fixtures',
      setup(build) {
        build.onResolve(
          { filter: /^(react|\.\/track-lyrics-cache)$/ },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'react'
              ? 'export const { useState, useRef, useEffect } = globalThis.__lyricHooks;'
              : 'export const trackLyricsCache = globalThis.__lyricLoader;',
        }));
      },
    },
  ],
});
const { useTrackLyrics } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(built.outputFiles[0].text).toString('base64')
);
function render() {
  cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  output = useTrackLyrics(track, 234000, enabled);
  for (const effect of effects.splice(0)) effect();
}
const saved = new Map(
  ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].map((key) => [
    key,
    globalThis[key],
  ]),
);
const realNow = Date.now;
const schedule = (fn, delay, interval = 0) => {
  const id = ++timerId;
  timers.set(id, { fn, next: now + delay, interval });
  return id;
};
globalThis.setTimeout = (fn, delay) => schedule(fn, delay);
globalThis.setInterval = (fn, delay) => schedule(fn, delay, delay);
globalThis.clearTimeout = globalThis.clearInterval = (id) => timers.delete(id);
Date.now = () => now;
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
async function step(ms) {
  const end = now + ms;
  for (let i = 0; i < 1000; i++) {
    const due = [...timers.entries()]
      .filter(([, item]) => item.next <= end)
      .sort((a, b) => a[1].next - b[1].next)[0];
    if (!due) break;
    const [id, item] = due;
    now = item.next;
    if (item.interval) item.next += item.interval;
    else timers.delete(id);
    item.fn();
    await flush();
  }
  now = end;
  await flush();
}
const lyrics = {
  lines: [{ time: 0, text: 'Synthetic fixture' }],
  plain: '',
  instrumental: false,
};
const failed = () => ({ lyrics: null, error: true, retryAt: now + 8000 });
try {
  response = () => (calls.length === 1 ? failed() : { lyrics });
  render();
  await flush();
  assert.equal(output.error, true);
  assert.equal(output.retryIn, 8);
  output.retry();
  await flush();
  assert.equal(calls.length, 1, 'No request flood during the displayed wait');
  await step(8050);
  assert.equal(calls.length, 2);
  assert.equal(
    output.lyrics,
    lyrics,
    'Temporary errors recover without another click',
  );

  response = failed;
  track = { ...track, url: 'two' };
  render();
  await flush();
  const initial = calls.length;
  await step(60000);
  assert.equal(
    calls.length,
    initial + 2,
    'Automatic retries stop after two attempts',
  );
  assert.equal(output.retryIn, 0);
  response = () => ({ lyrics });
  output.retry();
  await flush();
  assert.equal(calls.length, initial + 3);
  assert.equal(calls.at(-1)[2], true);
  assert.equal(output.lyrics, lyrics);

  let release;
  response = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  track = { ...track, url: 'three' };
  render();
  await flush();
  response = () => ({ lyrics });
  track = { ...track, url: 'four' };
  render();
  await flush();
  const selectedKey = output.key;
  release({ lyrics: { ...lyrics, plain: 'Old track' } });
  await flush();
  assert.equal(output.key, selectedKey);
  assert.equal(
    output.lyrics,
    lyrics,
    'Late results cannot replace the selected track',
  );

  response = failed;
  track = { ...track, url: 'five' };
  render();
  await flush();
  const beforeClose = calls.length;
  enabled = false;
  render();
  await flush();
  await step(60000);
  assert.equal(
    calls.length,
    beforeClose,
    'Disabling lyrics cancels scheduled retries',
  );
  enabled = true;
  render();
  await flush();
  mounted = false;
  for (const slot of slots) slot?.cleanup?.();
  const beforeUnmount = calls.length;
  await step(60000);
  assert.equal(calls.length, beforeUnmount);
  assert.equal(timers.size, 0);
} finally {
  for (const [key, value] of saved) globalThis[key] = value;
  Date.now = realNow;
  delete globalThis.__lyricHooks;
  delete globalThis.__lyricLoader;
}
console.log(
  'Lyrics hook: countdown, bounded automatic recovery, manual retry, stale results and timer cleanup passed.',
);
