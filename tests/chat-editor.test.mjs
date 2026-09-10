import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './lib/chat-editor-emoji'; export * from './lib/chat-emoji'; export { createEditor, $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, TextNode } from 'lexical';`,
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
console.log(
  'Chat editor: lossless Unicode, atomic complex emoji, caret, serialization and high-resolution artwork passed.',
);
