import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { build } from 'esbuild';

// Exercise Noctgram's actual tab callbacks and rendered sibling tree. Child
// components are boundaries: this test needs no browser or account mutations.
const source = await readFile('app/noctgram.tsx', 'utf8');
const file = ts.createSourceFile(
  'noctgram.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const imports = new Map();
for (const statement of file.statements) {
  if (!ts.isImportDeclaration(statement)) continue;
  const path = statement.moduleSpecifier.text;
  const names = imports.get(path) || new Set();
  for (const specifier of statement.importClause?.namedBindings?.elements ||
    []) {
    if (!specifier.isTypeOnly)
      names.add((specifier.propertyName || specifier.name).text);
  }
  imports.set(path, names);
}
const states = new Map();
const stateSlots = new Map();
let stateSlot = 0;
const componentSource = file.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'Noctgram',
);
for (const statement of componentSource.body.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (
      ts.isArrayBindingPattern(declaration.name) &&
      declaration.initializer &&
      ts.isCallExpression(declaration.initializer) &&
      declaration.initializer.expression.getText(file) === 'useState'
    ) {
      const binding = declaration.name.elements[0];
      if (binding && ts.isBindingElement(binding))
        stateSlots.set(binding.name.getText(file), stateSlot);
      // A setter-only state still occupies a React hook slot.
      stateSlot++;
    }
  }
}
let cursor = 0;
let layoutCursor = 0;
const layouts = new Map(),
  pendingLayouts = [];
const hooks = {
  useState(value) {
    const id = cursor++;
    if (!states.has(id)) states.set(id, value);
    return [
      states.get(id),
      (next) =>
        states.set(
          id,
          typeof next === 'function' ? next(states.get(id)) : next,
        ),
    ];
  },
  useRef: (current) => ({ current }),
  useCallback: (fn) => fn,
  useMemo: (factory) => factory(),
  useEffect: () => {},
  useLayoutEffect(effect, deps) {
    const id = layoutCursor++;
    const previous = layouts.get(id);
    if (
      !previous ||
      deps.some((value, i) => !Object.is(value, previous.deps[i]))
    )
      pendingLayouts.push(() => {
        previous?.cleanup?.();
        layouts.set(id, { deps, cleanup: effect() });
      });
  },
};
const hookKey = '__noctgramProfileTabHooks';
globalThis[hookKey] = hooks;
try {
  const { outputFiles } = await build({
    entryPoints: ['app/noctgram.tsx'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    plugins: [
      {
        name: 'profile-boundaries',
        setup(build) {
          build.onResolve({ filter: /.*/ }, ({ path, kind }) =>
            kind === 'entry-point' ||
            [
              '@/lib/feed-snapshots',
              '@/lib/chat-snapshots',
              '@/lib/profile-cover-cache',
              '@/lib/app-history',
            ].includes(path)
              ? undefined
              : { path, namespace: 'boundary' },
          );
          build.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
            contents:
              path === 'react'
                ? `export const {useState,useRef,useEffect,useLayoutEffect,useCallback,useMemo}=globalThis.${hookKey};`
                : path === 'react/jsx-runtime'
                  ? 'export const Fragment="Fragment"; export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;'
                  : [...(imports.get(path) || [])]
                      .map((name) => {
                        const value =
                          name === 'deferredPanel'
                            ? '(loader)=>loader.toString().match(/default:\\s*m\\.(\\w+)/)[1]'
                            : name === 'welcome'
                              ? '[]'
                              : name === 'hasProfileDesign'
                                ? '()=>false'
                                : name === 'useRoomList'
                                  ? '()=>({rooms:[],error:"",refresh:async()=>{}})'
                                  : [
                                        'appearanceStyle',
                                        'useAudioCalls',
                                      ].includes(name)
                                    ? '()=>({})'
                                    : name === 'localDate'
                                      ? '()=>"2026-09-08T12:00"'
                                      : JSON.stringify(name);
                        return `export const ${name}=${value};`;
                      })
                      .join('\n'),
          }));
        },
      },
    ],
  });
  const { default: Noctgram } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(outputFiles[0].text).toString('base64')
  );
  function render() {
    cursor = 0;
    layoutCursor = 0;
    pendingLayouts.length = 0;
    return Noctgram({});
  }
  function all(node, type, found = []) {
    if (!node || typeof node !== 'object') return found;
    if (Array.isArray(node)) {
      const keys = node
        .filter((child) => child && child.key != null)
        .map((child) => child.key);
      assert.equal(
        new Set(keys).size,
        keys.length,
        'Sibling keys must be unique when switching tabs',
      );
      node.forEach((child) => all(child, type, found));
    } else {
      if (node.type === type) found.push(node);
      all(node.props?.children, type, found);
    }
    return found;
  }
  const account = (id) => ({
    id,
    name: id,
    kind: 'person',
    handle: id,
    handles: [id],
    bio: '',
    avatar: '',
    cover: '',
    followers: 0,
    following: 0,
    postCount: 0,
    created: 1,
    premium: false,
  });
  // The first state group is page, me, profile, people, posts, mode, profileTab.
  const startup = render();
  assert.equal(startup.props.className, 'app-startup');
  assert.equal(
    all(startup, 'PostCard').length,
    0,
    'Startup must not display fabricated posts or the default feed',
  );
  assert.equal(
    all(startup, 'ProfileGifts').length,
    0,
    'No unrelated section mounts before route restoration',
  );
  states.set(stateSlots.get('routeReady'), true);
  states.set(0, 'profile');
  for (const me of [account('local_music_friend'), account('local_seedy')]) {
    states.set(1, me);
    for (const own of [true, false]) {
      states.set(2, own ? me : account('other_user'));
      for (const tab of [
        'posts',
        'gifts',
        'media',
        'gifts',
        'posts',
        'media',
        'gifts',
      ]) {
        const tabs = all(render(), 'Tabs').find((node) =>
          all(node, 'TabsTrigger').some((item) => item.props.value === 'gifts'),
        );
        assert.ok(tabs, 'Person profiles expose the gift tab');
        tabs.props.onValueChange(tab);
        const tree = render();
        assert.equal(
          all(tree, 'aside').some(
            (node) => node.props.className === 'right-column',
          ),
          false,
          'Profile panels keep discovery recommendations out of the workspace',
        );
        const gifts = all(tree, 'ProfileGifts');
        assert.equal(
          gifts.length,
          tab === 'gifts' ? 1 : 0,
          `${me.id}: ${tab} must replace the previous panel`,
        );
        if (gifts.length) {
          assert.equal(gifts[0].props.own, own);
          const selfGift = gifts[0].props.selfGift;
          assert.equal(
            !!selfGift,
            own,
            'Only the current account has the self-gift action',
          );
          if (selfGift) {
            assert.equal(selfGift.type, 'SendGiftButton');
            assert.equal(selfGift.props.senderId, me.id);
            assert.equal(selfGift.props.recipient.id, me.id);
            assert.equal(selfGift.props.showLabel, true);
          }
        }
        assert.equal(
          all(tree, 'ChannelTools').length,
          0,
          'Personal profiles do not expose removed scheduling tools',
        );
        const currentTabs = all(tree, 'Tabs').find(
          (node) => node.props.value === tab,
        );
        assert.ok(currentTabs, 'The selected tab follows the click');
      }
    }
  }
  const channelOwner = account('channel-owner');
  states.set(1, channelOwner);
  states.set(2, {
    ...account('managed-channel'),
    kind: 'channel',
    ownerId: channelOwner.id,
    canPublish: true,
    canManageMembers: true,
  });
  const channelTabs = all(render(), 'Tabs').find((node) =>
    all(node, 'TabsTrigger').some((item) => item.props.value === 'posts'),
  );
  channelTabs.props.onValueChange('posts');
  assert.equal(
    all(render(), 'ChannelTools').length,
    1,
    'Channel team management stays available',
  );
  channelTabs.props.onValueChange('media');
  assert.equal(
    all(render(), 'ChannelTools').length,
    0,
    'Channel tools stay out of the media tab',
  );
  console.log(
    'Profile tabs passed: both accounts, own/other profiles, repeated gifts/media/posts switches, unique sibling keys and publication tools.',
  );

  for (const managed of [false, true]) {
    const viewer = account('channel-viewer');
    const channel = {
      ...account('gift-channel'),
      kind: 'channel',
      ownerId: managed ? viewer.id : 'channel-owner',
      canEditProfile: managed,
    };
    states.set(1, viewer);
    states.set(2, channel);
    states.set(stateSlots.get('profileTab'), 'posts');
    const tabs = all(render(), 'Tabs').find((node) =>
      all(node, 'TabsTrigger').some((item) => item.props.value === 'gifts'),
    );
    assert.ok(tabs, 'Channels expose their gift collection');
    tabs.props.onValueChange('gifts');
    const tree = render();
    const gifts = all(tree, 'ProfileGifts')[0];
    assert.ok(gifts);
    assert.equal(gifts.props.userId, channel.id);
    assert.equal(
      gifts.props.own,
      false,
      'Channel gifts do not expose personal sale/upgrade actions',
    );
    assert.equal(gifts.props.canManageVisibility, managed);
    assert.equal(gifts.props.selfGift.props.recipient.id, channel.id);
    assert.equal(gifts.props.selfGift.props.senderId, viewer.id);
    assert.ok(
      all(tree, 'SendGiftButton').some(
        (button) => button.props.recipient.id === channel.id,
      ),
    );
  }
  const editorMe = account('editor-me');
  states.set(1, editorMe);
  states.set(2, editorMe);
  states.set(stateSlots.get('modal'), 'edit');
  states.set(stateSlots.get('editId'), editorMe.id);
  states.set(stateSlots.get('editName'), 'Несохранённое имя');
  const editorLabels = {
    profile: 'Профиль',
    design: 'Дизайн',
    privacy: 'Приватность',
    account: 'Аккаунт',
  };
  for (const tab of [
    'profile',
    'design',
    'privacy',
    'account',
    'design',
    'profile',
    'privacy',
  ]) {
    all(render(), 'button')
      .find((node) => node.props.children === editorLabels[tab])
      .props.onClick();
    const tree = render(),
      panes = all(tree, 'EditorPane');
    assert.equal(panes.length, 4);
    assert.equal(panes.filter((pane) => pane.props.active).length, 1);
    assert.equal(
      all(tree, 'ProfileDesign').length,
      1,
      'Design state stays mounted across tabs',
    );
    assert.equal(
      all(tree, 'PrivacyPanel').length,
      1,
      'Privacy does not refetch from an unmount on every click',
    );
    assert.equal(states.get(stateSlots.get('editName')), 'Несохранённое имя');
    assert.equal(all(tree, 'AccountPanel').length, 1);
  }
  const channel = {
    ...account('channel'),
    kind: 'channel',
    ownerId: editorMe.id,
  };
  states.set(2, channel);
  states.set(stateSlots.get('editId'), channel.id);
  for (const tab of ['profile', 'design']) {
    all(render(), 'button')
      .find((node) => node.props.children === editorLabels[tab])
      .props.onClick();
    const tree = render();
    assert.equal(all(tree, 'EditorPane').length, 2);
    assert.equal(
      all(tree, 'EditorPane').filter((pane) => pane.props.active).length,
      1,
    );
    assert.equal(all(tree, 'AccountPanel').length, 0);
    assert.equal(all(tree, 'PrivacyPanel').length, 0);
    assert.equal(all(tree, 'ProfileDesign')[0].props.me.id, channel.id);
  }
  states.set(stateSlots.get('modal'), '');
  console.log(
    'Editor tabs passed: one active pane, persistent forms/privacy and unchanged unsaved fields.',
  );
  // Search selects the correct data during render; it must not force a second
  // synchronous render just to discard the previous page before paint.
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const focusCalls = [],
    scrollCalls = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { scrollTo: (options) => scrollCalls.push(options) },
  });
  try {
    const me = account('me');
    states.set(0, 'feed');
    states.set(1, me);
    states.set(2, me);
    states.set(4, [{ id: 'old-feed', author: me }]);
    states.set(9, false);
    const navigation = all(render(), 'MainNavigation')[0];
    const originalTimer = globalThis.setTimeout;
    try {
      globalThis.setTimeout = () =>
        assert.fail('Search navigation must not queue a delayed autofocus');
      assert.equal(navigation.props.href('search'), '/?page=search');
      navigation.props.navigate('search');
    } finally {
      globalThis.setTimeout = originalTimer;
    }
    let tree = render();
    assert.equal(
      all(tree, 'PostCard').length,
      0,
      'Old content is excluded even before any layout effect',
    );
    all(tree, 'input').find(
      (node) => node.props['aria-label'] === 'Поиск в ленте',
    ).props.ref.current = {
      focus: (options) => focusCalls.push(options),
    };
    pendingLayouts.forEach((effect) => effect());
    tree = render();
    assert.equal(
      all(tree, 'PostCard').length,
      0,
      'The first painted search frame cannot contain the old feed',
    );
    assert.equal(all(tree, 'PostSkeleton').length, 2);
    assert.deepEqual(focusCalls, [{ preventScroll: true }]);
    assert.deepEqual(scrollCalls, [{ top: 0, left: 0, behavior: 'instant' }]);
    assert.equal(
      pendingLayouts.length,
      0,
      'The loading render cannot repeat entry effects',
    );
    states.set(4, [{ id: 'search-result', author: me }]);
    states.set(9, false);
    tree = render();
    all(tree, 'input')
      .find((node) => node.props['aria-label'] === 'Поиск в ленте')
      .props.onChange({ target: { value: 'новый запрос' } });
    render();
    assert.equal(
      pendingLayouts.length,
      0,
      'Typing cannot restart the entrance or steal the input caret',
    );
    assert.equal(focusCalls.length, 1);
    all(render(), 'MainNavigation')[0].props.navigate('messages');
    render();
    pendingLayouts.forEach((effect) => effect());
    assert.equal(
      focusCalls.length,
      1,
      'Leaving search cannot focus a detached input later',
    );
    console.log(
      'Search entry passed: no stale first frame, focus without scrolling or timers, stable typing and clean navigation away.',
    );
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
  states.set(stateSlots.get('page'), 'messages');
  states.set(stateSlots.get('me'), account('room-owner'));
  states.set(stateSlots.get('peer'), null);
  states.set(stateSlots.get('roomTarget'), null);
  let chatTree = render();
  const heading = all(chatTree, 'div').find(
    (node) => node.props.className === 'threads-heading',
  );
  const createMenu = all(heading, 'ChatCreateMenu')[0];
  const pencil = all(heading, 'button').find(
    (node) => node.props['aria-label'] === 'Новый диалог',
  );
  assert.ok(
    heading.props.children.indexOf(createMenu) <
      heading.props.children.indexOf(pencil),
    'Create menu precedes the existing pencil',
  );
  createMenu.props.onCreateGroup();
  assert.equal(all(render(), 'CreateGroupDialog')[0].props.open, true);
  assert.equal(all(render(), 'SelectSecretPeerDialog')[0].props.open, false);
  states.set(stateSlots.get('me'), account('another-account'));
  assert.equal(
    all(render(), 'CreateGroupDialog')[0].props.open,
    false,
    'Account switch closes a foreign creation flow before effects',
  );
  chatTree = render();
  all(chatTree, 'ChatCreateMenu')[0].props.onCreateSecret();
  assert.equal(all(render(), 'SelectSecretPeerDialog')[0].props.open, true);
  states.set(stateSlots.get('roomTarget'), { roomId: 'one-room' });
  chatTree = render();
  const workspace = all(chatTree, 'RoomConversation')[0];
  assert.equal(workspace.props.target.roomId, 'one-room');
  assert.ok(
    all(chatTree, 'div').some(
      (node) => node.props.className === 'messenger peer-open',
    ),
  );
  const oldKey = workspace.key;
  states.set(stateSlots.get('me'), account('third-account'));
  assert.notEqual(
    all(render(), 'RoomConversation')[0].key,
    oldKey,
    'Changing identity remounts the private workspace',
  );
  console.log(
    'Room entry passed: plus placement, controlled dialogs, account isolation and mobile conversation state.',
  );
} finally {
  delete globalThis[hookKey];
}
