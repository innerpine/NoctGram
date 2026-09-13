import assert from 'node:assert/strict';
import { build } from 'esbuild';

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const eventWindow = new EventTarget();
eventWindow.location = { origin: 'https://noctgram.test' };
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: eventWindow,
});
const scopes = [];
globalThis.__entityLinkDialogs = [() => scopes.push('dialog')];
try {
  const { outputFiles } = await build({
    stdin: {
      contents: `export * from './lib/profile-links';
        export * from './lib/mention-navigation';
        export * from './app/profile-link';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    plugins: [
      {
        name: 'entity-link-events',
        setup(build) {
          build.onResolve({ filter: /^\.\/premium-emoji$/ }, () => ({
            path: 'emoji',
            namespace: 'fixture-emoji',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture-emoji' }, () => ({
            contents: 'export const EmojiText=({text})=>text;',
          }));
          build.onResolve(
            { filter: /^react(?:\/jsx-runtime)?$/ },
            ({ path }) => ({
              path,
              namespace: 'fixture-react',
            }),
          );
          build.onLoad(
            { filter: /.*/, namespace: 'fixture-react' },
            ({ path }) => ({
              contents:
                path === 'react'
                  ? 'export const createContext=()=>({}); export const useContext=()=>globalThis.__entityLinkDialogs;'
                  : 'export const Fragment="Fragment"; export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;',
            }),
          );
        },
      },
    ],
  });
  const api = await import(
    'data:text/javascript;base64,' +
      Buffer.from(outputFiles[0].text).toString('base64')
  );
  const origin = eventWindow.location.origin,
    token = 'a'.repeat(64);
  assert.deepEqual(
    api.profileTargetFromURL(`${origin}/?group=Night_Club`, origin),
    { group: 'night_club' },
  );
  assert.deepEqual(api.profileTargetFromURL(`/?invite=${token}`, origin), {
    invite: token,
  });
  assert.deepEqual(
    api.profileTargetFromURL('/?room=room:noctgram-community', origin),
    { roomId: 'room:noctgram-community' },
  );
  assert.deepEqual(api.profileTargetFromURL('/?profile=channel:one', origin), {
    ref: 'channel:one',
  });
  assert.deepEqual(api.profileTargetFromURL('/?profile=invoker', origin), {
    ref: 'invoker',
  });
  assert.equal(
    api.profileHref({ id: 'local_seedy', handle: 'invoker' }),
    '/?profile=invoker',
  );
  assert.deepEqual(api.profileTargetFromURL('/?handle=Newsroom', origin), {
    handle: 'newsroom',
  });
  for (const href of [
    'https://foreign.test/?group=night_club',
    'https://noctgram.test.evil.test/?group=night_club',
    'https://evil@noctgram.test/?group=night_club',
    'http://noctgram.test/?group=night_club',
    '//foreign.test/?group=night_club',
    '/other?group=night_club',
    '/?group=ab',
    '/?group=night_club&profile=channel',
    '/?group=night_club&group=other_group',
    '/?invite=revoked-short-token',
    '/?room=%00',
    '/?handle=bad%20name',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ])
    assert.equal(api.profileTargetFromURL(href, origin), null, href);

  const text = `@Night_Club, канал ${origin}/?handle=newsroom. Группа (${origin}/?group=night_club), приглашение /?invite=${token}!`;
  const parts = api.mentionParts(text);
  assert.equal(
    parts.map((part) => part.text).join(''),
    text,
    'Text including punctuation survives parsing',
  );
  assert.deepEqual(
    parts.filter((part) => part.handle).map((part) => part.handle),
    ['night_club'],
  );
  assert.deepEqual(
    parts.filter((part) => part.href).map((part) => part.href),
    [
      `${origin}/?handle=newsroom`,
      `${origin}/?group=night_club`,
      `/?invite=${token}`,
    ],
  );
  assert.ok(
    api
      .mentionParts('test+tag@example.com https://external.test/@night_club')
      .every((part) => !part.handle),
  );
  assert.equal(
    api.mentionParts('<script>alert(1)</script>')[0].text,
    '<script>alert(1)</script>',
  );
  assert.ok(
    api
      .mentionParts('javascript:alert(1) data:text/html,payload')
      .every((part) => !part.href),
  );
  assert.ok(
    api
      .mentionParts('https://evil@noctgram.test/?group=night_club')
      .every((part) => !part.href),
  );
  assert.equal(api.profileHref({ group: 'night_club' }), '/?group=night_club');
  assert.equal(api.profileHref({ invite: token }), '/?invite=' + token);
  assert.equal(api.profileHref({ roomId: 'room:test' }), '/?room=room%3Atest');

  let target = null;
  eventWindow.addEventListener(api.PROFILE_NAVIGATE, (event) => {
    event.preventDefault();
    target = event.detail;
  });
  const click = (link, extra = {}) => {
    const event = {
      button: 0,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...extra,
    };
    link.props.onClick(event);
    return event;
  };
  const link = api.ContentLink({
    href: `${origin}/?group=night_club`,
    text: 'Group',
  });
  assert.equal(
    click(link).defaultPrevented,
    true,
    'Same-origin links use app navigation without interrupting music',
  );
  assert.equal(target.group, 'night_club');
  assert.deepEqual(scopes, [], 'Dialog stays open until successful navigation');
  target.onNavigated();
  assert.deepEqual(scopes, ['dialog']);
  for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
    target = null;
    assert.equal(click(link, { [modifier]: true }).defaultPrevented, false);
    assert.equal(target, null, 'Modified clicks keep native link behavior');
  }
  target = null;
  const external = click(
    api.ContentLink({
      href: 'https://external.test/?group=night_club',
      text: 'External',
    }),
  );
  assert.equal(external.defaultPrevented, false);
  assert.equal(
    external.stopped,
    true,
    'External URL does not also open the containing feed post',
  );
  assert.equal(target, null);

  // Selecting profile text or an inline content link must not navigate on mouseup.
  for (const selectable of [
    link,
    api.ProfileLink({
      target: { id: 'local_seedy', handle: 'invoker' },
      children: 'Flyather',
    }),
  ]) {
    const selected = click(selectable, {
      detail: 1,
      currentTarget: {
        ownerDocument: {
          getSelection: () => ({
            isCollapsed: false,
            containsNode: () => true,
          }),
        },
      },
    });
    assert.equal(selected.defaultPrevented, true);
    assert.equal(target, null);
  }

  const requests = [];
  let profileStatus = 200,
    groupStatus = 200;
  globalThis.fetch = async (href) => {
    const url = new URL(href, origin);
    requests.push(url.pathname + url.search);
    if (url.pathname === '/api/social')
      return Response.json(
        profileStatus === 200
          ? { id: 'channel:newsroom', kind: 'channel', handle: 'newsroom' }
          : { error: 'Профиль недоступен' },
        { status: profileStatus },
      );
    assert.equal(url.pathname, '/api/rooms');
    assert.equal(
      url.searchParams.get('action'),
      'resolveGroup',
      'No broad search or private room lookup',
    );
    return Response.json(
      groupStatus === 200
        ? {
            room: {
              id: 'room:test',
              username: 'night_club',
              visibility: 'public',
            },
          }
        : { error: 'Группа не найдена' },
      { status: groupStatus },
    );
  };
  const channel = await api.resolveMention('newsroom');
  assert.equal(channel.kind, 'profile');
  assert.equal(
    channel.profile.kind,
    'channel',
    'Channel opens its profile with the existing subscribe control',
  );
  assert.equal(
    requests.length,
    1,
    'Existing profile takes priority over a colliding group name',
  );
  profileStatus = 404;
  assert.deepEqual(await api.resolveMention('night_club', true), {
    kind: 'group',
    group: 'night_club',
  });
  assert.ok(
    requests.some((url) => url.includes('ref=night_club')),
    'Canonical shared links resolve profiles by reference before falling back to groups',
  );
  assert.deepEqual(await api.resolveMention('night_club'), {
    kind: 'group',
    group: 'night_club',
  });
  for (const status of [401, 403, 429, 500]) {
    profileStatus = status;
    requests.length = 0;
    await assert.rejects(
      api.resolveMention('night_club'),
      (error) => error.status === status,
    );
    assert.equal(
      requests.length,
      1,
      'Do not resolve group after denied/failed profile lookup',
    );
  }
  profileStatus = 404;
  groupStatus = 404;
  await assert.rejects(
    api.resolveMention('unknown_group'),
    /Пользователь, канал или публичная группа не найдены/,
  );
  console.log(
    'Entity mentions: channels, public groups, invites, safe URL parsing, native modifiers, dialog closure and denied lookups passed.',
  );
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__entityLinkDialogs;
  if (originalWindow)
    Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
}
