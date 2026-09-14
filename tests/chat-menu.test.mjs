import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents:
      "export * from './app/chat-message-menu'; export * from './app/room-message-menu'; export * from './app/message-reactions';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  plugins: [
    {
      name: 'menu-surfaces',
      setup(build) {
        build.onResolve({ filter: /^\.\/chat-emoji-text$/ }, ({ path }) => ({
          path,
          namespace: 'emoji',
        }));
        build.onLoad({ filter: /.*/, namespace: 'emoji' }, () => ({
          contents: 'export const ChatEmojiText="ChatEmojiText";',
        }));
        build.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|@\/components\/ui\/(context-menu|dropdown-menu))$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'react'
              ? 'export const useRef=(current)=>({current}); export const useState=(initial)=>[typeof initial === "function" ? initial() : initial,()=>{}]; export const useLayoutEffect=(setup)=>{setup();};'
              : path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx, Fragment="Fragment";'
                : path === 'lucide-react'
                  ? 'export const CheckSquare="CheckSquare", Copy="Copy", Ellipsis="Ellipsis", MoreHorizontal="MoreHorizontal", Flag="Flag", Forward="Forward", Pencil="Pencil", Pin="Pin", PinOff="PinOff", Reply="Reply", Trash2="Trash2";'
                  : path.endsWith('/context-menu')
                    ? 'export const ContextMenu="ContextMenu", ContextMenuTrigger="ContextMenuTrigger", ContextMenuContent="ContextMenuContent", ContextMenuItem="ContextMenuItem", ContextMenuGroup="ContextMenuGroup", ContextMenuSeparator="ContextMenuSeparator";'
                    : 'export const DropdownMenu="DropdownMenu", DropdownMenuTrigger="DropdownMenuTrigger", DropdownMenuContent="DropdownMenuContent", DropdownMenuItem="DropdownMenuItem", DropdownMenuSeparator="DropdownMenuSeparator";',
        }));
      },
    },
  ],
});
const {
  ChatMessageContext,
  RoomMessageContext,
  MessageReactions,
  preserveContextTarget,
  chatHistoryContextMenu,
} = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (typeof node.type === 'function') return nodes(node.type(node.props));
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
const actions = [];
const props = {
  message: {
    id: 'm1',
    text: 'Текст',
    sender: 'alice',
    recipient: 'bob',
    created: 100,
    read: 0,
  },
  own: true,
  disabled: false,
  canSend: true,
  selected: false,
  onAction: (kind, message) => actions.push([kind, message.id]),
};
const menu = ChatMessageContext({
  ...props,
  selecting: false,
  children: { type: 'div', props: {} },
});
const items = nodes(menu).filter((node) => node.type === 'ContextMenuItem');
for (const kind of [
  'reply',
  'pin',
  'forward',
  'copy',
  'edit',
  'select',
  'delete',
]) {
  const item = items.find((node) => {
    const label = [node.props.children]
      .flat()
      .filter((v) => typeof v === 'string')
      .join('');
    return (
      label ===
      {
        reply: 'Ответить',
        pin: 'Закрепить',
        forward: 'Переслать',
        copy: 'Копировать текст',
        edit: 'Изменить',
        select: 'Выделить',
        delete: 'Удалить',
      }[kind]
    );
  });
  assert.ok(item, kind + ' is available');
  item.props.onClick();
  assert.deepEqual(actions.at(-1), [kind, 'm1']);
}
const incoming = nodes(
  ChatMessageContext({ ...props, own: false, selecting: false }),
).filter((node) => node.type === 'ContextMenuItem');
assert.equal(
  incoming.some((node) => node.props.children.includes('Изменить')),
  false,
);
assert.equal(
  incoming.some((node) => node.props.children.includes('Пожаловаться')),
  true,
);
const readonly = nodes(
  ChatMessageContext({ ...props, disabled: true, selecting: false }),
).filter((node) => node.type === 'ContextMenuItem');
assert.ok(
  readonly.find((node) => node.props.children.includes('Удалить')).props
    .disabled,
);
assert.equal(
  readonly.find((node) => node.props.children.includes('Копировать текст'))
    .props.disabled,
  undefined,
);

const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'Element');
class TestElement {
  constructor(exempt = false, contained = true, content = false) {
    this.exempt = exempt;
    this.contained = contained;
    this.content = content;
  }
  closest(selector) {
    if (this.content && selector.includes('.bubble')) return this;
    return this.exempt && selector.includes('video') ? this : null;
  }
}
Object.defineProperty(globalThis, 'Element', {
  configurable: true,
  value: TestElement,
});
try {
  const root = {
    contains: (target) => !!target?.contained,
    ownerDocument: { getSelection: () => null },
  };
  const trigger = nodes(menu).find(
    (node) => node.type === 'ContextMenuTrigger',
  );
  let bypassed = 0,
    nativePrevented = 0,
    stopped = 0;
  const event = (target) => ({
    target,
    currentTarget: root,
    button: 0,
    clientX: 40,
    clientY: 40,
    detail: 1,
    preventBaseUIHandler: () => bypassed++,
    preventDefault: () => nativePrevented++,
    stopPropagation: () => stopped++,
  });
  trigger.props.onContextMenu(event(new TestElement()));
  assert.equal(
    bypassed,
    0,
    'Ordinary message right click reaches the context menu library',
  );
  trigger.props.onContextMenu(event(new TestElement(true)));
  assert.equal(
    bypassed,
    1,
    'Video/audio/embedded music controls retain their own context handling',
  );
  trigger.props.onContextMenu(event(new TestElement(false, false)));
  assert.equal(
    bypassed,
    2,
    'Portalled photo/gift dialogs cannot trigger the chat menu through React ancestry',
  );
  trigger.props.onTouchStart(event(new TestElement(true)));
  assert.equal(bypassed, 3, 'Long press also preserves player controls');
  assert.equal(
    nativePrevented,
    0,
    'Bypassing the chat handler never prevents native or player events',
  );
  assert.equal(
    stopped,
    1,
    'Native media events cannot reach the library’s blanket document listener',
  );
  chatHistoryContextMenu(event(new TestElement()));
  assert.equal(
    nativePrevented,
    1,
    'History gutters cannot open the browser menu',
  );
  chatHistoryContextMenu(event(new TestElement(true)));
  chatHistoryContextMenu(event(new TestElement(false, false)));
  assert.equal(
    nativePrevented,
    1,
    'Players and portals remain untouched by the history guard',
  );
  assert.equal(preserveContextTarget(null, root), true);
  const doubleClick = (surface, target, extra = {}) => {
    surface.props.onClickCapture({ ...event(target), ...extra });
    surface.props.onDoubleClick({ ...event(target), detail: 2, ...extra });
  };
  const beforeReply = actions.length;
  trigger.props.onClickCapture(event(new TestElement()));
  assert.equal(
    actions.length,
    beforeReply,
    'A single gutter click does not reply',
  );
  doubleClick(trigger, new TestElement());
  assert.deepEqual(
    actions.at(-1),
    ['reply', 'm1'],
    'Double click replies to the message owning the gutter',
  );
  const beforeBubble = actions.length;
  doubleClick(trigger, new TestElement(false, true, true));
  assert.equal(actions.length, beforeBubble + 1);
  assert.deepEqual(
    actions.at(-1),
    ['reply', 'm1'],
    'Double click on message text also starts a reply',
  );
  const replied = actions.length;
  for (const target of [new TestElement(true), new TestElement(false, false)])
    doubleClick(trigger, target);
  for (const key of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'])
    doubleClick(trigger, new TestElement(), { [key]: true });
  assert.equal(
    actions.length,
    replied,
    'Portals, media and modified clicks keep their existing behaviour',
  );
  for (const restrictions of [
    { disabled: true },
    { canSend: false },
    { unconfirmed: true },
    { removing: true },
  ]) {
    const locked = nodes(
      ChatMessageContext({ ...props, selecting: false, ...restrictions }),
    ).find((node) => node.type === 'ContextMenuTrigger');
    doubleClick(locked, new TestElement());
  }
  assert.equal(
    actions.length,
    replied,
    'Unavailable messages and read-only chats cannot start a reply',
  );
  const selection = nodes(
    ChatMessageContext({ ...props, selecting: true }),
  ).find((node) => node.type === 'ContextMenuTrigger');
  const previousActions = actions.length;
  selection.props.onClickCapture(event(new TestElement(true)));
  assert.equal(
    actions.length,
    previousActions,
    'Selection does not consume playback clicks',
  );
  selection.props.onClickCapture(event(new TestElement()));
  assert.deepEqual(actions.at(-1), ['select', 'm1']);
  selection.props.onDoubleClick({ ...event(new TestElement()), detail: 2 });
  assert.deepEqual(
    actions.at(-1),
    ['select', 'm1'],
    'Selection mode does not trigger a reply',
  );
  const reactions = [];
  const reactedMessage = {
    ...props.message,
    reactions: [{ emoji: '🔥', count: 2, own: true }],
  };
  const react = async (message, emoji) => {
    reactions.push([message.id, emoji]);
  };
  const dmReactions = nodes(
    ChatMessageContext({
      ...props,
      message: reactedMessage,
      selecting: false,
      onReact: react,
    }),
  );
  const choices = dmReactions.filter(
    (node) => node.props?.className === 'message-reaction-option',
  );
  assert.equal(
    choices.length,
    8,
    'DM reaction choices live inside the context menu',
  );
  assert.ok(
    dmReactions
      .find((node) => node.type === 'ContextMenuContent')
      .props.className.includes('has-reactions'),
  );
  choices.find((node) => node.props.title === 'Огонь').props.onClick();
  assert.deepEqual(
    reactions.at(-1),
    ['m1', null],
    'Selecting the current reaction removes it',
  );
  choices.find((node) => node.props.title === 'Любовь').props.onClick();
  assert.deepEqual(
    reactions.at(-1),
    ['m1', '❤️'],
    'Selecting a different reaction replaces it',
  );
  for (const state of [
    { disabled: true },
    { canSend: false },
    { reactionPending: true },
  ]) {
    const lockedChoices = nodes(
      ChatMessageContext({
        ...props,
        message: reactedMessage,
        selecting: false,
        onReact: react,
        ...state,
      }),
    ).filter((node) => node.props?.className === 'message-reaction-option');
    const count = reactions.length;
    assert(lockedChoices.every((node) => node.props.disabled));
    lockedChoices.forEach((node) => node.props.onClick());
    assert.equal(
      reactions.length,
      count,
      'Disabled or pending reactions cannot send changes',
    );
  }
  for (const state of [
    { selecting: true },
    { unconfirmed: true },
    { removing: true },
  ]) {
    assert.equal(
      nodes(
        ChatMessageContext({
          ...props,
          selecting: false,
          onReact: react,
          ...state,
        }),
      ).filter((node) => node.props?.className === 'message-reaction-option')
        .length,
      0,
    );
  }
  assert.equal(
    MessageReactions({
      reactions: [],
      disabled: false,
      onReact: async () => {},
    }),
    null,
    'Messages without reactions have no add button or empty row',
  );
  const chips = nodes(
    MessageReactions({
      reactions: reactedMessage.reactions,
      disabled: false,
      onReact: async (emoji) => {
        reactions.push(['chip', emoji]);
      },
    }),
  );
  assert.equal(
    chips.filter((node) => node.type === 'button').length,
    1,
    'Only existing reaction counters remain under a message',
  );
  chips.find((node) => node.type === 'button').props.onClick();
  assert.deepEqual(reactions.at(-1), ['chip', null]);

  const roomActions = [];
  const roomProps = {
    message: reactedMessage,
    kind: 'group',
    role: 'member',
    own: false,
    disabled: false,
    canSend: true,
    pending: false,
    reactionPending: false,
    className: 'room-message other',
    children: { type: 'p', props: { children: 'Group text' } },
    onReact: react,
    onReply: (message) => roomActions.push(['reply', message.id]),
    onRemove: (message) => roomActions.push(['delete', message.id]),
    onCopy: () => roomActions.push(['copy', 'm1']),
  };
  const groupNodes = nodes(RoomMessageContext(roomProps));
  assert.equal(
    groupNodes.filter(
      (node) => node.props?.className === 'message-reaction-option',
    ).length,
    8,
  );
  const groupTrigger = groupNodes.find(
    (node) => node.type === 'ContextMenuTrigger',
  );
  const oldBypass = bypassed;
  groupTrigger.props.onContextMenu(event(new TestElement()));
  groupTrigger.props.onTouchStart(event(new TestElement()));
  assert.equal(
    bypassed,
    oldBypass,
    'Group right click and long press reach Base UI',
  );
  const actionItem = (list, label) =>
    list.find(
      (node) =>
        node.type === 'ContextMenuItem' &&
        [node.props.children].flat().includes(label),
    );
  actionItem(groupNodes, 'Ответить').props.onClick();
  actionItem(groupNodes, 'Копировать текст').props.onClick();
  assert.deepEqual(roomActions, [
    ['reply', 'm1'],
    ['copy', 'm1'],
  ]);
  doubleClick(groupTrigger, new TestElement(false, true, true));
  assert.deepEqual(roomActions.at(-1), ['reply', 'm1']);
  const afterQuickReply = roomActions.length;
  groupTrigger.props.onClickCapture(event(new TestElement()));
  groupNodes
    .find((node) => node.type === 'ContextMenu')
    .props.onOpenChange(true);
  groupTrigger.props.onDoubleClick({ ...event(new TestElement()), detail: 2 });
  assert.equal(
    roomActions.length,
    afterQuickReply,
    'Opening the group menu cancels an in-progress reply gesture',
  );
  const swipe = (surface) => {
    const currentTarget = {
      ...root,
      setAttribute() {},
      removeAttribute() {},
      toggleAttribute() {},
      style: { setProperty() {}, removeProperty() {} },
    };
    const start = {
      ...event(new TestElement()),
      currentTarget,
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      cancelable: true,
      clientX: 140,
    };
    surface.props.onPointerDown(start);
    surface.props.onPointerMove({ ...start, clientX: 60 });
    surface.props.onPointerUp({ ...start, clientX: 60 });
  };
  swipe(groupTrigger);
  assert.equal(roomActions.length, afterQuickReply + 1);
  assert.deepEqual(roomActions.at(-1), ['reply', 'm1']);
  for (const restrictions of [
    { disabled: true },
    { canSend: false },
    { pending: true },
    { kind: 'secret' },
    { message: { ...reactedMessage, deletedAt: 1 } },
  ]) {
    const locked = nodes(RoomMessageContext({ ...roomProps, ...restrictions }))
      .find((node) => node.type === 'ContextMenuTrigger');
    doubleClick(locked, new TestElement());
    swipe(locked);
  }
  assert.equal(
    roomActions.length,
    afterQuickReply + 1,
    'Group swipe and double click obey the same permissions as its reply menu',
  );
  assert.equal(
    actionItem(groupNodes, 'Удалить у всех'),
    undefined,
    'Members cannot delete another user’s message',
  );
  for (const rights of [{ own: true }, { role: 'admin' }, { role: 'owner' }]) {
    const allowed = nodes(RoomMessageContext({ ...roomProps, ...rights }));
    actionItem(allowed, 'Удалить у всех').props.onClick();
    assert.deepEqual(roomActions.at(-1), ['delete', 'm1']);
  }
  const secretNodes = nodes(
    RoomMessageContext({ ...roomProps, kind: 'secret' }),
  );
  assert.equal(
    secretNodes.filter(
      (node) => node.props?.className === 'message-reaction-option',
    ).length,
    0,
    'Secret chats do not expose plaintext reactions',
  );
  const deletedNodes = nodes(
    RoomMessageContext({
      ...roomProps,
      message: { ...reactedMessage, deletedAt: 1 },
    }),
  );
  assert.equal(
    deletedNodes.find((node) => node.type === 'ContextMenu').props.disabled,
    true,
  );
  assert.equal(
    deletedNodes.some(
      (node) => node.props?.className === 'room-message-more icon-button',
    ),
    false,
  );

  const oldMouseEvent = Object.getOwnPropertyDescriptor(
    globalThis,
    'MouseEvent',
  );
  const dispatched = [];
  Object.defineProperty(globalThis, 'MouseEvent', {
    configurable: true,
    value: class {
      constructor(type, init) {
        Object.assign(this, { type }, init);
      }
    },
  });
  try {
    const surface = {
      getBoundingClientRect: () => ({
        left: 20,
        top: 30,
        width: 100,
        height: 40,
      }),
      dispatchEvent: (e) => dispatched.push(e),
    };
    groupTrigger.props.ref.current = surface;
    const more = groupNodes.find(
      (node) => node.props?.className === 'room-message-more icon-button',
    );
    more.props.onClick({
      stopPropagation() {},
      currentTarget: {
        getBoundingClientRect: () => ({
          left: 130,
          top: 40,
          width: 20,
          height: 30,
        }),
      },
    });
    assert.deepEqual(
      [dispatched[0].type, dispatched[0].clientX, dispatched[0].clientY],
      ['contextmenu', 140, 55],
      'More button opens the same context menu at its own position',
    );
    groupTrigger.props.onKeyDown({
      ...event(new TestElement()),
      key: 'F10',
      shiftKey: true,
      currentTarget: { contains: () => true, querySelector: () => surface },
    });
    assert.equal(
      dispatched.length,
      2,
      'Keyboard shortcut also opens the group menu',
    );
    assert.equal(dispatched[1].bubbles, true);
  } finally {
    if (oldMouseEvent)
      Object.defineProperty(globalThis, 'MouseEvent', oldMouseEvent);
    else delete globalThis.MouseEvent;
  }
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      getSelection: () => ({
        isCollapsed: false,
        anchorNode: { contained: true },
      }),
    },
  });
  try {
    const count = actions.length,
      prevented = nativePrevented;
    selection.props.onPointerDownCapture(event(new TestElement()));
    selection.props.onClickCapture({
      ...event(new TestElement()),
      clientX: 100,
    });
    assert.equal(
      actions.length,
      count,
      'Selecting text never toggles its message on mouseup',
    );
    assert.equal(
      nativePrevented,
      prevented,
      'The browser keeps the text selection',
    );
    selection.props.onPointerDownCapture(event(new TestElement()));
    selection.props.onClickCapture(event(new TestElement()));
    assert.equal(
      actions.length,
      count + 1,
      'An old text selection cannot block a new stationary row click',
    );
    selection.props.onClickCapture({ ...event(new TestElement()), detail: 2 });
    assert.equal(
      actions.length,
      count + 1,
      'Double click keeps native word selection',
    );
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else delete globalThis.window;
  }
} finally {
  if (previousElement)
    Object.defineProperty(globalThis, 'Element', previousElement);
  else delete globalThis.Element;
}
console.log(
  'Chat menus: complete actions, own-message editing, selection, player/portal boundaries and untouched native events passed.',
);
