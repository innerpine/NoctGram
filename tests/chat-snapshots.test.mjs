import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['lib/chat-snapshots.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { createChatSnapshots } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const snapshot = (id, revision = 1) => ({
  messages: [{ id }],
  theme: { shared: 'ocean', personal: null, revision },
  access: { allowed: true, blockedByMe: false },
});

void test('keeps each conversation and its theme together; late responses cannot overwrite a newer read', () => {
  const cache = createChatSnapshots();
  cache.reset('owner');
  const old = cache.begin('a'),
    b = cache.begin('b'),
    latest = cache.begin('a');
  cache.save(snapshot('b'), b);
  cache.save(snapshot('new-a'), latest);
  assert.equal(cache.save(snapshot('old-a'), old), undefined);
  assert.equal(cache.get('a').messages[0].id, 'new-a');
  assert.equal(cache.get('b').messages[0].id, 'b');
  cache.updateTheme('a', { shared: 'rose', personal: null, revision: 4 });
  cache.save(snapshot('updated-a', 2), cache.begin('a'));
  assert.equal(cache.get('a').theme.shared, 'rose');
  assert.equal(cache.get('a').messages[0].id, 'updated-a');
});
void test('account changes, logout, and a return to the same account reject old work', () => {
  const cache = createChatSnapshots();
  cache.reset('a');
  const old = cache.begin('peer');
  cache.save(snapshot('private-a'), old);
  cache.reset('b');
  assert.equal(cache.get('peer'), undefined);
  cache.save(snapshot('private-b'), cache.begin('peer'));
  assert.equal(cache.get('peer', old.generation), undefined);
  assert.equal(cache.save(snapshot('late-a'), old), undefined);
  cache.reset('a');
  assert.equal(cache.save(snapshot('late-return'), old), undefined);
  cache.reset('');
  assert.equal(
    cache.save(snapshot('logged-out'), cache.begin('peer')),
    undefined,
  );
});
void test('mutations invalidate saved messages and unfinished reads before reloading', () => {
  const cache = createChatSnapshots();
  cache.reset('me');
  const old = cache.begin('peer');
  cache.save(snapshot('deleted-message'), old);
  cache.remove('peer');
  assert.equal(cache.get('peer'), undefined);
  assert.equal(cache.save(snapshot('deleted-message'), old), undefined);
  cache.save({ ...snapshot('unused'), messages: [] }, cache.begin('peer'));
  assert.deepEqual(cache.get('peer').messages, []);
});
void test('retains at most twenty recently used conversations', () => {
  const cache = createChatSnapshots();
  cache.reset('me');
  for (let i = 0; i < 20; i++)
    cache.save(snapshot(String(i)), cache.begin(String(i)));
  cache.get('0');
  cache.save(snapshot('20'), cache.begin('20'));
  assert.equal(cache.get('1'), undefined);
  assert.equal(cache.get('0').messages[0].id, '0');
  assert.equal(cache.get('20').messages[0].id, '20');
});
