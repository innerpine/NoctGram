import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { createElement, createContext, useContext } from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const folder = new URL('../work/music-context-test/', import.meta.url);
await mkdir(folder, { recursive: true });
const output = new URL('context.mjs', folder);
await build({
  entryPoints: ['lib/music-context.ts'],
  outfile: fileURLToPath(output),
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
});
const previousWindow = globalThis.window;
// A fresh tab. This is a React rendering test, not a browser or provider mock.
globalThis.window = {};
try {
  let received;
  function readThrough(provider, consumer, value) {
    received = undefined;
    function Button() {
      received = consumer();
      return null;
    }
    renderToString(createElement(provider, { value }, createElement(Button)));
    return received;
  }
  // The former pattern creates a new identity on reload: no exception, but all
  // music?.play(...) clicks silently do nothing under the still-mounted root.
  const oldRoot = createContext(null);
  const reloadedContext = createContext(null);
  const played = [];
  const value = {
    play: (track) => played.push(track.url),
    stop() {},
    playing: false,
    currentUrl: '',
  };
  assert.equal(
    readThrough(oldRoot, () => useContext(reloadedContext), value),
    null,
  );

  const first = await import(output.href + '?root');
  const refreshed = await import(output.href + '?refreshed-consumer');
  assert.notEqual(
    first.useMusic,
    refreshed.useMusic,
    'The consumer module really re-executed',
  );
  assert.equal(
    first.MusicContext,
    refreshed.MusicContext,
    'The mounted provider identity survives',
  );
  const music = readThrough(first.MusicContext, refreshed.useMusic, value);
  assert.equal(music, value);
  music.play({
    url: 'https://soundcloud.com/noctgram-qa/test-track',
    provider: 'soundcloud',
    kind: 'track',
  });
  assert.equal(
    played.length,
    1,
    'A refreshed play button still reaches the original provider',
  );
  assert.equal(
    readThrough(refreshed.MusicContext, first.useMusic, value),
    value,
    'Root and consumer can refresh in either order',
  );

  globalThis.window = {};
  const anotherTab = await import(output.href + '?another-tab');
  assert.notEqual(
    anotherTab.MusicContext,
    first.MusicContext,
    'Tabs do not share a player',
  );
  delete globalThis.window;
  const server = await import(output.href + '?server');
  assert.notEqual(
    server.MusicContext,
    first.MusicContext,
    'SSR does not reuse browser state',
  );
  console.log(
    'Music context: reproduced silent clicks after module reload; stable context routes play in either refresh order, with tab and SSR isolation.',
  );
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  await rm(output, { force: true });
}
