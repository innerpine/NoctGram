import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({
  entryPoints: ['lib/chat-outbox.ts', 'lib/chat-emoji.ts'],
  bundle: true,
  write: false,
  outdir: 'unused',
  platform: 'node',
  format: 'esm',
});
const modules = await Promise.all(
  outputFiles.map(
    (file) =>
      import(
        'data:text/javascript;base64,' +
          Buffer.from(file.text).toString('base64')
      ),
  ),
);
const { createChatOutbox, mergeOutgoing } = modules[0];
const { chatEmojiParts, largeEmojiCount, appleEmojiUrl } = modules[1];
const calls = [];
const outbox = createChatOutbox(
  (body) =>
    new Promise((resolve, reject) => calls.push({ body, resolve, reject })),
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
let changes = 0;
const unsubscribe = outbox.subscribe(() => changes++);
const file = {
  id: 'photo',
  name: 'Photo',
  type: 'image/png',
  kind: 'image',
  size: 10,
};
const reply = {
  id: 'original',
  name: 'Bob',
  sender: 'bob',
  text: 'Привет',
  unavailable: false,
};
const first = outbox.enqueue('alice', 'bob', {
  text: ' Один 😀 ',
  attachments: [file],
  reply,
});
assert.equal(outbox.getSnapshot()[0].message.text, 'Один 😀');
assert.equal(outbox.getSnapshot()[0].status, 'sending');
assert.equal(changes, 1, 'Published synchronously before any response');
const second = outbox.enqueue('alice', 'bob', { text: 'Следующее сообщение' });
assert.equal(
  outbox.getSnapshot().length,
  2,
  'Next draft can send while first is pending',
);
assert.equal(
  calls.length,
  1,
  'Requests in one conversation preserve send order',
);
file.name = 'changed';
reply.text = 'changed';
assert.equal(outbox.getSnapshot()[0].message.attachments[0].name, 'Photo');
assert.equal(outbox.getSnapshot()[0].message.reply.text, 'Привет');
const firstBody = calls[0].body;
assert.deepEqual(firstBody.attachments, ['photo']);
assert.equal(firstBody.replyTo, 'original');
assert.equal(firstBody.expectedSender, 'alice');
unsubscribe();
calls[0].resolve({ id: first });
await tick();
assert.equal(
  outbox.getSnapshot()[0].status,
  'sent',
  'Send survives conversation unmount',
);
assert.equal(calls.length, 2);
calls[1].reject(new TypeError('Network lost'));
await tick();
assert.equal(outbox.getSnapshot()[1].status, 'failed');
outbox.retry(second, 'other-account');
assert.equal(calls.length, 2, 'Cannot retry another account’s message');
outbox.retry(second, 'alice');
outbox.retry(second, 'alice');
assert.equal(calls.length, 3, 'Double retry starts only one request');
assert.deepEqual(
  calls[1].body,
  calls[2].body,
  'Retry retains exact key and content',
);
// Polling may receive the saved message while its POST response is still lost.
const canonical = { ...outbox.getSnapshot()[1].message, read: 1 };
const merged = mergeOutgoing([canonical], outbox.getSnapshot());
assert.equal(merged.length, 2);
assert.equal(
  merged.find((message) => message.id === canonical.id),
  canonical,
  'Canonical server message wins, including read state',
);
outbox.acknowledge([canonical]);
calls[2].reject(new TypeError('Late network error'));
await tick();
assert.equal(
  outbox.getSnapshot().length,
  1,
  'Late errors never resurrect an acknowledged message',
);
outbox.acknowledge([outbox.getSnapshot()[0].message]);
assert.equal(outbox.getSnapshot().length, 0);
const a = outbox.enqueue('alice', 'bob', { text: 'Одинаковый текст' });
const b = outbox.enqueue('alice', 'bob', { text: 'Одинаковый текст' });
assert.notEqual(a, b, 'Intentional repeated messages remain distinct');
assert.ok(
  outbox.getSnapshot()[0].message.created <
    outbox.getSnapshot()[1].message.created,
);
for (const [text, expected] of [
  ['😀', '1f600'],
  ['❤', '2764-fe0f'],
  ['❤️', '2764-fe0f'],
  ['👍🏽', '1f44d-1f3fd'],
  ['👨‍👩‍👧‍👦', '1f468-200d-1f469-200d-1f467-200d-1f466'],
  ['🇺🇦', '1f1fa-1f1e6'],
  ['1️⃣', '0031-fe0f-20e3'],
]) {
  assert.deepEqual(chatEmojiParts(text), [{ text, unified: expected }]);
  assert.ok(appleEmojiUrl(expected).endsWith('/' + expected + '.png'));
}
assert.equal(
  chatEmojiParts('❤︎')[0].unified,
  undefined,
  'Explicit text presentation stays text',
);
assert.equal(chatEmojiParts('© 1 abc')[0].text, '©');
assert.equal(largeEmojiCount('😀\n😀\n😀\n😀'), 4);
assert.equal(largeEmojiCount('👍🏽 👨‍👩‍👧‍👦 🇺🇦'), 3);
assert.equal(largeEmojiCount('Текст 😀'), 0);
assert.equal(largeEmojiCount('😀'.repeat(7)), 0);
const premiumMixed = 'Привет :noct_fire: 😀 :noct_unknown: @alice';
const premiumParts = chatEmojiParts(premiumMixed);
assert.equal(premiumParts.map((part) => part.text).join(''), premiumMixed);
assert.equal(premiumParts.filter((part) => part.premium).length, 1);
assert.equal(premiumParts.find((part) => part.premium).premium.name, 'fire');
assert.ok(
  premiumParts.some(
    (part) => part.text.includes(':noct_unknown:') && !part.premium,
  ),
);
assert.equal(largeEmojiCount(':noct_fire: 😀 :noct_heart:'), 3);
assert.equal(largeEmojiCount(':noct_fire:'.repeat(7)), 0);
assert.equal(largeEmojiCount('Текст :noct_fire:'), 0);
const mixed = 'Привет @alice 👨‍👩‍👧‍👦 ❤️\nhttps://soundcloud.com/a/b';
assert.equal(
  chatEmojiParts(mixed)
    .map((part) => part.text)
    .join(''),
  mixed,
  'Original text/copy payload is lossless',
);
console.log(
  'Outbox: instant feedback, ordered sends, navigation, failure/retry, reconciliation, account isolation; emoji sequences passed.',
);
