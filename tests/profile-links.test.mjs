import assert from 'node:assert/strict';
import { build } from 'esbuild';

const closed = [];
globalThis.__profileLinkScopes = [
  () => closed.push('outer'),
  () => closed.push('inner'),
];
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: new EventTarget(),
});
try {
  const { outputFiles } = await build({
    stdin: {
      contents:
        "export * from './app/profile-link'; export * from './lib/profile-links';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    plugins: [
      {
        name: 'profile-link-events',
        setup(build) {
          build.onResolve(
            { filter: /^react(?:\/jsx-runtime)?$/ },
            ({ path }) => ({ path, namespace: 'fixture' }),
          );
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'react'
                ? 'export const createContext=()=>({}); export const useContext=()=>globalThis.__profileLinkScopes;'
                : 'export const Fragment="Fragment"; export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;',
          }));
        },
      },
    ],
  });
  const api = await import(
    'data:text/javascript;base64,' +
      Buffer.from(outputFiles[0].text).toString('base64')
  );
  const text = 'Привет, @Invoker!\nОт @noct_test_friend ❤️';
  const parts = api.mentionParts(text);
  assert.equal(parts.map((p) => p.text).join(''), text);
  assert.deepEqual(
    parts.filter((p) => p.handle).map((p) => p.handle),
    ['invoker', 'noct_test_friend'],
  );
  for (const text of [
    'test+tag@example.com',
    'https://site.test/?user=@invoker',
    'https://site.test/@invoker',
    '@' + 'a'.repeat(25),
    'слово@invoker',
    '/@invoker',
  ]) {
    assert.ok(
      api.mentionParts(text).every((part) => !part.handle),
      `Not a profile mention: ${text}`,
    );
  }
  assert.equal(api.profileHref({ id: 'user:a&b' }), '/?profile=user%3Aa%26b');
  assert.equal(api.profileHref({ handle: 'invoker' }), '/?handle=invoker');
  const link = api.ProfileLink({
    target: { id: 'recipient-id' },
    children: 'Recipient',
  });
  const click = (extra = {}) => {
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
  assert.equal(
    click().defaultPrevented,
    false,
    'Without an app listener, the real href still works',
  );
  let target;
  const navigate = (event) => {
    event.preventDefault();
    target = event.detail;
  };
  window.addEventListener(api.PROFILE_NAVIGATE, navigate);
  assert.equal(
    click().defaultPrevented,
    true,
    'In-app navigation does not reload the music player',
  );
  assert.equal(target.id, 'recipient-id');
  assert.deepEqual(
    closed,
    [],
    'Dialogs stay open until the profile request succeeds',
  );
  target.onNavigated();
  assert.deepEqual(
    closed,
    ['inner', 'outer'],
    'Only containing dialogs close, from inner to outer',
  );
  for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
    target = null;
    assert.equal(click({ [modifier]: true }).defaultPrevented, false);
    assert.equal(
      target,
      null,
      'Modified clicks keep native browser navigation',
    );
  }
  assert.equal(click({ button: 1 }).defaultPrevented, false);
  console.log(
    'Profile links: exact targets, safe mentions, keyboard/browser modifiers, no reload, and scoped dialog close passed.',
  );
} finally {
  delete globalThis.__profileLinkScopes;
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
  else delete globalThis.window;
}
