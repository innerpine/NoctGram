import assert from 'node:assert/strict';
import { reconcileSnapshot } from '../lib/reconcile-snapshot.ts';

const previous = Array.from({ length: 300 }, (_, i) => ({
  id: String(i),
  text: 'Сообщение ' + i,
  read: 0,
  gift: i % 3 ? undefined : { id: 'gift:' + i, price: 50 },
}));
const duplicate = structuredClone(previous);
assert.equal(
  reconcileSnapshot(previous, duplicate),
  previous,
  'Unchanged polling response keeps the whole message list',
);
duplicate[20].read = 1;
const updated = reconcileSnapshot(previous, duplicate);
assert.notEqual(updated, previous);
assert.equal(updated[20].read, 1);
assert.equal(
  updated.filter((item, i) => item === previous[i]).length,
  299,
  'One changed receipt preserves the other 299 messages',
);
assert.equal(previous[20].read, 0, 'Do not mutate prior React state');
const reversed = reconcileSnapshot(
  previous,
  [...previous].reverse().map((item) => structuredClone(item)),
);
assert.equal(
  reversed[0],
  previous.at(-1),
  'Row identity follows IDs when reordered',
);
assert.deepEqual(
  reconcileSnapshot(
    { allowed: true, blockedByMe: false },
    { allowed: false, blockedByMe: true },
  ),
  { allowed: false, blockedByMe: true },
);
assert.deepEqual(
  reconcileSnapshot(
    { profile: { private: 'secret', name: 'A' } },
    { profile: { name: 'A' } },
  ),
  { profile: { name: 'A' } },
  'Removed/private fields are actually removed',
);
assert.deepEqual(reconcileSnapshot([1, 2], [1]), [1]);
assert.deepEqual(reconcileSnapshot(null, { enabled: false }), {
  enabled: false,
});
assert.equal(reconcileSnapshot({ id: 'old' }, null), null);
console.log(
  'API snapshots: unchanged identity, 299/300 reused messages, reorder, removals, permission/read-state changes and immutable updates passed.',
);
