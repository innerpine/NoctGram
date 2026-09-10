import assert from 'node:assert/strict';
import { build } from 'esbuild';

const effects = [],
  requests = [];
globalThis.__miniProfileEffects = effects;
globalThis.__miniProfileRequest = async (url) => {
  requests.push(new URL(url, 'https://noctgram.test'));
  return { gifts: [], items: [], next: null };
};
const { outputFiles } = await build({
  entryPoints: ['app/chat-peer-profile.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'mini-profile-boundaries',
      setup(build) {
        build.onResolve(
          { filter: /^(react|@\/|\.\/)/ },
          ({ path, kind, importer }) =>
            kind === 'entry-point' ||
            path === 'react/jsx-runtime' ||
            !importer
              .replaceAll('\\', '/')
              .endsWith('/app/chat-peer-profile.tsx')
              ? undefined
              : { path, namespace: 'fixture' },
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'react'
              ? `export const useState = value => [typeof value === 'function' ? value() : value, () => {}];
             export const useRef = current => ({current});
             export const useEffect = effect => globalThis.__miniProfileEffects.push(effect);
             export const useLayoutEffect = () => {};`
              : `export const Dialog='Dialog', DialogContent='DialogContent', DialogDescription='DialogDescription', DialogTitle='DialogTitle',
             Avatar='Avatar', DisplayName='DisplayName', GiftAnimation='GiftAnimation', ChatEmojiText='ChatEmojiText',
             ProfileLink='ProfileLink', ChatPeerPresence='ChatPeerPresence';
             export const appearanceStyle=()=>({}), useProfileBackground=()=>undefined, giftDefinition=()=>null, chatFileSize=()=>'';
             export const chatRequest=(...args)=>globalThis.__miniProfileRequest(...args);`,
        }));
      },
    },
  ],
});
const { ChatProfileDialog } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
globalThis.window = { matchMedia: () => ({ matches: true }) };
for (const id of ['bob', 'alice']) {
  effects.length = 0;
  requests.length = 0;
  const dialog = ChatProfileDialog({
    person: { id, name: id, handle: id },
    viewerId: 'alice',
    chatPeerId: 'bob',
    open: true,
    onOpenChange: () => {},
  });
  const body = dialog.props.children.props.children;
  const content = body.type(body.props);
  const cleanup = effects.map((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    requests
      .find((url) => url.searchParams.get('action') === 'profile')
      .searchParams.get('id'),
    id,
  );
  assert.equal(
    requests
      .find((url) => url.pathname === '/api/gifts')
      .searchParams.get('user'),
    id,
  );
  assert.equal(
    requests
      .find((url) => url.searchParams.get('action') === 'chatLibrary')
      .searchParams.get('peer'),
    'bob',
  );
  const photos = nodes(content).find(
    (node) =>
      node.type === 'button' &&
      nodes(node).some(
        (child) =>
          child.type === 'span' && child.props.children === 'Фотографии',
      ),
  );
  photos.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  const mediaRequest = requests.find(
    (url) => url.searchParams.get('kind') === 'photos',
  );
  assert.equal(
    mediaRequest.searchParams.get('peer'),
    'bob',
    'Media stays in the current conversation when viewing your own profile',
  );
  assert.equal(
    nodes(content).find((node) => node.type === 'DialogTitle').props.children,
    id === 'alice' ? 'Ваш профиль' : 'О собеседнике',
  );
  cleanup.forEach((dispose) => dispose?.());
}
delete globalThis.window;
delete globalThis.__miniProfileEffects;
delete globalThis.__miniProfileRequest;
console.log(
  'Chat mini-profile: own/peer identity and gifts, current conversation statistics and media passed.',
);
