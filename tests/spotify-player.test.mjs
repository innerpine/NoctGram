import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['lib/spotify-player.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { SpotifyPlayback } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64')
);
const id = '4uLU6hMCjMI75M1A2tKUQC',
  url = 'https://open.spotify.com/track/' + id;
let device,
  now = 0,
  ended = 0,
  blocked = 0;
const errors = [],
  states = [];
const requests = [];
class Device {
  events = {};
  paused = 0;
  resumed = 0;
  activated = 0;
  disconnected = 0;
  constructor(options) {
    device = this;
    this.options = options;
  }
  addListener(event, cb) {
    this.events[event] = cb;
    return true;
  }
  async connect() {
    this.events.ready({ device_id: 'local-device' });
    return true;
  }
  disconnect() {
    this.disconnected++;
  }
  async pause() {
    this.paused++;
  }
  async resume() {
    this.resumed++;
  }
  async activateElement() {
    this.activated++;
  }
  async seek(ms) {
    this.seeked = ms;
  }
  async setVolume(level) {
    this.volume = level;
  }
}
const hooks = {
  ready() {},
  state: (state) => states.push(state),
  error: (error) => errors.push(error),
  ended: () => ended++,
  autoplayBlocked: () => blocked++,
};
const request = async (url, init) => {
  requests.push({ url, init });
  if (url.startsWith('/api/'))
    return Response.json({
      accessToken: 'short-lived-test-token',
      expiresAt: Date.now() + 3600000,
    });
  return new Response(null, { status: 204 });
};
const player = new SpotifyPlayback(
  { Player: Device },
  url,
  0.7,
  hooks,
  request,
  () => now,
);
try {
  await player.connect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].init.body).uris, [
    'spotify:track:' + id,
  ]);
  assert.equal(requests[1].init.credentials, 'omit');
  const state = {
    paused: false,
    position: 105000,
    duration: 107000,
    track_window: {
      current_track: {
        uri: 'spotify:track:' + id,
        name: 'Test',
        artists: [{ name: 'Artist' }],
        album: { images: [] },
      },
    },
  };
  device.events.player_state_changed(state);
  assert.equal(states.at(-1).track.title, 'Test');
  player.volume(0.23);
  player.seek(104000);
  assert.equal(device.volume, 0.23);
  assert.equal(device.seeked, 104000);
  device.events.player_state_changed(state);
  now = 2000;
  player.toggle(); // Explicit pause near the end must not loop the track.
  assert.equal(device.activated, 1);
  assert.equal(device.paused, 1);
  device.events.player_state_changed({ ...state, paused: true, position: 0 });
  assert.equal(ended, 0);
  player.resume();
  device.events.player_state_changed(state);
  now = 4000;
  device.events.player_state_changed({ ...state, paused: true, position: 0 });
  device.events.player_state_changed({ ...state, paused: true, position: 0 });
  assert.equal(
    ended,
    1,
    'Finish is emitted once, not for repeated state messages',
  );
  device.events.autoplay_failed();
  assert.equal(blocked, 1);
  device.events.account_error({ message: 'premium missing' });
  assert.match(errors.at(-1), /Premium/);
  const before = states.length;
  player.dispose();
  device.events.player_state_changed(state);
  assert.equal(states.length, before);
  assert.equal(device.disconnected, 1);
  assert.equal(
    requests.filter((x) => x.url.startsWith('/api/')).length,
    1,
    'SDK access token reused only within the device lifetime',
  );
} finally {
  player.dispose();
}
let resolveToken;
const pending = new SpotifyPlayback(
  { Player: Device },
  url,
  0.7,
  hooks,
  async () =>
    new Promise((resolve) => {
      resolveToken = resolve;
    }),
);
const connect = pending.connect();
pending.dispose();
resolveToken(
  Response.json({ accessToken: 'late-token', expiresAt: Date.now() + 3600000 }),
);
await assert.rejects(connect, (error) => error.name === 'AbortError');
assert.equal(device.disconnected, 1);
// Browser fetch is receiver-sensitive. The default transport must call it on
// globalThis, never with SpotifyPlayback as its receiver (Illegal invocation).
const originalFetch = globalThis.fetch;
let defaultCalls = 0;
globalThis.fetch = async function (...args) {
  assert.equal(this, globalThis);
  defaultCalls++;
  return request(...args);
};
const defaultPlayer = new SpotifyPlayback({ Player: Device }, url, 0.5, hooks);
try {
  await defaultPlayer.connect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    defaultCalls,
    2,
    'Both token and playback requests use the bound transport',
  );
} finally {
  defaultPlayer.dispose();
  globalThis.fetch = originalFetch;
}
console.log(
  'Spotify device: official playback, token lifecycle, transport, Premium/autoplay failures, pause versus finish and late cancellation passed.',
);
