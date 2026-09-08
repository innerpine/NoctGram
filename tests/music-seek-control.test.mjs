import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the real control's callbacks and state with ongoing engine samples.
// Base UI owns pointer/keyboard input; this harness supplies its public callbacks.
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', {
  value: new EventTarget(),
  configurable: true,
  writable: true,
});
let slots = [],
  effects = [],
  cursor = 0,
  mounting = true;
globalThis.__seekHooks = {
  useState(value) {
    const index = cursor++;
    if (mounting) slots[index] = value;
    return [
      slots[index],
      (value) => {
        slots[index] = value;
      },
    ];
  },
  useRef(value) {
    const index = cursor++;
    if (mounting) slots[index] = { current: value };
    return slots[index];
  },
  useEffect(effect) {
    cursor++;
    if (mounting) effects.push(effect);
  },
};
const { outputFiles } = await build({
  entryPoints: ['app/music-seek-control.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  plugins: [
    {
      name: 'seek-events',
      setup(build) {
        build.onResolve(
          { filter: /^(react(?:\/jsx-runtime)?|@\/components\/ui\/slider)$/ },
          ({ path }) => ({ path, namespace: 'test' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
          contents:
            path === 'react'
              ? 'export const {useState, useRef, useEffect} = globalThis.__seekHooks;'
              : path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;'
                : 'export const Slider="Slider";',
        }));
      },
    },
  ],
});
const { MusicSeekControl } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const seeks = [];
let props = {
  position: 10000,
  duration: 120000,
  disabled: false,
  label: 'Seek',
  onSeek: (ms) => seeks.push(ms),
};
function render() {
  cursor = 0;
  const node = MusicSeekControl(props);
  mounting = false;
  return node.props.children[1].props;
}
let dispose = [];
try {
  let slider = render();
  dispose = effects.map((effect) => effect());
  slider.onPointerDownCapture();
  for (let ms = 20000; ms <= 70000; ms += 1000) {
    slider.onValueChange([ms], { reason: 'drag' });
    props.position += 200; // Background audio updates while pointer stays down.
    slider = render();
    assert.deepEqual(
      slider.value,
      [ms],
      'Audio progress must not override the thumb',
    );
  }
  assert.deepEqual(seeks, [], 'Dragging sends no playback or network commands');
  slider.onValueCommitted([70000]);
  window.dispatchEvent(new Event('pointerup'));
  assert.deepEqual(
    seeks,
    [70000],
    'Release commits exactly the final position',
  );
  props.position = 70000;
  assert.deepEqual(render().value, [70000]);
  props.position = 71250;
  assert.deepEqual(
    render().value,
    [71250],
    'Normal playback tracking resumes after release',
  );

  slider.onKeyDownCapture();
  slider.onValueChange([72000], { reason: 'keyboard' });
  slider.onValueCommitted([72000]);
  assert.equal(seeks.at(-1), 72000, 'Keyboard seeking commits too');

  slider.onPointerDownCapture();
  slider.onValueChange([110000], { reason: 'drag' });
  window.dispatchEvent(new Event('pointercancel'));
  slider.onValueCommitted([110000]);
  assert.deepEqual(
    seeks,
    [70000, 72000],
    'A cancelled gesture cannot seek later',
  );
  assert.deepEqual(render().value, [71250]);

  slider.onTouchStartCapture();
  slider.onValueChange([32000], { reason: 'drag' });
  slider.onValueCommitted([32000]);
  window.dispatchEvent(new Event('touchend'));
  assert.equal(seeks.at(-1), 32000);

  slider.onPointerDownCapture();
  slider.onValueChange([110000], { reason: 'drag' });
  window.dispatchEvent(new Event('blur'));
  assert.deepEqual(
    render().value,
    [71250],
    'Leaving the window clears the preview',
  );

  props.disabled = true;
  slider = render();
  slider.onKeyDownCapture();
  slider.onValueCommitted([100000]);
  assert.deepEqual(
    seeks,
    [70000, 72000, 32000],
    'Unready/error controls never seek',
  );

  // Each player surface keys the control by track URL. Remounting for a changed
  // song discards the old drag; no commit carries over into the next song.
  for (const cleanup of dispose) cleanup?.();
  slots = [];
  effects = [];
  mounting = true;
  props = { ...props, disabled: false, position: 0 };
  assert.deepEqual(render().value, [0]);
  dispose = effects.map((effect) => effect());
  console.log(
    'Seek control: live samples during drag, single commit, keyboard/touch, cancellation and track reset passed.',
  );
} finally {
  for (const cleanup of dispose) cleanup?.();
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
  else delete globalThis.window;
  delete globalThis.__seekHooks;
}
