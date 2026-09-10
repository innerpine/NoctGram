import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['lib/chat-composer-text.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { insertComposerEmoji } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64')
);

assert.deepEqual(insertComposerEmoji('Привет!', '😊', 6, 6), {
  text: 'Привет😊!',
  caret: 8,
});
assert.deepEqual(insertComposerEmoji('Привет друг', '👋🏽', 7, 11), {
  text: 'Привет 👋🏽',
  caret: 11,
});
const family = '👨‍👩‍👧‍👦';
assert.deepEqual(insertComposerEmoji('', family, 0, 0), {
  text: family,
  caret: family.length,
});
assert.equal(insertComposerEmoji('a'.repeat(3999), '😊', 3999, 3999), null);
assert.equal(
  insertComposerEmoji('a'.repeat(4000), family, 3989, 4000).text.length,
  4000,
);
assert.deepEqual(insertComposerEmoji('новый', '❤️', 99, 99), {
  text: 'новый❤️',
  caret: 7,
});
