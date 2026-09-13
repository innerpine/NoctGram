import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['lib/comment-threads.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { commentThreads } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const comment = (id, created, replyTo = null) => ({ id, created, replyTo });
const positions = (rows) =>
  commentThreads(rows).map(({ comment, depth }) => [comment.id, depth]);

await test('a later reply stays under its parent before the next conversation', () => {
  const input = Object.freeze([
    Object.freeze(comment('first', 1)),
    Object.freeze(comment('second', 2)),
    Object.freeze(comment('reply-second', 3, 'second')),
    Object.freeze(comment('reply-first', 4, 'first')),
  ]);
  assert.deepEqual(positions(input), [
    ['first', 0],
    ['reply-first', 1],
    ['second', 0],
    ['reply-second', 1],
  ]);
  assert.deepEqual(
    input.map((c) => c.id),
    ['first', 'second', 'reply-second', 'reply-first'],
  );
});

await test('nested conversations stay together, with chronological siblings and stable ties', () => {
  const rows = [
    comment('second-reply', 4, 'parent'),
    comment('nested-b', 5, 'first-reply'),
    comment('other-parent', 2),
    comment('nested-a', 5, 'first-reply'),
    comment('first-reply', 3, 'parent'),
    comment('parent', 1),
  ];
  assert.deepEqual(positions(rows), [
    ['parent', 0],
    ['first-reply', 1],
    ['nested-a', 2],
    ['nested-b', 2],
    ['second-reply', 1],
    ['other-parent', 0],
  ]);
});

await test('replies remain readable before their parent page loads, then join that parent', () => {
  const page = [comment('other-parent', 2), comment('reply', 3, 'old-parent')];
  assert.deepEqual(positions(page), [
    ['other-parent', 0],
    ['reply', 0],
  ]);
  assert.deepEqual(positions([...page, comment('old-parent', 1)]), [
    ['old-parent', 0],
    ['reply', 1],
    ['other-parent', 0],
  ]);
});

await test('deleting a parent preserves every reply and its descendants', () => {
  const rows = [
    comment('parent', 1),
    comment('reply', 2, 'parent'),
    comment('nested', 3, 'reply'),
    comment('other-parent', 4),
  ];
  assert.deepEqual(positions(rows.filter((c) => c.id !== 'parent')), [
    ['reply', 0],
    ['nested', 1],
    ['other-parent', 0],
  ]);
});

await test('overlapping pages render a comment only once and retain its content', () => {
  const parent = { ...comment('parent', 1), text: 'Original', reply: null };
  const reply = {
    ...comment('reply', 2, 'parent'),
    text: 'Answer',
    reply: { name: 'Author' },
  };
  const rows = commentThreads([reply, parent, reply]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].comment, parent);
  assert.equal(rows[1].comment, reply);
  assert.deepEqual(positions([]), []);
});

await test('malformed self references and cycles cannot hide comments or loop forever', () => {
  const rows = [
    comment('self', 1, 'self'),
    comment('a', 2, 'b'),
    comment('b', 3, 'a'),
    comment('child', 4, 'b'),
  ];
  const result = positions(rows);
  assert.equal(result.length, rows.length);
  assert.deepEqual(
    new Set(result.map(([id]) => id)),
    new Set(rows.map((c) => c.id)),
  );
});

await test('long reply chains do not exhaust the call stack', () => {
  const rows = Array.from({ length: 12000 }, (_, i) =>
    comment(String(i), i, i ? String(i - 1) : null),
  );
  const result = positions(rows);
  assert.equal(result.length, rows.length);
  assert.deepEqual(result.at(-1), ['11999', 11999]);
});
