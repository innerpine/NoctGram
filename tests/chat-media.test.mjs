import assert from 'node:assert/strict';
import { build } from 'esbuild';
let slots = [],
  cursor = 0;
globalThis.__mediaState = (initial) => {
  const index = cursor++;
  if (!(index in slots)) slots[index] = initial;
  return [
    slots[index],
    (value) => {
      slots[index] = value;
    },
  ];
};
const { outputFiles } = await build({
  entryPoints: ['app/chat-message-files.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'media-boundaries',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|@\/components\/ui\/dialog|\.\/chat-video-player|\.\/photo-viewer)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'react'
              ? 'export const useState=globalThis.__mediaState;'
              : path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx, Fragment="Fragment";'
                : 'export const Download="Download", File="File", ChatVideoPlayer="ChatVideoPlayer", PhotoViewer="PhotoViewer";',
        }));
      },
    },
  ],
});
const { ChatMessageFiles } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
const find = (tree, type, match = () => true) =>
  nodes(tree).find((node) => node.type === type && match(node.props));
for (const kind of ['image', 'video']) {
  slots = [];
  const stamp = {
    type: 'span',
    props: { className: 'message-time', children: '19:24' },
  };
  const props = {
    files: [
      { id: 'first', kind: 'image', name: 'First.png', size: 200 },
      { id: 'last', kind, name: 'Last', size: 300 },
    ],
    flush: true,
    metadata: stamp,
  };
  const render = () => {
    cursor = 0;
    return ChatMessageFiles(props);
  };
  const tree = render();
  const gallery = find(tree, 'div', (props) =>
    props.className.includes('chat-message-files'),
  );
  assert.equal(nodes(gallery.props.children[0]).includes(stamp), false);
  if (kind === 'video') {
    const player = find(gallery, 'ChatVideoPlayer');
    assert.equal(player.props.src, '/api/media/last');
    assert.equal(player.props.name, 'Last');
    assert.equal(player.props.metadata, stamp);
    assert.equal(player.props.flush, true);
  } else {
    assert.equal(nodes(gallery).filter((node) => node === stamp).length, 1);
    assert.equal(nodes(gallery.props.children[1]).includes(stamp), true);
  }
  find(gallery, 'button').props.onClick();
  let modal = find(render(), 'PhotoViewer');
  assert.equal(modal.props.open, true);
  assert.equal(modal.props.src, '/api/media/first');
  assert.equal(find(modal, 'a').props.download, 'First.png');
  modal.props.onOpenChange(false);
  modal = find(render(), 'PhotoViewer');
  assert.equal(modal.props.open, false);
  assert.equal(
    modal.props.src,
    '/api/media/first',
    'The photo stays visible during the exit animation',
  );
  modal.props.onOpenChangeComplete(false);
  assert.equal(find(render(), 'PhotoViewer').props.src, '');
}
delete globalThis.__mediaState;
console.log(
  'Chat media: single overlay on last attachment, video controls/download and photo dialog lifecycle passed.',
);
