import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Execute the actual component's reply callbacks with synthetic history and refs.
// No browser, signed-in session, live messages, or network is involved.
let active;
const requests = [],
  jumps = [],
  mounts = [];
const hooks = {
  useState(initial) {
    const owner = active,
      i = owner.cursor++;
    if (!(i in owner.slots))
      owner.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [
      owner.slots[i],
      (value) => {
        owner.slots[i] =
          typeof value === 'function' ? value(owner.slots[i]) : value;
        owner.updates++;
      },
    ];
  },
  useRef(initial) {
    const owner = active,
      i = owner.cursor++;
    return (owner.slots[i] ??= { current: initial });
  },
  useCallback(fn) {
    active.cursor++;
    return fn;
  },
  useEffect(effect, deps) {
    const owner = active,
      i = owner.cursor++,
      previous = owner.effects.get(i);
    if (
      !previous ||
      deps.some((value, index) => !Object.is(value, previous.deps[index]))
    ) {
      owner.pending.push(() => {
        previous?.cleanup?.();
        owner.effects.set(i, { deps, cleanup: effect() });
      });
    }
  },
};
hooks.useLayoutEffect = (...args) => hooks.useEffect(...args);
globalThis.__roomNavigation = {
  ...hooks,
  roomRequest(query, signal) {
    return new Promise((resolve, reject) =>
      requests.push({ query, signal, resolve, reject }),
    );
  },
  roomAction: async () => ({ ok: true }),
  createChatNavigator(list, interrupt) {
    const nav = {
      scrolling: false,
      jump(target) {
        if (!list.contains(target)) return false;
        jumps.push(target.id);
        return true;
      },
      bottom() {},
      cancel() {},
      dispose() {
        nav.disposed = true;
      },
      interrupt,
    };
    list.navigator = nav;
    return nav;
  },
};
const globals = new Map();
for (const [name, value] of Object.entries({
  document: { hidden: true, getElementById: (id) => active.elements.get(id) },
  window: { addEventListener() {}, removeEventListener() {} },
  setInterval: () => 1,
  clearInterval() {},
})) {
  globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
const names = {
  'lucide-react':
    'ArrowLeft Check ChevronDown KeyRound LoaderCircle LockKeyhole MoreHorizontal Reply Send Settings ShieldCheck Trash2 Users X',
  '@/components/ui/dialog':
    'Dialog DialogContent DialogDescription DialogTitle',
  '@/components/ui/dropdown-menu':
    'DropdownMenu DropdownMenuContent DropdownMenuItem DropdownMenuTrigger',
  './premium-emoji': 'EmojiPicker EmojiPreview',
  './profile-link': 'MentionText',
  './giveaway-card': 'GiveawayCard',
  './giveaway-create': 'GiveawayCreateButton',
  './room-list': 'RoomAvatar',
  './room-management': 'RoomManagement',
  './post-card': 'Avatar',
  './chat-notifications': 'ChatNotificationsItem',
  './chat-reveal': 'ChatReveal',
  '@/lib/secret-crypto': 'decryptText encryptText ensureKey prepareSession',
};
const { outputFiles } = await build({
  entryPoints: ['app/room-conversation.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  plugins: [
    {
      name: 'room-ui-fixture',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          args.kind === 'entry-point'
            ? undefined
            : { path: args.path, namespace: 'fixture' },
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'react'
              ? 'export const {useState,useRef,useEffect,useLayoutEffect,useCallback}=globalThis.__roomNavigation;'
              : path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx,Fragment="Fragment";'
                : path === '@/lib/rooms-client'
                  ? 'export const {roomRequest,roomAction}=globalThis.__roomNavigation;'
                  : path === '@/lib/chat-navigation'
                    ? 'export const {createChatNavigator}=globalThis.__roomNavigation;'
                    : (names[path] || '')
                        .split(' ')
                        .filter(Boolean)
                        .map(
                          (name) =>
                            `export const ${name}=${JSON.stringify(name)};`,
                        )
                        .join('\n'),
        }));
      },
    },
  ],
});
const { RoomConversation } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const walk = (node) =>
  !node || typeof node !== 'object'
    ? []
    : Array.isArray(node)
      ? node.flatMap(walk)
      : [node, ...walk(node.props?.children)];
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const msg = (id, replyTo = null) => ({
  id,
  roomId: 'group',
  sender: 'bob',
  senderName: 'Bob',
  senderAvatar: '',
  text: id,
  created: Number(id.replace(/\D/g, '')) || 1,
  replyTo,
  replyText: 'old message',
  deletedAt: 0,
});
const detail = (messages) => ({
  id: 'group',
  me: 'alice',
  name: 'Group',
  kind: 'group',
  role: 'member',
  members: [],
  messages,
  canSend: true,
  nextCursor: null,
});
function mount() {
  const view = {
    slots: [],
    effects: new Map(),
    pending: [],
    elements: new Map(),
    cursor: 0,
    updates: 0,
    list: { contains: (target) => view.elements.get(target.id) === target },
    render() {
      active = view;
      view.cursor = 0;
      view.tree = RoomConversation({
        target: { roomId: 'group' },
        me: { id: 'alice' },
        disabled: false,
        onOpen() {},
        onBack() {},
        onProfile() {},
        onRoomsChanged: async () => {},
      });
      view.elements.clear();
      for (const node of walk(view.tree)) {
        if (node.props?.id)
          view.elements.set(node.props.id, { id: node.props.id });
        if (node.props?.className === 'room-message-list')
          node.props.ref.current = view.list;
      }
      view.pending.splice(0).forEach((effect) => effect());
      return view.tree;
    },
    close() {
      for (const effect of view.effects.values()) effect.cleanup?.();
      view.effects.clear();
    },
  };
  mounts.push(view);
  view.render();
  return view;
}
const quote = (view) =>
  walk(view.render()).find((node) => node.props?.className === 'room-quote');
try {
  const view = mount();
  requests
    .at(-1)
    .resolve(detail([msg('message100'), msg('message101', 'message100')]));
  await flush();
  assert.equal(quote(view).type, 'button');
  quote(view).props.onClick();
  assert.equal(jumps.at(-1), 'room-message-message100');
  assert.equal(requests.length, 1, 'A loaded reply needs no fetch');
  view.close();

  const older = mount();
  requests.at(-1).resolve(detail([msg('message200', 'message5')]));
  await flush();
  quote(older).props.onClick();
  assert.equal(requests.at(-1).query.around, 'message5');
  assert.equal(requests.at(-1).query.before, undefined);
  requests.at(-1).resolve({
    ...detail([msg('message4'), msg('message5'), msg('message6')]),
    pageCursor: 'anchor',
  });
  await flush();
  older.render();
  assert.equal(jumps.at(-1), 'room-message-message5');
  assert.ok(older.elements.has('room-message-message5'));
  older.close();

  const interrupted = mount();
  requests.at(-1).resolve(detail([msg('message200', 'message5')]));
  await flush();
  quote(interrupted).props.onClick();
  const delayed = requests.at(-1);
  interrupted.list.navigator.interrupt();
  delayed.resolve(detail([msg('message5')]));
  await flush();
  interrupted.render();
  assert.ok(
    interrupted.elements.has('room-message-message200'),
    'User scrolling cancels a pending history jump',
  );
  quote(interrupted).props.onClick();
  requests
    .at(-1)
    .reject(Object.assign(new Error('Unavailable'), { status: 404 }));
  await flush();
  interrupted.render();
  assert.ok(
    interrupted.elements.has('room-message-message200'),
    'A missing reply must not close the whole conversation',
  );
  quote(interrupted).props.onClick();
  const stale = requests.at(-1);
  interrupted.close();
  const updates = interrupted.updates;
  stale.resolve(detail([msg('message5')]));
  await flush();
  assert.equal(
    interrupted.updates,
    updates,
    'A closed chat ignores late responses',
  );

  const deleted = mount();
  requests
    .at(-1)
    .resolve(
      detail([{ ...msg('message200', 'message5'), replyUnavailable: true }]),
    );
  await flush();
  assert.equal(quote(deleted).props.disabled, true);
  console.log(
    'Room replies: loaded/older targets, interrupt, deleted targets, and closed-chat isolation passed.',
  );
} finally {
  mounts.forEach((view) => view.close());
  delete globalThis.__roomNavigation;
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
