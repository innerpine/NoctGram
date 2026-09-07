import assert from 'node:assert/strict';
// Only the isolated local Worker: no changes to the developer's account.
const base = 'http://127.0.0.1:8787/api/social';
const run = Date.now();
const owner = 'connections_owner_' + run;
const reader = 'connections_reader_' + run;
const outsider = 'connections_outsider_' + run;
const headers = (user) => ({
  'oai-authenticated-user-id': user,
  'oai-authenticated-user-email': user + '@example.com',
  'Content-Type': 'application/json',
});
async function api(user, query = '', body) {
  const response = await fetch(base + query, {
    headers: user ? headers(user) : {},
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
async function ok(user, query = '', body) {
  const result = await api(user, query, body);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
const list = (user, id, kind, after = '') =>
  ok(
    user,
    '?' + new URLSearchParams({ action: 'connections', id, kind, after }),
  );
const follow = (user, id, value = true) =>
  ok(user, '', { action: 'follow', id, value });
for (const user of [owner, reader, outsider])
  await ok(user, '?action=bootstrap');
assert.equal(
  (await api(null, '?action=connections&kind=followers')).status,
  401,
);
assert.equal(
  (await api(owner, '?action=connections&kind=invalid')).status,
  400,
);
assert.equal(
  (await api(owner, '?action=connections&kind=followers&id=missing_' + run))
    .status,
  404,
);
assert.deepEqual(await list(owner, owner, 'followers'), {
  people: [],
  hasMore: false,
  nextCursor: null,
});
assert.equal((await list(outsider, owner, 'following')).people.length, 0);
await follow(reader, owner);
await follow(reader, owner); // Idempotent relationship, no duplicate people.
await follow(owner, reader);
const channel = await ok(owner, '', {
  action: 'createChannel',
  name: 'Канал списка',
  handle: 'list_' + run,
  bio: '',
});
await follow(owner, channel.id);
const following = await list(outsider, owner, 'following');
assert.deepEqual(
  following.people.map((p) => p.id).sort((a, b) => a.localeCompare(b)),
  [reader, channel.id].sort((a, b) => a.localeCompare(b)),
);
assert.equal(following.people.find((p) => p.id === channel.id).kind, 'channel');
assert.deepEqual(
  (await list(reader, channel.id, 'followers')).people.map((p) => p.id),
  [owner],
);
assert.deepEqual(
  (await list(owner, owner, 'followers')).people.map((p) => p.id),
  [reader],
);
assert.ok(!following.people.some((p) => p.id === outsider));
const followers = [reader];
for (let i = 0; i < 32; i++) {
  const user = 'connections_fan_' + run + '_' + String(i).padStart(2, '0');
  await ok(user, '?action=profile');
  await follow(user, owner);
  followers.push(user);
}
const first = await list(outsider, owner, 'followers');
assert.equal(first.people.length, 30);
assert.equal(first.hasMore, true);
assert.equal(first.nextCursor, first.people.at(-1).id);
const second = await list(outsider, owner, 'followers', first.nextCursor);
assert.equal(second.people.length, 3);
assert.equal(second.hasMore, false);
assert.equal(second.nextCursor, null);
const ids = [...first.people, ...second.people].map((p) => p.id);
assert.equal(new Set(ids).size, 33);
assert.deepEqual(new Set(ids), new Set(followers));
assert.deepEqual(
  await list(owner, owner, 'followers'),
  first,
  'Own and other profiles expose the same relationships',
);
assert.equal((await ok(owner, '?action=profile')).followers, ids.length);
assert.equal(
  (await ok(owner, '?action=profile')).following,
  following.people.length,
);
assert.deepEqual(
  Object.keys(first.people[0]).sort((a, b) => a.localeCompare(b)),
  ['id', 'name', 'avatar', 'handle', 'kind'].sort((a, b) => a.localeCompare(b)),
);
await follow(first.people[0].id, owner, false);
assert.deepEqual(
  (await list(outsider, owner, 'followers', first.nextCursor)).people,
  second.people,
  'Removal before the cursor does not skip later people',
);
await ok(reader, '', { action: 'handle', handle: 'renamed_' + run });
assert.equal(
  (await list(outsider, owner, 'following')).people.find((p) => p.id === reader)
    .handle,
  'renamed_' + run,
);
assert.equal(
  (await list(outsider, owner, 'followers', "' OR 1=1 --")).people.length,
  30,
  'Cursor remains a bound value',
);
console.log(
  'PASS: own/other followers and following, channels, empty states, authentication, invalid profiles/kinds, no duplicates, 30-item cursor pagination, profile counts, updated handles and removal between pages.',
);
