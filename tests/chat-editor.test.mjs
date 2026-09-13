import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './lib/chat-editor-changes'; export * from './lib/chat-editor-emoji'; export * from './lib/chat-emoji'; export { createEditor, $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, TextNode } from 'lexical';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const {
  createEditor,
  ChatEmojiNode,
  $transformChatEmoji,
  TextNode,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
} = api;
const editor = createEditor({
  namespace: 'emoji-test',
  nodes: [ChatEmojiNode],
  onError(error) {
    throw error;
  },
});
const unregister = editor.registerNodeTransform(TextNode, $transformChatEmoji);
const text = 'Привет 😀❤️ 👍🏽 👨‍👩‍👧‍👦 🇺🇦';
editor.update(
  () => {
    $getRoot().append($createParagraphNode().append($createTextNode(text)));
    $getRoot().selectEnd();
  },
  { discrete: true },
);
editor.getEditorState().read(() => {
  assert.equal(
    $getRoot().getTextContent(),
    text,
    'Emoji transformation preserves the send/copy payload',
  );
  const emoji = $getRoot()
    .getAllTextNodes()
    .filter((node) => node instanceof ChatEmojiNode);
  assert.equal(emoji.length, 5);
  assert.ok(
    emoji.every((node) => node.isToken()),
    'Joined sequences delete as one emoji',
  );
  assert.equal(
    api.$getSelection().anchor.offset,
    4,
    'Caret stays after the complete flag',
  );
});
const serialized = JSON.stringify(editor.getEditorState().toJSON());
editor.setEditorState(editor.parseEditorState(serialized));
editor.getEditorState().read(() => {
  assert.equal($getRoot().getTextContent(), text);
  assert.equal(
    $getRoot()
      .getAllTextNodes()
      .filter((node) => node instanceof ChatEmojiNode).length,
    5,
  );
});
assert.ok(
  api.appleEmojiUrl('1f923', true).endsWith('/img-apple-160/1f923.png'),
);
assert.ok(api.appleEmojiUrl('1f923').includes('/apple/64/'));
unregister();
const changes = [],
  limits = [];
const cleanup = api.registerChatTextChanges(editor, {
  change: (value) => changes.push(value),
  limit: (reason) => limits.push(reason),
});
function replace(value, external = false) {
  editor.update(
    () => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode(value)));
    },
    { discrete: true, ...(external ? { tag: 'external-draft' } : {}) },
  );
}
replace('x'.repeat(4100), true);
for (let i = 0; i < 100; i++)
  editor.update(
    () => {
      $getRoot()
        .getFirstDescendant()
        .select(i, i + 1);
    },
    { discrete: true },
  );
assert.equal(
  changes.length,
  0,
  'Selection-only updates do not echo a draft into React',
);
assert.equal(
  limits.length,
  0,
  'Selection of an old long draft never recursively restores state',
);
replace('x'.repeat(4099));
assert.equal(
  changes.at(-1).length,
  4099,
  'Oversized legacy drafts can be shortened',
);
replace('valid', true);
replace('x'.repeat(4001));
assert.deepEqual(limits, ['length'], 'Oversized paste rolls back exactly once');
assert.equal(
  editor.getEditorState().read(() => $getRoot().getTextContent()),
  'valid',
);
cleanup();
console.log(
  'Chat editor: lossless Unicode, atomic complex emoji, caret, serialization and high-resolution artwork passed.',
);
