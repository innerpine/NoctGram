import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function moduleFrom(entry) {
  const { outputFiles } = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  return import(
    'data:text/javascript;base64,' +
      Buffer.from(outputFiles[0].text).toString('base64')
  );
}
const keys = [
  'window',
  'document',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'fetch',
];
const saved = keys.map((key) => [
  key,
  Object.getOwnPropertyDescriptor(globalThis, key),
]);
const timers = new Map(),
  scripts = [],
  devices = [];
let now = 10000,
  timerId = 0;
const set = (key, value) =>
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
const element = () => ({
  children: [],
  removed: false,
  appendChild(child) {
    this.children.push(child);
  },
  remove() {
    this.removed = true;
  },
});
const doc = Object.assign(new EventTarget(), {
  visibilityState: 'visible',
  createElement: () => element(),
  head: {
    appendChild(script) {
      scripts.push(script);
    },
  },
});
set('document', doc);
set('window', { location: { origin: 'http://localhost:3000' } });
set('setTimeout', (fn) => {
  const id = ++timerId;
  timers.set(id, { fn, interval: false });
  return id;
});
set('setInterval', (fn) => {
  const id = ++timerId;
  timers.set(id, { fn, interval: true });
  return id;
});
set('clearTimeout', (id) => timers.delete(id));
set('clearInterval', (id) => timers.delete(id));
const tick = (ms) => {
  now += ms;
  for (const timer of timers.values()) if (timer.interval) timer.fn();
};
class Device {
  constructor(frame, { events }) {
    this.frame = frame;
    this.events = events;
    this.state = -1;
    this.time = 0;
    this.duration = 120;
    this.volume = 70;
    this.muted = false;
    this.calls = [];
    devices.push(this);
  }
  emit(state) {
    this.state = state;
    this.events.onStateChange({ data: state });
  }
  playVideo() {
    this.calls.push('play');
    this.emit(1);
  }
  loadVideoById(id) {
    this.calls.push(['load', id]);
    this.time = 0;
    this.emit(1);
  }
  cueVideoById(id) {
    this.calls.push(['cue', id]);
    this.time = 0;
    this.emit(5);
  }
  pauseVideo() {
    this.calls.push('pause');
    this.emit(2);
  }
  seekTo(time) {
    this.calls.push(['seek', time]);
    this.time = time;
  }
  setVolume(value) {
    this.volume = value;
  }
  getVolume() {
    return this.volume;
  }
  isMuted() {
    return this.muted;
  }
  unMute() {
    this.muted = false;
  }
  getCurrentTime() {
    return this.time;
  }
  getDuration() {
    return this.duration;
  }
  getPlayerState() {
    return this.state;
  }
  destroy() {
    this.calls.push('destroy');
    this.frame.remove();
  }
}
let player;
try {
  const youtube = await moduleFrom('lib/youtube-player.ts');
  const first = youtube.loadYouTubeSDK();
  assert.equal(
    youtube.loadYouTubeSDK(),
    first,
    'Concurrent loads share one script',
  );
  const lateFailure = scripts.at(-1).onerror;
  lateFailure();
  await assert.rejects(first);
  const retry = youtube.loadYouTubeSDK();
  lateFailure();
  assert.equal(
    youtube.loadYouTubeSDK(),
    retry,
    'An obsolete script cannot cancel its replacement',
  );
  window.YT = { Player: Device };
  window.onYouTubeIframeAPIReady();
  const sdk = await retry;
  const events = [],
    controls = [],
    states = [];
  const hooks = {
    shouldPlay: () => true,
    ready: () => events.push('ready'),
    blocked: () => events.push('blocked'),
    error: (error) => events.push(error),
    ended: () => events.push('ended'),
    state: (state) => states.push(state),
    control: (...args) => controls.push(args),
  };
  const host = element();
  player = new youtube.YouTubePlayback(
    sdk,
    host,
    'M7lc1UVf-VE',
    25,
    hooks,
    () => now,
  );
  const device = devices.at(-1);
  assert.equal(host.children.length, 1);
  assert.equal(
    new URL(device.frame.src).searchParams.get('origin'),
    'http://localhost:3000',
  );
  assert.equal(device.frame.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.equal(device.frame.tabIndex, -1);
  device.events.onReady();
  assert.deepEqual(device.calls, ['play']);
  assert.deepEqual(
    controls,
    [],
    'API-initiated playback does not echo to the room',
  );
  assert.equal(states.at(-1).volume, 25);
  device.time = 1;
  tick(1000);
  player.seek(45000);
  tick(250);
  assert.equal(states.at(-1).position, 45000);
  assert.deepEqual(
    controls,
    [],
    'Programmatic seeks do not loop back as room commands',
  );
  player.pause();
  assert.equal(states.at(-1).playing, false);
  assert.deepEqual(controls, []);
  tick(4000);
  device.time = 70;
  tick(250);
  assert.deepEqual(
    controls.at(-1),
    ['seek', { positionMs: 70000 }],
    'Native YouTube seeks synchronize with the room',
  );
  device.emit(1);
  assert.equal(controls.at(-1)[0], 'resume');
  device.emit(3);
  device.emit(1);
  assert.equal(controls.length, 2, 'Buffering is not a user resume command');
  device.emit(2);
  assert.equal(controls.at(-1)[0], 'pause');
  player.resume();
  assert.equal(controls.length, 3);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(device.state, 1, 'Hiding the page does not stop the audio');
  player.pause();
  assert.equal(device.state, 2);
  player.resume();
  assert.equal(device.state, 1, 'Shared controls still work without video UI');
  player.seek(55000);
  tick(250);
  assert.equal(states.at(-1).position, 55000);
  assert.equal(
    controls.length,
    3,
    'Audio controls do not echo pause, resume or seek commands to the room',
  );
  player.pause();
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(
    device.state,
    2,
    'Returning to the tab does not auto-start sound',
  );
  player.resume();
  device.muted = true;
  player.volume(36);
  tick(250);
  assert.equal(
    device.muted,
    false,
    'Our volume slider can unmute native YouTube mute',
  );
  assert.equal(states.at(-1).volume, 36);
  device.events.onAutoplayBlocked();
  assert.equal(events.at(-1), 'blocked');
  const nextEvents = [];
  const nextHooks = {
    ...hooks,
    ready: () => nextEvents.push('ready'),
    ended: () => nextEvents.push('ended'),
  };
  const frameBefore = device.frame;
  assert.equal(player.load('nextVideo01', nextHooks), true);
  assert.equal(
    host.children.length,
    1,
    'Queue changes reuse the activated iframe',
  );
  assert.equal(device.frame, frameBefore);
  assert.equal(
    device.state,
    1,
    'The next video starts without a second play tap',
  );
  device.emit(0);
  assert.deepEqual(
    nextEvents,
    ['ready', 'ended'],
    'End events belong to the new track',
  );
  assert.equal(
    player.load('pausedVideo', { ...nextHooks, shouldPlay: () => false }),
    true,
  );
  assert.equal(
    device.state,
    5,
    'Changing a paused room track only cues the next video',
  );
  device.events.onError({ data: 150 });
  assert.match(events.at(-1), /Автор запретил/);
  assert.equal(
    player.load('retryVideo', nextHooks),
    false,
    'A failed engine must be recreated by Retry',
  );
  player.dispose();
  player.dispose();
  assert.equal(device.calls.filter((call) => call === 'destroy').length, 1);
  assert.equal(device.frame.removed, true);
  const afterDispose = events.length + states.length + controls.length;
  device.events.onReady();
  device.emit(1);
  device.events.onError({ data: 100 });
  assert.equal(
    events.length + states.length + controls.length,
    afterDispose,
    'Late callbacks cannot resurrect the old player',
  );

  player = new youtube.YouTubePlayback(
    sdk,
    element(),
    'M7lc1UVf-VE',
    30,
    { ...hooks, shouldPlay: () => false },
    () => now,
  );
  const pausedDevice = devices.at(-1);
  pausedDevice.events.onReady();
  assert.deepEqual(
    pausedDevice.calls,
    [],
    'Joining a paused room does not auto-play',
  );
  player.dispose();

  const sc = await moduleFrom('lib/soundcloud-widget.ts');
  const scFirst = sc.loadSoundCloudWidget();
  const oldOnLoad = scripts.at(-1).onload;
  scripts.at(-1).onerror();
  await assert.rejects(scFirst);
  const scRetry = sc.loadSoundCloudWidget();
  oldOnLoad();
  assert.equal(
    sc.loadSoundCloudWidget(),
    scRetry,
    'Late SoundCloud load cannot reset the active retry',
  );
  window.SC = { Widget: () => ({}) };
  scripts.at(-1).onload();
  await scRetry;

  const spotify = await moduleFrom('lib/spotify-player.ts');
  const spFirst = spotify.loadSpotifySDK();
  const oldSpFailure = scripts.at(-1).onerror;
  oldSpFailure();
  await assert.rejects(spFirst);
  const spRetry = spotify.loadSpotifySDK();
  oldSpFailure();
  assert.equal(spotify.loadSpotifySDK(), spRetry);
  window.Spotify = { Player: class {} };
  window.onSpotifyWebPlaybackSDKReady();
  await spRetry;

  const { resolveYouTubeMetadata } = await moduleFrom(
    'lib/youtube-metadata.ts',
  );
  const requests = [];
  set('fetch', async (url, options) => {
    requests.push([url, options]);
    return Response.json({
      title: 'Night Motion',
      author_name: 'Example Artist',
      author_url: 'https://www.youtube.com/@example',
      html: '<script>untrusted</script>',
    });
  });
  const track = await resolveYouTubeMetadata(
    'https://music.youtube.com/watch?v=M7lc1UVf-VE&si=tracking',
  );
  assert.equal(track.provider, 'youtube');
  assert.equal(track.title, 'Night Motion');
  assert.equal(track.url, 'https://www.youtube.com/watch?v=M7lc1UVf-VE');
  assert.equal(track.html, undefined);
  assert.equal(requests[0][1].redirect, 'manual');
  assert.equal(new URL(requests[0][0]).hostname, 'www.youtube.com');
  assert.equal(new URL(requests[0][0]).searchParams.get('url'), track.url);
  await assert.rejects(
    resolveYouTubeMetadata('https://youtube.com.evil.test/watch?v=M7lc1UVf-VE'),
  );
  assert.equal(requests.length, 1);
  set('fetch', async () => new Response('', { status: 404 }));
  await assert.rejects(
    resolveYouTubeMetadata(track.url),
    (error) => error.status === 422,
  );
  set('fetch', async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(
    resolveYouTubeMetadata(track.url),
    (error) => error.status === 502,
  );
  console.log(
    'YouTube: audio controls, native room events, blocked autoplay, hidden playback, cleanup, metadata boundaries and SDK retry races passed.',
  );
} finally {
  player?.dispose();
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
