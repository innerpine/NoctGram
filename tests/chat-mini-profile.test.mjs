import assert from 'node:assert/strict';
import { build } from 'esbuild';

const effects = [],
  requests = [];
let slots = [],
  cursor = 0,
  reveal;
globalThis.__miniProfileEffects = effects;
globalThis.__miniProfileState = (value) => {
  const index = cursor++;
  if (!(index in slots))
    slots[index] = typeof value === 'function' ? value() : value;
  return [
    slots[index],
    (next) => {
      slots[index] = typeof next === 'function' ? next(slots[index]) : next;
    },
  ];
};
globalThis.__miniProfilePrepare = () =>
  new Promise((resolve) => {
    reveal = resolve;
  });
globalThis.__miniProfileRequest = async (url) => {
  const request = new URL(url, 'https://noctgram.test');
  requests.push(request);
  if (request.searchParams.get('action') === 'profile')
    return {
      id: request.searchParams.get('id'),
      name: 'Styled profile',
      handle: 'styled',
      premium: true,
      profileBackground: '{}',
      cover: '',
      avatar: '',
    };
  return {
    gifts: [],
    items: [],
    next: null,
    messages: 2,
    sent: 1,
    received: 1,
    first: 1,
    photos: 0,
    videos: 0,
    files: 0,
    audio: 0,
  };
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
            path === './gratitude-badge' ||
            !importer
              .replaceAll('\\', '/')
              .endsWith('/app/chat-peer-profile.tsx')
              ? undefined
              : { path, namespace: 'fixture' },
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'react'
              ? `export const useState = globalThis.__miniProfileState;
             export const useRef = current => useState(() => ({current}))[0];
             export const useEffect = effect => globalThis.__miniProfileEffects.push(effect);
             export const useLayoutEffect = () => {};`
              : `export const Dialog='Dialog', DialogContent='DialogContent', DialogDescription='DialogDescription', DialogTitle='DialogTitle',
             Avatar='Avatar', DisplayName='DisplayName', GiftAnimation='GiftAnimation', ChatEmojiText='ChatEmojiText',
             ProfileLink='ProfileLink', ChatPeerPresence='ChatPeerPresence', ChatVideoPlayer='ChatVideoPlayer';
             export const appearanceStyle=()=>({}), useProfileBackground=person=>person.profileBackground ? {'--surface-first':'#ffaa88'} : undefined, giftDefinition=()=>null, chatFileSize=()=>'';
             export const prepareProfileVisuals=(...args)=>globalThis.__miniProfilePrepare(...args);
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
  slots = [];
  cursor = 0;
  const dialog = ChatProfileDialog({
    person: { id, name: id, handle: id },
    viewerId: 'alice',
    chatPeerId: 'bob',
    open: true,
    onOpenChange: () => {},
  });
  const body = dialog.props.children.props.children;
  slots = [];
  cursor = 0;
  const render = () => {
    cursor = 0;
    return body.type(body.props);
  };
  let content = render();
  assert.match(content.props.className, /peer-profile-loading/);
  assert.equal(
    nodes(content).some((node) => node.type === 'Avatar'),
    false,
    'Do not expose the undecorated chat identity before the full profile loads',
  );
  const cleanup = effects.map((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve));
  content = render();
  assert.match(
    content.props.className,
    /peer-profile-loading/,
    'Keep the placeholder while the banner and palette are being prepared',
  );
  reveal();
  await new Promise((resolve) => setImmediate(resolve));
  content = render();
  assert.match(content.props.className, /peer-profile-ready/);
  assert.equal(content.props['data-profile-background'], true);
  assert.equal(content.props.style['--surface-first'], '#ffaa88');
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
delete globalThis.__miniProfileState;
delete globalThis.__miniProfilePrepare;
console.log(
  'Chat mini-profile: own/peer identity and gifts, current conversation statistics and media passed.',
);
