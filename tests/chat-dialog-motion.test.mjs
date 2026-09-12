import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

// Exercise real dialog callbacks and request locks without touching a user's chats.
let active;
globalThis.__chatMotionHooks = {
  useState(initial) {
    const owner = active,
      index = owner.cursor++;
    if (!(index in owner.slots))
      owner.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [
      owner.slots[index],
      (value) => {
        owner.slots[index] =
          typeof value === 'function' ? value(owner.slots[index]) : value;
      },
    ];
  },
  useRef(initial) {
    const owner = active,
      index = owner.cursor++;
    return (owner.slots[index] ??= { current: initial });
  },
  useEffect(effect, deps) {
    const owner = active,
      index = owner.cursor++;
    const previous = owner.effects.get(index);
    if (
      !previous ||
      deps.some((value, i) => !Object.is(value, previous.deps[i]))
    )
      owner.pending.push(() => {
        previous?.cleanup?.();
        owner.effects.set(index, { deps, cleanup: effect() });
      });
  },
};
const compiled = await build({
  stdin: {
    contents:
      "export * from './app/chat-action-dialogs'; export * from './app/chat-message-files'; export * from './app/chat-pins'; export * from './app/editor-pane';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  plugins: [
    {
      name: 'dialog-surfaces',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|@\/components\/ui\/dialog|\.\/profile-identity|\.\/chat-text-editor|\.\/chat-emoji-text|\.\/chat-video-player)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'react'
              ? 'export const {useState,useRef,useEffect}=globalThis.__chatMotionHooks;'
              : path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx, Fragment="Fragment";'
                : path === 'lucide-react'
                  ? 'export const Check="Check", Forward="Forward", LoaderCircle="LoaderCircle", Search="Search", Trash2="Trash2", Download="Download", File="File", ChevronDown="ChevronDown", Pin="Pin", PinOff="PinOff";'
                  : path === './chat-text-editor'
                    ? 'export const ChatTextEditor="ChatTextEditor";'
                    : path === './chat-emoji-text'
                      ? 'export const ChatEmojiText="ChatEmojiText";'
                      : path === './chat-video-player'
                        ? 'export const ChatVideoPlayer="ChatVideoPlayer";'
                        : path === './profile-identity'
                          ? 'export const Avatar="Avatar";'
                          : 'export const Dialog="Dialog", DialogContent="DialogContent", DialogDescription="DialogDescription", DialogTitle="DialogTitle";',
        }));
      },
    },
  ],
});
const {
  ChatDeleteDialog,
  ChatEditDialog,
  ChatForwardDialog,
  ChatMessageFiles,
  ChatPins,
  EditorPane,
} = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
function mount(t, Component, props) {
  const owner = { slots: [], cursor: 0, effects: new Map(), pending: [] };
  t.after(() => {
    for (const { cleanup } of owner.effects.values()) cleanup?.();
  });
  return {
    render() {
      active = owner;
      owner.cursor = 0;
      const node = Component(props);
      owner.pending.splice(0).forEach((effect) => effect());
      return node;
    },
  };
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
const find = (tree, type, predicate = () => true) =>
  nodes(tree).find((node) => node.type === type && predicate(node.props));
const flush = () => new Promise((resolve) => setImmediate(resolve));

void test('editor panes retain form state, finish their exit and cancel hiding on rapid reversal', (t) => {
  const oldWindow = globalThis.window,
    timers = new Map();
  let serial = 0,
    reduced = false;
  globalThis.window = {
    matchMedia: () => ({ matches: reduced }),
    setTimeout: (fn) => {
      timers.set(++serial, fn);
      return serial;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  t.after(() => {
    globalThis.window = oldWindow;
  });
  const form = { type: 'form', props: { draft: 'keep' } },
    props = { active: false, children: form };
  const pane = mount(t, EditorPane, props);
  assert.equal(
    pane.render().props.children,
    false,
    'Unvisited tabs must not mount their forms or request private data',
  );
  props.active = true;
  assert.equal(pane.render().props.hidden, false);
  props.active = false;
  let tree = pane.render();
  assert.equal(tree.props.inert, true);
  assert.equal(tree.props.hidden, false);
  assert.equal(tree.props.children, form);
  props.active = true;
  tree = pane.render();
  assert.equal(timers.size, 0);
  assert.equal(tree.props.hidden, false);
  props.active = false;
  pane.render();
  const finish = [...timers.values()][0];
  finish();
  assert.equal(pane.render().props.hidden, true);
  assert.equal(pane.render().props.children, form);
  props.active = true;
  pane.render();
  reduced = true;
  props.active = false;
  pane.render();
  assert.equal(pane.render().props.hidden, true);
});
const message = {
  id: 'm1',
  sender: 'me',
  recipient: 'peer',
  created: 100,
  text: 'Исходный текст',
};
function props() {
  return {
    message,
    messages: [message],
    peer: { id: 'peer', name: 'Друг' },
    me: { id: 'me' },
    threads: [],
    onDone() {},
    onClose() {},
  };
}
function mockFetch(t, handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = previous;
  });
}

void test('cancel keeps operation dialogs mounted until their exit completes and blocks stale submit callbacks', async (t) => {
  mockFetch(t, () => assert.fail('A closing dialog must not submit'));
  for (const Component of [
    ChatDeleteDialog,
    ChatEditDialog,
    ChatForwardDialog,
  ]) {
    let closed = 0;
    const component = mount(t, Component, {
      ...props(),
      onClose: () => closed++,
    });
    let tree = component.render();
    const submit = find(tree, 'button', (props) =>
      /primary|chat-delete-confirm/.test(props.className),
    );
    find(
      tree,
      'button',
      (props) => props.className === 'secondary',
    ).props.onClick();
    tree = component.render();
    assert.equal(tree.props.open, false);
    assert.equal(closed, 0, 'Content survives until the visual exit completes');
    // Forward needs a recipient; delete/edit also retain a stale enabled handler here.
    if (Component !== ChatForwardDialog) submit.props.onClick();
    await flush();
    tree.props.onOpenChangeComplete(false);
    assert.equal(closed, 1);
  }
});

void test('successful deletion refreshes immediately, closes gracefully and cannot submit twice during exit', async (t) => {
  const calls = [];
  mockFetch(t, async (url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ ok: true });
  });
  let done = 0,
    closed = 0;
  const component = mount(t, ChatDeleteDialog, {
    ...props(),
    onDone: () => done++,
    onClose: () => closed++,
  });
  let tree = component.render();
  const submit = find(
    tree,
    'button',
    (props) => props.className === 'chat-delete-confirm',
  ).props.onClick;
  submit();
  submit();
  await flush();
  tree = component.render();
  assert.equal(calls.length, 1);
  assert.equal(done, 1);
  assert.equal(closed, 0);
  assert.equal(tree.props.open, false);
  submit();
  await flush();
  assert.equal(calls.length, 1);
  tree.props.onOpenChangeComplete(false);
  assert.equal(closed, 1);
});

void test('an uncertain edit remains open and preserves its immutable retry while animations are enabled', async (t) => {
  const calls = [];
  mockFetch(t, async (url, init) => {
    calls.push(JSON.parse(init.body));
    if (calls.length === 1) throw new TypeError('Connection lost');
    return Response.json({ ok: true });
  });
  let done = 0;
  const component = mount(t, ChatEditDialog, {
    ...props(),
    onDone: () => done++,
  });
  let tree = component.render();
  find(tree, 'ChatTextEditor').props.onChange('Правка');
  tree = component.render();
  find(
    tree,
    'button',
    (props) => props.className === 'primary',
  ).props.onClick();
  await flush();
  tree = component.render();
  tree.props.onOpenChange(false);
  tree = component.render();
  assert.equal(tree.props.open, true);
  assert.equal(find(tree, 'ChatTextEditor').props.disabled, true);
  assert.equal(
    find(tree, 'button', (props) => props.className === 'primary').props
      .disabled,
    false,
  );
  find(
    tree,
    'button',
    (props) => props.className === 'primary',
  ).props.onClick();
  await flush();
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(calls[0].text, 'Правка');
  assert.equal(done, 1);
  assert.equal(component.render().props.open, false);
});

void test('photo content remains visible through the closing transition and is released afterwards', (t) => {
  const component = mount(t, ChatMessageFiles, {
    files: [{ id: 'photo', kind: 'image', name: 'Фото.png', size: 200 }],
  });
  let tree = component.render();
  find(tree, 'button').props.onClick();
  tree = component.render();
  assert.equal(find(tree, 'Dialog').props.open, true);
  find(tree, 'Dialog').props.onOpenChange(false);
  tree = component.render();
  assert.equal(find(tree, 'Dialog').props.open, false);
  assert.equal(
    nodes(find(tree, 'DialogContent')).filter((node) => node.type === 'img')
      .length,
    1,
  );
  find(tree, 'Dialog').props.onOpenChangeComplete(false);
  tree = component.render();
  assert.equal(
    nodes(find(tree, 'DialogContent')).filter((node) => node.type === 'img')
      .length,
    0,
  );
});

void test('pin navigation waits for the dialog to exit and retains send-time ordering', (t) => {
  const jumps = [],
    messages = [
      { ...message, id: 'older', created: 50, pinnedAt: 500 },
      { ...message, id: 'newer', created: 100, pinnedAt: 200 },
    ];
  const component = mount(t, ChatPins, {
    messages,
    disabled: false,
    onPin() {},
    onJump: (id) => jumps.push(id),
  });
  let tree = component.render();
  find(
    tree,
    'button',
    (props) => props['aria-label'] === 'Все закреплённые сообщения',
  ).props.onClick();
  tree = component.render();
  const dialog = find(tree, 'Dialog');
  assert.equal(dialog.props.open, true);
  const rows = find(
    tree,
    'div',
    (props) => props.className === 'chat-pinned-list',
  );
  assert.equal(rows.props.children[0].key, 'newer');
  find(rows.props.children[1], 'button').props.onClick();
  tree = component.render();
  assert.equal(find(tree, 'Dialog').props.open, false);
  assert.equal(find(tree, 'DialogContent').props.finalFocus, false);
  assert.deepEqual(jumps, []);
  find(tree, 'Dialog').props.onOpenChangeComplete(false);
  assert.deepEqual(jumps, ['older']);
});
