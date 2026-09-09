import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = ts.transpileModule(
  await readFile('lib/native-music-audio.ts', 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const { NativeMusicAudio, prefersNativeHls } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);
assert.equal(prefersNativeHls('AppleWebKit Version/18 Safari'), true);
assert.equal(prefersNativeHls('iPhone AppleWebKit CriOS/153 Safari'), true);
assert.equal(prefersNativeHls('Android AppleWebKit Chrome/153 Safari'), false);
class Audio extends EventTarget {
  src = '';
  readyState = 0;
  currentTime = 0;
  plays = 0;
  pauses = 0;
  loads = 0;
  native = true;
  rejectPlay = false;
  canPlayType() {
    return this.native ? 'probably' : '';
  }
  setAttribute() {}
  removeAttribute() {
    this.src = '';
  }
  load() {
    this.loads++;
    this.readyState = 0;
    this.currentTime = 0;
  }
  pause() {
    this.pauses++;
  }
  play() {
    this.plays++;
    return this.rejectPlay
      ? Promise.reject(new DOMException('Gesture needed', 'NotAllowedError'))
      : Promise.resolve();
  }
}
const audio = new Audio(),
  player = new NativeMusicAudio(audio, undefined, () => true);
player.load('/first.m3u8', true, true);
assert.equal(
  audio.plays,
  1,
  'Safari play() runs before the tap handler returns',
);
player.load('/second.m3u8', true, true);
assert.equal(audio.src, '/second.m3u8');
assert.equal(audio.plays, 2);
assert.equal(audio.loads, 2);
audio.readyState = 1;
player.load('/second.m3u8', true, true);
assert.equal(
  audio.loads,
  2,
  'Metadata attachment cannot reset a track started by the tap',
);
player.load('/third.m3u8', true, false);
assert.equal(player.intendsToPlay, false);
const before = audio.plays;
player.resume();
assert.equal(audio.plays, before + 1);
player.pause();
assert.equal(player.intendsToPlay, false);
let blocked = 0;
audio.addEventListener('noctgram:audio-blocked', () => blocked++);
audio.rejectPlay = true;
player.resume();
await new Promise((r) => setTimeout(r, 0));
assert.equal(blocked, 1);
player.dispose();
assert.equal(audio.src, '');

class FakeHls {
  static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
  static instances = [];
  static isSupported() {
    return true;
  }
  events = {};
  sources = [];
  destroyed = false;
  constructor() {
    FakeHls.instances.push(this);
  }
  on(e, cb) {
    this.events[e] = cb;
  }
  attachMedia(el) {
    this.element = el;
  }
  loadSource(url) {
    this.sources.push(url);
    // Replacing the MediaSource clears old metadata and currentTime.
    this.element.load();
  }
  destroy() {
    this.destroyed = true;
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const android = new Audio();
android.native = false;
const hlsPlayer = new NativeMusicAudio(android, async () => ({
  default: FakeHls,
}));
hlsPlayer.load('/one', true, true);
await tick();
const hls = FakeHls.instances[0];
hlsPlayer.pause();
hls.events.manifest();
assert.equal(android.plays, 0, 'A late manifest cannot undo a pause');
hlsPlayer.load('/two', true, true);
await tick();
hls.events.manifest();
assert.equal(FakeHls.instances.length, 1);
assert.equal(hls.element, android);
assert.equal(android.plays, 1);
// The new provider effect may attach before the async HLS import settles. A
// queued timeupdate/metadata callback must neither publish nor resume old audio.
android.readyState = 4;
android.currentTime = 1.25;
assert.equal(hlsPlayer.positionMs, 1250);
const oldPlays = android.plays;
hlsPlayer.load('/three', true, true);
assert.equal(android.currentTime, 1.25, 'Old media remains until HLS loads');
assert.equal(hlsPlayer.positionMs, 0, 'Pending source cannot leak old time');
assert.equal(hlsPlayer.hasMetadata, false);
hlsPlayer.load('/three', true, true);
hlsPlayer.resume();
assert.equal(android.plays, oldPlays, 'Cannot resume the previous source');
await tick();
assert.equal(hlsPlayer.positionMs, 0, 'Stay at zero while buffering');
android.readyState = 4;
android.currentTime = 0.2;
hls.events.manifest();
assert.equal(android.plays, oldPlays + 1);
assert.equal(hlsPlayer.positionMs, 200);
android.currentTime = 42;
assert.equal(hlsPlayer.positionMs, 42000, 'Actual forward seeks stay visible');
android.currentTime = 0;
assert.equal(hlsPlayer.positionMs, 0, 'Actual backward seeks stay visible');
let finishImport;
const delayed = new NativeMusicAudio(
  new Audio(),
  () => new Promise((r) => (finishImport = r)),
);
// Switch away while the HLS library is loading: no stale stream may start.
const a = new Audio();
a.native = false;
const late = new NativeMusicAudio(
  a,
  () => new Promise((r) => (finishImport = r)),
);
late.load('/stale', true, true);
late.load('/file.mp3', false, true);
finishImport({ default: FakeHls });
await tick();
assert.equal(a.src, '/file.mp3');
assert.equal(FakeHls.instances.length, 1);
hlsPlayer.dispose();
assert.equal(hls.destroyed, true);
delayed.dispose();
console.log(
  'Persistent audio: synchronous activation, queue reuse, pause intent, late loads and blocked playback passed',
);
