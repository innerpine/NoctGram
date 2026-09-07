import assert from 'node:assert/strict';
// Isolated local Worker only, migrations 0000–0006 + moderation.sql fixture.
const base = 'http://127.0.0.1:8787',
  stamp = Date.now();
const a = 'privacy_a_' + stamp,
  b = 'privacy_b_' + stamp,
  c = 'privacy_c_' + stamp,
  mod = 'mod_qa_admin';
const auth = (id) => ({
  'oai-authenticated-user-id': id,
  'oai-authenticated-user-email': id + '@example.com',
});
async function api(id, query = '', body) {
  const r = await fetch(base + '/api/social' + query, {
    headers: { ...auth(id), 'Content-Type': 'application/json', Origin: base },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
async function ok(id, query = '', body) {
  const r = await api(id, query, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const act = (id, body) => ok(id, '', body);
const settings = (id, messagePolicy = 'everyone', hideAdult = false) =>
  act(id, { action: 'privacy', messagePolicy, hideAdult });
const block = (id, target, value) =>
  act(id, { action: 'blockUser', id: target, value });
const send = (id, target, text) =>
  api(id, '', { action: 'message', id: target, text });
const history = (id, peer) => ok(id, '?action=messages&peer=' + peer);
const follows = (id, target) =>
  act(id, { action: 'follow', id: target, value: true });
async function post(id, text, extra = {}) {
  await act(id, { action: 'post', text, ...extra });
  const row = (await ok(id, '?action=feed&user=' + (extra.as || id))).find(
    (p) => p.text === text,
  );
  assert.ok(row);
  return row;
}
const users = {};
for (const u of [a, b, c, mod])
  users[u] = (await ok(u, '?action=bootstrap')).me;
assert.deepEqual(await ok(a, '?action=privacy'), {
  hideAdult: false,
  messagePolicy: 'everyone',
  blocked: [],
});
for (const body of [
  { hideAdult: 1, messagePolicy: 'everyone' },
  { hideAdult: false, messagePolicy: ['everyone'] },
  { hideAdult: false, messagePolicy: 'invalid' },
])
  assert.equal((await api(a, '', { action: 'privacy', ...body })).status, 400);
await act(a, {
  action: 'privacy',
  id: b,
  userId: b,
  messagePolicy: 'nobody',
  hideAdult: true,
});
assert.equal(
  (await ok(b, '?action=privacy&id=' + a)).messagePolicy,
  'everyone',
);
const publicProfile = await ok(b, '?action=profile&id=' + a);
assert.equal(publicProfile.messagePolicy, undefined);
assert.equal(publicProfile.hideAdult, undefined);
await settings(a);
assert.equal((await send(b, a, 'Evidence ' + stamp)).status, 200);
assert.equal(
  (await send(b, a, 'Neighbour stays private ' + stamp)).status,
  200,
);
const original = (await history(a, b))[0];
await settings(a, 'following');
assert.equal((await send(b, a, 'denied')).status, 403);
await follows(b, a);
assert.equal(
  (await send(b, a, 'self subscription is not permission')).status,
  403,
);
await follows(a, b);
assert.equal((await send(b, a, 'allowed followed sender')).status, 200);
await settings(a, 'nobody');
assert.equal((await send(b, a, 'existing chat also denied')).status, 403);
assert.equal((await ok(b, '?action=messageAccess&peer=' + a)).allowed, false);
await settings(a);
const channel = await act(b, {
  action: 'createChannel',
  name: 'Privacy channel',
  handle: 'privchan_' + stamp,
  bio: '',
});
const p = await post(b, 'Blocked author #' + stamp);
const cp = await post(b, 'Blocked channel ' + stamp, { as: channel.id });
const publicPost = await post(c, 'Public discussion ' + stamp);
const comment = await act(b, {
  action: 'comment',
  id: publicPost.id,
  text: 'Hidden commenter',
});
await act(a, { action: 'save', id: p.id, value: true });
await follows(a, channel.id);
await block(a, b, true);
await block(a, b, true);
assert.equal((await ok(a, '?action=privacy')).blocked.length, 1);
assert.equal(
  (await api(a, '', { action: 'blockUser', id: a, value: true })).status,
  400,
);
assert.equal((await send(a, b, 'blocked direction one')).status, 403);
assert.equal((await send(b, a, 'blocked direction two')).status, 403);
assert.equal((await send(c, b, 'third user unaffected')).status, 200);
assert.equal(
  (await ok(a, '?action=messageAccess&peer=' + b)).blockedByMe,
  true,
);
assert.ok((await history(a, b)).some((m) => m.id === original.id));
for (const u of [a, b])
  assert.equal(
    (await api(u, '', { action: 'follow', id: u === a ? b : a, value: true }))
      .status,
    403,
  );
assert.equal(
  (await api(a, '', { action: 'follow', id: channel.id, value: true })).status,
  403,
);
for (const suffix of [
  '',
  '&mode=saved',
  '&q=' + stamp,
  '&user=' + b,
  '&user=' + channel.id,
]) {
  const rows = await ok(a, '?action=feed' + suffix);
  assert.ok(!rows.some((r) => r.id === p.id || r.id === cp.id));
}
assert.equal((await api(a, '?action=post&id=' + p.id)).status, 404);
assert.equal(
  (await api(a, '', { action: 'comment', id: p.id, text: 'stale id' })).status,
  404,
);
assert.ok(
  !(await ok(a, '?action=comments&post=' + publicPost.id)).some(
    (r) => r.id === comment.id,
  ),
);
assert.equal((await ok(a, '?action=post&id=' + publicPost.id)).comments, 0);
assert.equal((await ok(c, '?action=post&id=' + publicPost.id)).comments, 1);
assert.ok(
  !(await ok(a, '?action=people&q=' + users[b].handle)).some((r) => r.id === b),
);
assert.ok(
  !(await ok(a, '?action=channels&q=' + channel.handle)).some(
    (r) => r.id === channel.id,
  ),
);
assert.ok(
  (await ok(a, '?action=privacyPeople&q=' + users[b].handle)).some(
    (r) => r.id === b && r.blockedByMe,
  ),
);
assert.ok(!(await ok(a, '?action=topics')).some((r) => r.tag === '#' + stamp));
assert.equal((await ok(c, '?action=post&id=' + cp.id)).id, cp.id);
await act(a, {
  action: 'reportMessage',
  id: original.id,
  reason: 'Unwanted message',
});
for (const u of [b, c, mod])
  assert.equal(
    (
      await api(u, '', {
        action: 'reportMessage',
        id: original.id,
        reason: 'forged',
      })
    ).status,
    404,
  );
assert.equal((await api(a, '?action=moderationReports')).status, 403);
const report = (await ok(mod, '?action=moderationReports&status=all')).find(
  (r) => r.targetId === original.id,
);
assert.ok(report);
assert.equal(report.targetType, 'message');
assert.equal(report.available, 1);
assert.equal(report.authorId, b);
assert.equal(report.text, original.text);
assert.deepEqual(Object.keys(JSON.parse(report.snapshot)).sort(), [
  'created',
  'id',
  'sender',
  'text',
]);
await act(mod, {
  action: 'reviewReport',
  id: report.id,
  status: 'closed',
  expectedStatus: 'new',
  note: 'Reviewed',
});
await act(a, {
  action: 'reportMessage',
  id: original.id,
  reason: 'Duplicate must not overwrite',
});
const duplicate = (
  await ok(mod, '?action=moderationReports&status=closed')
).find((r) => r.id === report.id);
assert.equal(duplicate.reason, 'Unwanted message');
await block(a, b, false);
await block(a, b, false);
assert.equal((await ok(a, '?action=profile&id=' + b)).followed, 0);
assert.equal((await ok(b, '?action=profile&id=' + a)).followed, 0);
assert.equal((await ok(a, '?action=profile&id=' + channel.id)).followed, 0);
assert.equal((await send(b, a, 'unblocked')).status, 200);
assert.equal((await ok(a, '?action=post&id=' + p.id)).id, p.id);
await Promise.all([
  block(a, b, true),
  ...Array.from({ length: 8 }, () =>
    api(b, '', { action: 'follow', id: a, value: true }),
  ),
  ...Array.from({ length: 8 }, () => send(b, a, 'concurrent attempt')),
]);
assert.equal((await ok(b, '?action=profile&id=' + a)).followed, 0);
assert.equal((await send(b, a, 'after block completed')).status, 403);
await block(a, b, false);
assert.equal((await ok(b, '?action=profile&id=' + a)).followed, 0);
// Real image upload exercises the actual adult flag (text-only posts cannot set it).
const form = new FormData();
form.set(
  'file',
  new File(
    [
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
        'base64',
      ),
    ],
    'privacy.png',
    { type: 'image/png' },
  ),
);
const uploaded = await fetch(base + '/api/upload', {
  method: 'POST',
  headers: auth(b),
  body: form,
});
assert.equal(uploaded.status, 200);
const media = await uploaded.json();
const adult = await post(b, 'Sensitive #' + stamp + 'adult', {
  media: [media.id],
  adult: true,
});
await act(a, { action: 'save', id: adult.id, value: true });
await settings(a, 'everyone', true);
for (const suffix of [
  '',
  '&mode=saved',
  '&q=' + stamp,
  '&user=' + b,
  '&media=1',
])
  assert.ok(
    !(await ok(a, '?action=feed' + suffix)).some((p) => p.id === adult.id),
  );
assert.equal((await api(a, '?action=post&id=' + adult.id)).status, 404);
assert.ok(
  !(await ok(a, '?action=topics')).some((t) => t.tag === '#' + stamp + 'adult'),
);
assert.equal((await ok(c, '?action=post&id=' + adult.id)).adult, 1);
await settings(a);
assert.equal((await ok(a, '?action=post&id=' + adult.id)).id, adult.id);
// Read-only accounts can still protect themselves and report received messages.
await act(mod, {
  action: 'moderate',
  id: a,
  mode: 'read_only',
  reason: 'Privacy QA',
  minutes: null,
});
await settings(a, 'nobody');
await block(a, b, true);
await act(a, {
  action: 'reportMessage',
  id: original.id,
  reason: 'Still available read-only',
});
assert.equal((await send(a, c, 'readonly cannot send')).status, 403);
await act(mod, {
  action: 'moderate',
  id: a,
  mode: 'active',
  reason: 'QA complete',
  minutes: null,
});
console.log(
  'PASS privacy: settings ownership, DM policies, block both directions, channel/feed/comment filters, message-report isolation, duplicate evidence, 18+ filters, read-only protection.',
);
