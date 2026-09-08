import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents:
      "export {MusicFavorite} from './app/music-favorite'; export {MusicReorderList} from './app/music-reorder-list';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  plugins: [
    {
      name: 'controlled-hooks',
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|@\/components\/ui\/dialog)$/,
          },
          (a) => ({ path: a.path, namespace: 'fixture' }),
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
          contents:
            a.path === 'react'
              ? 'export const {useState,useRef,useEffect,useLayoutEffect} = globalThis.__musicUiHooks;'
              : a.path === 'react/jsx-runtime'
                ? 'export const Fragment="Fragment"; export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;'
                : a.path === 'lucide-react'
                  ? 'export const GripVertical="GripVertical",Check="Check",Heart="Heart",ListMusic="ListMusic",LoaderCircle="LoaderCircle";'
                  : 'export const Dialog="Dialog",DialogContent="DialogContent",DialogDescription="DialogDescription",DialogTitle="DialogTitle";',
        }));
      },
    },
  ],
});
let context;
globalThis.__musicUiHooks = {
  useState(value) {
    const c = context,
      i = c.cursor++;
    if (!(i in c.slots))
      c.slots[i] = typeof value === 'function' ? value() : value;
    return [
      c.slots[i],
      (next) => {
        c.slots[i] = typeof next === 'function' ? next(c.slots[i]) : next;
        c.dirty = true;
      },
    ];
  },
  useRef(value) {
    const c = context,
      i = c.cursor++;
    return (c.slots[i] ??= { current: value });
  },
  useEffect(fn, deps) {
    effect(fn, deps);
  },
  useLayoutEffect(fn, deps) {
    effect(fn, deps);
  },
};
function effect(fn, deps) {
  const c = context,
    i = c.cursor++,
    previous = c.effects[i];
  if (!previous || deps.some((d, n) => !Object.is(d, previous.deps[n])))
    c.pending.push(() => {
      previous?.cleanup?.();
      c.effects[i] = { deps, cleanup: fn() };
    });
}
const { MusicFavorite, MusicReorderList } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((n) => nodes(n, predicate));
  return [
    ...(predicate(tree) ? [tree] : []),
    ...nodes(tree.props?.children, predicate),
  ];
}
const byType = (tree, type) => nodes(tree, (n) => n.type === type);
function harness(Component, props, setup) {
  const c = {
    slots: [],
    effects: [],
    pending: [],
    cursor: 0,
    dirty: true,
    props,
    tree: null,
  };
  c.render = () => {
    context = c;
    c.cursor = 0;
    c.dirty = false;
    c.tree = Component(c.props);
    setup?.(c.tree);
    for (const fn of c.pending.splice(0)) fn();
    return c.tree;
  };
  c.flush = async () => {
    for (let n = 0; n < 12; n++) {
      if (c.dirty) c.render();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return c.tree;
  };
  c.dispose = () => {
    if (c.disposed) return;
    c.disposed = true;
    for (const effect of c.effects) effect?.cleanup?.();
  };
  c.render();
  return c;
}
function environment(t) {
  const saved = new Map(
    ['window', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
    ),
  );
  const frames = new Map();
  let frame = 0;
  globalThis.window = Object.assign(new EventTarget(), {
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout,
  });
  globalThis.requestAnimationFrame = (fn) => {
    frames.set(++frame, fn);
    return frame;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  t.after(() => {
    context?.dispose();
    for (const [key, value] of saved)
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
  });
  return {
    frame() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn());
    },
    event(type, values = {}) {
      window.dispatchEvent(
        Object.assign(new Event(type, { cancelable: true }), values),
      );
    },
  };
}
test('heart: one playlist saves directly; duplicate clicks lock; several choices close only after acknowledgement and keep the selected song', async (t) => {
  environment(t);
  let lists = [{ id: 'one', name: 'Ночь', trackCount: 0, savedTrackId: null }];
  const calls = [];
  let release;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    if (!body) return Response.json({ playlists: lists });
    calls.push(body);
    if (release) await release.promise;
    if (body.action === 'add')
      lists = lists.map((p) =>
        p.id === body.id ? { ...p, savedTrackId: 'song-id' } : p,
      );
    if (body.action === 'remove')
      lists = lists.map((p) =>
        p.id === body.id ? { ...p, savedTrackId: null } : p,
      );
    return Response.json({ id: body.id });
  };
  const c = harness(MusicFavorite, {
    track: { url: 'https://soundcloud.com/test/first', title: 'Первая' },
  });
  await c.flush();
  const heart = () =>
    byType(c.tree, 'button').find((n) =>
      n.props.className.includes('music-favorite-button'),
    );
  await heart().props.onClick();
  await c.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'add');
  assert.equal(byType(c.tree, 'Dialog')[0].props.open, false);
  assert.equal(heart().props['aria-pressed'], true);
  await heart().props.onClick();
  await c.flush();
  assert.equal(calls[1].action, 'remove');
  lists.push({ id: 'two', name: 'Утро', trackCount: 0, savedTrackId: null });
  heart().props.onClick();
  heart().props.onClick();
  await c.flush();
  assert.equal(
    calls.length,
    2,
    'Choosing a playlist does not save before selection',
  );
  assert.equal(byType(c.tree, 'Dialog')[0].props.open, true);
  c.props = {
    track: { url: 'https://soundcloud.com/test/second', title: 'Вторая' },
  };
  c.dirty = true;
  await c.flush();
  release = {};
  release.promise = new Promise((resolve) => (release.resolve = resolve));
  const choice = byType(c.tree, 'button').find(
    (n) => n.props['aria-label'] === 'Добавить в «Утро»',
  );
  choice.props.onClick();
  choice.props.onClick();
  await c.flush();
  assert.equal(calls.length, 3);
  assert.equal(
    calls[2].url,
    'https://soundcloud.com/test/first',
    'Auto-advance does not change the chooser target',
  );
  assert.equal(
    byType(c.tree, 'Dialog')[0].props.open,
    true,
    'Pending writes keep the chooser open',
  );
  release.resolve();
  await c.flush();
  assert.equal(byType(c.tree, 'Dialog')[0].props.open, false);
  assert.ok(
    byType(c.tree, 'DialogContent').length,
    'Exit animation retains the dialog content',
  );
});
test('heart: no playlists creates favorites, while a failed save leaves the choice available', async (t) => {
  environment(t);
  let lists = [],
    fail = false;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    if (!options.body) return Response.json({ playlists: lists });
    const body = JSON.parse(options.body);
    calls.push(body);
    if (fail)
      return Response.json({ error: 'Нет соединения' }, { status: 503 });
    if (body.action === 'create') return Response.json({ id: 'created' });
    return Response.json({ id: body.id });
  };
  const c = harness(MusicFavorite, {
    track: { url: 'https://soundcloud.com/test/first', title: 'Первая' },
  });
  await c.flush();
  byType(c.tree, 'button')[0].props.onClick();
  await c.flush();
  assert.deepEqual(
    calls.map((c) => c.action),
    ['create', 'add'],
  );
  assert.equal(calls[0].name, 'Любимые песни');
  assert.equal(calls[1].id, 'created');
  lists = [
    { id: 'one', name: 'Один', trackCount: 0 },
    { id: 'two', name: 'Два', trackCount: 0 },
  ];
  byType(c.tree, 'button')[0].props.onClick();
  await c.flush();
  fail = true;
  byType(c.tree, 'button')
    .find((n) => n.props.className === 'music-favorite-choice')
    .props.onClick();
  await c.flush();
  assert.equal(byType(c.tree, 'Dialog')[0].props.open, true);
  assert.equal(
    nodes(c.tree, (n) => n.props?.role === 'alert')[0].props.children,
    'Нет соединения',
  );
});
test('drag: fifth to third, keyboard reorder, autoscroll and Escape cancellation never start playback', async (t) => {
  const env = environment(t);
  const calls = [];
  let animations = 0,
    c,
    treeSnapshot;
  let rowIds = ['1', '2', '3', '4', '5'];
  const makeRows = () =>
    rowIds.map((id) => ({
      id,
      label: id,
      content: { type: 'button', props: { onClick: () => calls.push('play') } },
    }));
  const list = {
    scrollTop: 0,
    closest: () => null,
    getBoundingClientRect: () => ({ top: 0, bottom: 300 }),
    querySelectorAll: () =>
      nodes(treeSnapshot, (n) => !!n.props?.['data-music-row']).map(
        (node, index) => ({
          dataset: { musicRow: node.props['data-music-row'] },
          offsetTop: index * 60,
          offsetHeight: 60,
          getAnimations: () => [],
          animate: () => {
            animations++;
          },
        }),
      ),
  };
  c = harness(
    MusicReorderList,
    {
      className: 'queue',
      rows: makeRows(),
      onMove: (from, to) => {
        calls.push([from, to]);
        const fromIndex = rowIds.indexOf(from),
          toIndex = rowIds.indexOf(to);
        rowIds.splice(fromIndex, 1);
        rowIds.splice(toIndex, 0, from);
        c.props.rows = makeRows();
        c.dirty = true;
      },
    },
    (tree) => {
      treeSnapshot = tree;
      tree.props.ref.current = list;
    },
  );
  await c.flush();
  const handle = (id) =>
    byType(c.tree, 'button').find(
      (n) => n.props['aria-label'] === 'Переместить ' + id,
    );
  handle('5').props.onPointerDown({
    button: 0,
    pointerId: 1,
    clientY: 270,
    preventDefault() {},
  });
  env.event('pointermove', { pointerId: 1, clientY: 149 });
  env.frame();
  await c.flush();
  env.event('pointerup', { pointerId: 1 });
  await c.flush();
  assert.deepEqual(rowIds, ['1', '2', '5', '3', '4']);
  assert.deepEqual(calls, [['5', '3']]);
  assert.ok(animations > 0);
  handle('5').props.onKeyDown({
    key: 'ArrowUp',
    preventDefault() {},
    stopPropagation() {},
  });
  await c.flush();
  assert.deepEqual(rowIds, ['1', '5', '2', '3', '4']);
  const before = calls.length;
  handle('1').props.onPointerDown({
    button: 0,
    pointerId: 2,
    clientY: 30,
    preventDefault() {},
  });
  env.event('pointermove', { pointerId: 2, clientY: 350 });
  env.frame();
  await c.flush();
  assert.ok(list.scrollTop > 0);
  env.event('keydown', { key: 'Escape' });
  await c.flush();
  env.event('pointerup', { pointerId: 2 });
  await c.flush();
  assert.equal(calls.length, before);
  assert.deepEqual(rowIds, ['1', '5', '2', '3', '4']);
});
