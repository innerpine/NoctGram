import assert from 'node:assert/strict';
import { build } from 'esbuild';
const slots = [],
  effects = [];
let cursor = 0;
globalThis.__videoState = (initial) => {
  const i = cursor++;
  if (!(i in slots)) slots[i] = initial;
  return [
    slots[i],
    (value) => {
      slots[i] = typeof value === 'function' ? value(slots[i]) : value;
    },
  ];
};
globalThis.__videoEffects = effects;
const { outputFiles } = await build({
  stdin: {
    contents:
      "export * from './app/chat-video-player'; export * from './lib/chat-video';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'video-controls',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|@\/components\/ui\/dialog)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'react'
              ? `export const useState=globalThis.__videoState; export const useRef=value=>useState({current:value})[0]; export const useEffect=effect=>globalThis.__videoEffects.push(effect);`
              : path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx, Fragment="Fragment";'
                : 'export const Dialog="Dialog", DialogContent="DialogContent", DialogTitle="DialogTitle", Expand="Expand", X="X", Download="Download", LoaderCircle="LoaderCircle", Maximize="Maximize", Minimize="Minimize", Pause="Pause", Play="Play", RotateCcw="RotateCcw", Volume2="Volume2", VolumeX="VolumeX";',
        }));
      },
    },
  ],
});
const {
  VideoPlayer,
  readVideoState,
  seekVideo,
  toggleVideoFullscreen,
  claimVideoPlayback,
  captureVideoPlayback,
  restoreVideoPosition,
} = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const timers = new Map();
let timerId = 0;
const originalTimeout = globalThis.setTimeout,
  originalClear = globalThis.clearTimeout;
globalThis.setTimeout = (callback) => {
  timers.set(++timerId, callback);
  return timerId;
};
globalThis.clearTimeout = (id) => timers.delete(id);
const doc = new EventTarget();
doc.fullscreenElement = null;
const root = {
  ownerDocument: doc,
  matches: () => false,
  querySelector: () => null,
  requestFullscreen: async () => {
    doc.fullscreenElement = root;
    doc.dispatchEvent(new Event('fullscreenchange'));
  },
};
doc.exitFullscreen = async () => {
  doc.fullscreenElement = null;
  doc.dispatchEvent(new Event('fullscreenchange'));
};
let tree,
  videoNode,
  rejectPlay = false;
const media = new EventTarget();
Object.assign(media, {
  ownerDocument: doc,
  duration: 120,
  currentTime: 0,
  paused: true,
  ended: false,
  volume: 1,
  muted: false,
  buffered: { length: 1, start: () => 0, end: () => 80 },
  play: async () => {
    if (rejectPlay) throw new Error('Blocked playback');
    media.paused = false;
    media.ended = false;
    videoNode.props.onPlay();
    videoNode.props.onPlaying();
  },
  pause: () => {
    media.paused = true;
    videoNode.props.onPause();
  },
  load: () => {
    media.error = null;
  },
});
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
const find = (type, label) =>
  nodes(tree).find(
    (node) =>
      node.type === type && (!label || node.props['aria-label'] === label),
  );
const render = () => {
  cursor = 0;
  tree = VideoPlayer({ src: '/api/media/video', name: 'clip.mp4' });
  tree.props.ref.current = root;
  videoNode = find('video');
  videoNode.props.ref.current = media;
  return tree;
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
let cleanup;
try {
  render();
  cleanup = effects[0]();
  render();
  assert.equal(
    videoNode.props.controls,
    undefined,
    'Inline controls are custom',
  );
  assert.equal(videoNode.props.playsInline, true);
  assert.equal(videoNode.props.autoPlay, undefined);
  assert.equal(find('a').props.href, '/api/media/video?download=1');
  find('button', 'Воспроизвести видео').props.onClick();
  await flush();
  render();
  assert.equal(media.paused, false);
  assert.ok(find('button', 'Приостановить видео'));
  find('input', 'Перемотка видео').props.onChange({ target: { value: '50' } });
  render();
  assert.equal(media.currentTime, 50);
  assert.equal(
    find('input', 'Перемотка видео').props['aria-valuetext'],
    '0:50 из 2:00',
  );
  assert.equal(readVideoState(media).buffered, 80);
  seekVideo(media, 500);
  assert.equal(media.currentTime, 120);
  seekVideo(media, -5);
  assert.equal(media.currentTime, 0);
  media.duration = Infinity;
  seekVideo(media, 10);
  assert.equal(media.currentTime, 0);
  assert.equal(readVideoState(media).duration, 0);
  media.duration = 120;
  media.currentTime = 20;
  videoNode.props.onTimeUpdate();
  render();
  let prevented = false;
  tree.props.onKeyDown({
    target: root,
    currentTarget: root,
    key: 'ArrowRight',
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(media.currentTime, 25);
  tree.props.onKeyDown({ target: {}, currentTarget: root, key: 'ArrowRight' });
  assert.equal(
    media.currentTime,
    25,
    'Range and button keyboard behavior is not hijacked',
  );
  render();
  find('button', 'Выключить звук видео').props.onClick();
  render();
  assert.equal(media.muted, true);
  find('button', 'Включить звук видео').props.onClick();
  render();
  assert.equal(media.muted, false);
  media.volume = 0;
  videoNode.props.onVolumeChange();
  render();
  find('button', 'Включить звук видео').props.onClick();
  render();
  assert.equal(media.volume, 1);
  assert.equal(media.muted, false);
  find('input', 'Громкость видео').props.onChange({
    target: { value: '0.35' },
  });
  assert.equal(media.volume, 0.35);
  render();
  tree.props.onPointerMove();
  [...timers.values()].at(-1)();
  render();
  assert.equal(
    tree.props['data-controls'],
    false,
    'Playing controls hide after inactivity',
  );
  tree.props.onFocusCapture();
  render();
  assert.equal(tree.props['data-controls'], true);
  find('button', 'Видео на весь экран').props.onClick();
  await flush();
  render();
  assert.equal(doc.fullscreenElement, root);
  assert.ok(find('button', 'Выйти из полного экрана'));
  find('button', 'Выйти из полного экрана').props.onClick();
  await flush();
  render();
  assert.equal(doc.fullscreenElement, null);
  let native = 0;
  await toggleVideoFullscreen(
    { ownerDocument: doc },
    { webkitEnterFullscreen: () => native++ },
  );
  await toggleVideoFullscreen(
    {
      ownerDocument: doc,
      requestFullscreen: async () => {
        throw Error('Unsupported');
      },
    },
    { webkitEnterFullscreen: () => native++ },
  );
  assert.equal(
    native,
    2,
    'iPhone native fullscreen works when element fullscreen is unavailable',
  );
  media.pause();
  render();
  rejectPlay = true;
  find('button', 'Воспроизвести видео').props.onClick();
  await flush();
  render();
  assert.ok(
    find('div') && nodes(tree).some((node) => node.props?.role === 'alert'),
  );
  rejectPlay = false;
  find('button', 'Повторить загрузку видео').props.onClick();
  await flush();
  render();
  assert.equal(media.paused, false);
  videoNode.props.onWaiting();
  render();
  assert.ok(find('span', 'Загрузка видео'));
  find('button', 'Приостановить видео').props.onClick();
  render();
  assert.equal(media.paused, true);
  media.ended = true;
  media.currentTime = 120;
  videoNode.props.onEnded();
  render();
  find('button', 'Повторить видео').props.onClick();
  await flush();
  render();
  assert.equal(media.currentTime, 0);
  media.currentTime = 42;
  media.volume = 0.35;
  media.muted = true;
  const snapshot = captureVideoPlayback(media);
  const restored = { duration: 120, currentTime: 0, volume: 1, muted: false };
  restoreVideoPosition(restored, snapshot);
  assert.deepEqual(restored, {
    duration: 120,
    currentTime: 42,
    volume: 0.35,
    muted: true,
  });
  claimVideoPlayback(media);
  claimVideoPlayback({ ownerDocument: doc, pause() {} });
  assert.equal(
    media.paused,
    true,
    'Starting another video pauses the previous one',
  );
  cleanup();
  cleanup = null;
  assert.equal(media.paused, true, 'Closing the viewer stops playback');
} finally {
  cleanup?.();
  globalThis.setTimeout = originalTimeout;
  globalThis.clearTimeout = originalClear;
  delete globalThis.__videoState;
  delete globalThis.__videoEffects;
}
console.log(
  'Chat video: play/pause/replay, seeking and bounds, buffering, mute/volume, keyboard, auto-hide, fullscreen/fallback, retries and cleanup passed.',
);
