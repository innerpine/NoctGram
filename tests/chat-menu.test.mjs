import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['app/chat-message-menu.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  plugins: [
    {
      name: 'menu-surfaces',
      setup(build) {
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
              ? 'export const useRef=(current)=>({current});'
              : path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx, Fragment="Fragment";'
                : path === 'lucide-react'
                  ? 'export const CheckSquare="CheckSquare", Copy="Copy", Ellipsis="Ellipsis", Flag="Flag", Forward="Forward", Pencil="Pencil", Pin="Pin", PinOff="PinOff", Reply="Reply", Trash2="Trash2";'
                  : path.endsWith('/context-menu')
                    ? 'export const ContextMenu="ContextMenu", ContextMenuTrigger="ContextMenuTrigger", ContextMenuContent="ContextMenuContent", ContextMenuItem="ContextMenuItem", ContextMenuSeparator="ContextMenuSeparator";'
                    : 'export const DropdownMenu="DropdownMenu", DropdownMenuTrigger="DropdownMenuTrigger", DropdownMenuContent="DropdownMenuContent", DropdownMenuItem="DropdownMenuItem", DropdownMenuSeparator="DropdownMenuSeparator";',
        }));
      },
    },
  ],
});
const { ChatMessageContext, preserveContextTarget, chatHistoryContextMenu } =
  await import(
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
  constructor(exempt = false, contained = true) {
    this.exempt = exempt;
    this.contained = contained;
  }
  closest(selector) {
    return this.exempt && selector.includes('video') ? this : null;
  }
}
Object.defineProperty(globalThis, 'Element', {
  configurable: true,
  value: TestElement,
});
try {
  const root = { contains: (target) => target.contained };
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
