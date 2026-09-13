import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Run the actual provider callbacks, with controlled SDK adapters. Never play
// media, contact a service, or write listening statistics during these tests.
const source = ts.createSourceFile(
  'music-provider.tsx',
  readFileSync('app/music-provider.tsx', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const handlers = [];
let toggle, restore, transport;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'ended')
    handlers.push(node.initializer);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'ended')
    handlers.push(node.initializer);
  if (
    ts.isCallExpression(node) &&
    node.arguments[0]?.getText(source) === 'sc.Widget.Events.FINISH'
  )
    handlers.push(node.arguments[1]);
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === 'toggleRepeatOne'
  )
    toggle = node.initializer;
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === 'useEffect' &&
    node.arguments[0]
      ?.getText(source)
      .includes("getItem('noctgram:music-repeat')")
  )
    restore = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(handlers.length, 4);
const viewSource = ts.createSourceFile(
  'music-player-view.tsx',
  readFileSync('app/music-player-view.tsx', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function findTransport(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(viewSource) === 'transport'
  )
    transport = node.initializer;
  ts.forEachChild(node, findTransport);
}
findTransport(viewSource);
const compile = (node, file = source) =>
  ts.transpileModule('globalThis.callback = ' + node.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
const run = (node, env, file = source) => {
  runInNewContext(compile(node, file), env);
  return env.callback();
};
function context() {
  const calls = [];
  const state = {
    calls,
    current: () => true,
    isCurrent: () => true,
    repeatOneRef: { current: true },
    roomRef: { current: null },
    queueRef: { current: [{ url: 'first' }, { url: 'second' }] },
    link: { url: 'first' },
    desired: { current: { kind: 'track', url: 'first' } },
    nativeOrder: { current: null },
    soundUrl: { current: 'first' },
    nativeIndex: 3,
    nativeLength: 5,
    adjacentPlayable: () => ({ url: 'second' }),
    play: (track) => calls.push(['next', track.url]),
    engine: {
      repeat: () => calls.push(['repeat']),
      seek: (n) => calls.push(['seek', n]),
      resume: () => calls.push(['resume']),
    },
    w: {
      skip: (n) => calls.push(['skip', n]),
      seekTo: (n) => calls.push(['seek', n]),
      play: () => calls.push(['resume']),
      pause: () => calls.push(['pause']),
    },
    element: { currentTime: 120 },
    attemptPlay: () => calls.push(['resume']),
    monitor: { playing() {} },
    tracker: { current: { resetPosition() {} } },
    setPlaying() {},
  };
  return state;
}
for (const [i, name] of [
  'Spotify',
  'SoundCloud widget',
  'native audio',
  'YouTube',
].entries()) {
  void test(
    name + ': repeat wins over the queue and uses the current preference',
    () => {
      const env = context();
      run(handlers[i], env);
      assert.ok(
        env.calls.some(([kind]) => kind === 'repeat' || kind === 'resume'),
      );
      assert.equal(
        env.calls.some(([kind]) => kind === 'next'),
        false,
      );
      if (i === 2) assert.equal(env.element.currentTime, 0);
      env.calls.length = 0;
      env.repeatOneRef.current = false;
      run(handlers[i], env);
      assert.deepEqual(env.calls, [['next', 'second']]);
      env.calls.length = 0;
      env.adjacentPlayable = () => undefined;
      run(handlers[i], env);
      assert.equal(
        env.calls.some(([kind]) => ['repeat', 'resume', 'next'].includes(kind)),
        false,
        'Repeat off must not silently repeat a single song',
      );
      env.repeatOneRef.current = true;
      env.calls.length = 0;
      env.roomRef.current = {
        detail: {},
        command: (command) => env.calls.push(['room', command]),
      };
      run(handlers[i], env);
      assert.deepEqual(
        env.calls,
        [['room', 'advance']],
        'Personal repeat cannot desynchronize a shared room',
      );
      env.calls.length = 0;
      env.current = () => false;
      env.isCurrent = () => false;
      run(handlers[i], env);
      assert.deepEqual(env.calls, [], 'Old engine events have no effect');
    },
  );
}
void test('widget repeats the selected playlist entry, including reordered playlists', () => {
  const env = context();
  env.desired.current.kind = 'playlist';
  run(handlers[1], env);
  assert.deepEqual(env.calls, [['skip', 3], ['seek', 0], ['resume']]);
  env.calls.length = 0;
  env.nativeOrder.current = [{ url: 'second' }, { url: 'first' }];
  run(handlers[1], env);
  assert.deepEqual(env.calls, [['skip', 3], ['seek', 0], ['resume']]);
  env.calls.length = 0;
  env.repeatOneRef.current = false;
  env.nativeOrder.current = null;
  env.nativeLength = 1;
  env.nativeIndex = 0;
  run(handlers[1], env);
  assert.deepEqual(env.calls, [['pause']]);
});
void test('repeat control is shared, persists, and works when storage is unavailable', () => {
  const saved = new Map();
  const env = {
    roomRef: { current: null },
    repeatOneRef: { current: false },
    setRepeatOne: (value) => {
      env.state = value;
    },
    localStorage: {
      setItem: (k, v) => saved.set(k, v),
      getItem: (k) => saved.get(k),
    },
  };
  run(toggle, env);
  assert.equal(env.state, true);
  assert.equal(env.repeatOneRef.current, true);
  assert.equal(saved.get('noctgram:music-repeat'), 'one');
  env.repeatOneRef.current = false;
  run(restore, env);
  assert.equal(env.state, true);
  run(toggle, env);
  assert.equal(env.state, false);
  assert.equal(saved.get('noctgram:music-repeat'), 'off');
  env.localStorage.setItem = () => {
    throw new Error('Storage blocked');
  };
  run(toggle, env);
  assert.equal(env.state, true);
  const sharedCommands = [];
  env.roomRef.current = {
    detail: { playback: { repeatOne: 0 } },
    command: (command, extra) => sharedCommands.push([command, extra.enabled]),
  };
  run(toggle, env);
  assert.deepEqual(sharedCommands, [['repeat', true]]);
  env.roomRef.current.detail.playback.repeatOne = 1;
  run(toggle, env);
  assert.deepEqual(sharedCommands, [
    ['repeat', true],
    ['repeat', false],
  ]);
  assert.equal(env.state, true);
  assert.equal(
    env.repeatOneRef.current,
    true,
    'Shared repeat must not overwrite the personal preference',
  );
  let clicked = 0;
  const ui = {
    p: {
      repeatOne: true,
      onRepeat: () => {
        clicked++;
      },
    },
    React: {
      createElement: (type, props, ...children) => ({
        type,
        props: props || {},
        children,
      }),
    },
  };
  for (const name of [
    'SkipBack',
    'SkipForward',
    'LoaderCircle',
    'Pause',
    'Play',
    'Repeat',
    'Repeat1',
  ])
    ui[name] = name;
  const tree = run(transport, ui, viewSource);
  const button = tree.children.find(
    (n) => n.props?.className === 'icon-button music-repeat',
  );
  assert.equal(button.type, 'button');
  assert.equal(button.props['aria-pressed'], true);
  assert.ok(
    !button.props.disabled,
    'Repeat remains available in a shared player',
  );
  assert.equal(button.children[0].type, 'Repeat1');
  button.props.onClick();
  assert.equal(clicked, 1);
  ui.p.repeatOne = false;
  ui.p.repeatDisabled = true;
  const disabled = run(transport, ui, viewSource).children.find(
    (n) => n.props?.className === 'icon-button music-repeat',
  );
  assert.equal(disabled.props.disabled, true);
  assert.equal(disabled.props['aria-pressed'], false);
});
