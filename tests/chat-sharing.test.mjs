import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Pure parts of quotes and forwarding: mapping a selection to stored text and
// the toast after forwarding to several chats.
const { outputFiles } = await build({
  entryPoints: ['lib/message-selection.ts', 'lib/forward-client.ts'],
  bundle: true,
  write: false,
  outdir: 'unused',
  platform: 'node',
  format: 'esm',
});
const [selection, forward] = await Promise.all(
  outputFiles.map(
    (file) =>
      import(
        'data:text/javascript;base64,' +
          Buffer.from(file.text).toString('base64')
      ),
  ),
);
const { matchQuote, selectionQuote, QUOTE_LIMIT } = selection;

// A quote is an exact fragment of the stored text, trimmed and limited.
const text = 'Встречаемся завтра в восемь у входа 🙂 :noct_moon:';
assert.equal(matchQuote(text, '  в восемь '), 'в восемь');
assert.equal(
  matchQuote(text, 'у входа 🙂 :noct_moon:'),
  'у входа 🙂 :noct_moon:',
);
assert.equal(
  matchQuote(text, 'в девять'),
  '',
  'Fragments must occur in the text',
);
assert.equal(matchQuote(text, '   '), '');
const long = '😀'.repeat(700);
const quote = matchQuote(long, long);
assert.ok(quote.length <= QUOTE_LIMIT);
assert.equal(quote, '😀'.repeat(512), 'Long quotes never split a character');
assert.equal(selectionQuote(null, text, null), '');
assert.equal(
  selectionQuote({ contains: () => true }, text, {
    isCollapsed: true,
    rangeCount: 1,
  }),
  '',
  'An empty selection is not a quote',
);
// Custom emoji images contribute their stored token through data-raw.
const emoji = {
  getAttribute: () => ':noct_moon:',
  replaceWith(value) {
    fragment.parts[1] = value;
  },
};
const fragment = {
  parts: ['у входа 🙂 ', emoji],
  querySelectorAll: () => [emoji],
  get textContent() {
    return this.parts
      .map((part) => (typeof part === 'string' ? part : ''))
      .join('');
  },
};
assert.equal(
  selectionQuote({ contains: () => true }, text, {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({
      commonAncestorContainer: {},
      cloneContents: () => fragment,
    }),
  }),
  'у входа 🙂 :noct_moon:',
);
assert.equal(
  selectionQuote({ contains: () => false }, text, {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({
      commonAncestorContainer: {},
      cloneContents: () => fragment,
    }),
  }),
  '',
  'Only a selection inside this message counts',
);

// Toasts name the chats and report partial failures.
const { forwardNotice, forwardTargetKey } = forward;
const saved = {
  key: 'dm:me',
  target: { dm: { peer: 'me' } },
  name: 'Избранное',
  saved: true,
};
const bob = { key: 'dm:bob', target: { dm: { peer: 'bob' } }, name: 'Bob' };
const group = {
  key: 'room:g',
  target: { room: { roomId: 'g' } },
  name: 'Друзья',
};
assert.equal(forwardTargetKey(group.target), 'room:g');
const ok = (choice) => ({ target: choice.target, ok: true, ids: ['x'] });
assert.equal(
  forwardNotice({ results: [ok(saved)] }, [saved]),
  'Сохранено в Избранное',
);
assert.equal(forwardNotice({ results: [ok(bob)] }, [bob]), 'Переслано: Bob');
assert.equal(
  forwardNotice({ results: [ok(bob), ok(group), ok(saved)] }, [
    bob,
    group,
    saved,
  ]),
  'Переслано в 3 чата',
);
assert.equal(
  forwardNotice(
    { results: [ok(bob), { target: group.target, ok: false, error: 'нет' }] },
    [bob, group],
  ),
  'Переслано в 1 из 2. Не удалось: Друзья',
);
console.log('Chat sharing: quote mapping, limits and forward notices passed.');
