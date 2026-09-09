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
