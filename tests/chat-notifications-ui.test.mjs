import assert from 'node:assert/strict';
import { build } from 'esbuild';
let active;
const requests = [];
globalThis.__chatNotificationUI = {
  useState(initial) {
    const owner = active,
      index = owner.cursor++;
    if (owner.first) owner.slots[index] = initial;
    return [
      owner.slots[index],
      (value) => {
        owner.slots[index] =
          typeof value === 'function' ? value(owner.slots[index]) : value;
        owner.updates++;
      },
    ];
  },
  useRef(value) {
    const owner = active,
      index = owner.cursor++;
    if (owner.first) owner.slots[index] = { current: value };
    return owner.slots[index];
  },
  useEffect(effect) {
    active.cursor++;
    if (active.first) active.effects.push(effect);
  },
  request(url, options) {
    return new Promise((resolve, reject) =>
      requests.push({ url, options, resolve, reject }),
    );
  },
};
const { outputFiles } = await build({
  entryPoints: ['app/chat-notifications.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  plugins: [
    {
      name: 'isolated-menu',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|@\/components\/ui\/dropdown-menu|@\/lib\/chat-client)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'react'
              ? 'export const {useState,useRef,useEffect}=globalThis.__chatNotificationUI;'
              : path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx,Fragment="Fragment";'
                : path === 'lucide-react'
                  ? 'export const Bell="Bell",BellOff="BellOff";'
                  : path.includes('dropdown-menu')
                    ? 'export const DropdownMenuItem="Item";'
                    : 'export const chatRequest=globalThis.__chatNotificationUI.request;',
        }));
      },
    },
  ],
});
const { ChatNotificationsItem } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const mounts = [];
function mount(owner = 'alice', peer = 'bob', extra = {}) {
  const view = {
    slots: [],
    effects: [],
    first: true,
    cursor: 0,
    updates: 0,
    render() {
      active = view;
      view.cursor = 0;
      const node = ChatNotificationsItem({ owner, peer, ...extra });
      view.first = false;
      return node;
    },
  };
  view.render();
  view.cleanups = view.effects.map((effect) => effect());
  view.close = () => view.cleanups.splice(0).forEach((cleanup) => cleanup?.());
  mounts.push(view);
  return view;
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
const children = (view) => view.render().props.children;
const item = (view) => children(view)[0];
const label = (view) =>
  item(view)
    .props.children.filter((c) => typeof c === 'string')
    .join('');
const click = (view) => item(view).props.onClick({ preventDefault() {} });
try {
  const view = mount();
  assert.equal(requests.length, 1);
  assert.equal(item(view).props.disabled, true);
  assert.equal(requests[0].url, '/api/chat-notifications?actor=alice&peer=bob');
  requests[0].resolve({ muted: false });
  await flush();
  assert.equal(label(view), 'Выключить уведомления');
  assert.equal(
    item(view).props.closeOnClick,
    false,
    'A save result stays visible in the open menu',
  );
  click(view);
  click(view);
  assert.equal(
    requests.length,
    2,
    'Repeated clicks cannot create concurrent toggles',
  );
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    actor: 'alice',
    peer: 'bob',
    muted: true,
  });
  assert.equal(item(view).props.disabled, true);
  requests[1].resolve({ muted: true });
  await flush();
  assert.equal(label(view), 'Включить уведомления');
  click(view);
  assert.equal(JSON.parse(requests[2].options.body).muted, false);
  requests[2].reject(new Error('Попробуйте позже'));
  await flush();
  assert.equal(label(view), 'Включить уведомления');
  assert.equal(children(view)[1].props.role, 'alert');
  view.close();
  const pending = mount(),
    old = requests.at(-1),
    updates = pending.updates;
  pending.close();
  assert.equal(old.options.signal.aborted, true);
  old.resolve({ muted: true });
  await flush();
  assert.equal(pending.updates, updates, 'Closed menus ignore a stale load');
  const switched = mount('carol', 'bob');
  assert.ok(requests.at(-1).url.includes('actor=carol'));
  requests.at(-1).resolve({ muted: false });
  await flush();
  click(switched);
  const saving = requests.at(-1);
  assert.equal(JSON.parse(saving.options.body).actor, 'carol');
  switched.close();
  const savedUpdates = switched.updates;
  saving.resolve({ muted: true });
  await flush();
  assert.equal(
    switched.updates,
    savedUpdates,
    'Late saves cannot update a closed account menu',
  );
  let refreshed = 0;
  const group = mount('alice', 'room:community', {
    kind: 'room',
    onChanged: async () => {
      refreshed++;
    },
  });
  assert.equal(
    requests.at(-1).url,
    '/api/rooms?actor=alice&id=room%3Acommunity&action=notifications',
  );
  requests.at(-1).resolve({ muted: false });
  await flush();
  click(group);
  assert.equal(requests.at(-1).url, '/api/rooms');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    actor: 'alice',
    id: 'room:community',
    action: 'notifications',
    muted: true,
  });
  requests.at(-1).resolve({ muted: true });
  await flush();
  assert.equal(label(group), label(view));
  assert.equal(refreshed, 1);
  console.log(
    'Chat notification controls: load, mute/unmute, single in-flight save, error recovery, and closed/account-switched menu isolation passed.',
  );
} finally {
  for (const view of mounts) view.close();
  delete globalThis.__chatNotificationUI;
}
