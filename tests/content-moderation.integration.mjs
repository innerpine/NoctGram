import assert from 'node:assert/strict';
// Only the isolated local Worker with tests/fixtures/moderation.sql, migrations 0000–0005.
const base = 'http://127.0.0.1:8787',
  run = Date.now(),
  mod = 'mod_qa_admin',
  owner = 'content_owner_' + run,
  reader = 'content_reader_' + run;
const headers = (u) => ({
  'oai-authenticated-user-id': u,
  'oai-authenticated-user-email': u + '@example.com',
});
async function api(u, query = '', body) {
  const r = await fetch(base + '/api/social' + query, {
    headers: {
      ...headers(u),
      'Content-Type': 'application/json',
      Origin: base,
    },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
async function ok(u, query = '', body) {
  const r = await api(u, query, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const action = (u, b) => ok(u, '', b);
const reports = (status = 'all') =>
  ok(mod, '?action=moderationReports&status=' + status);
async function post(as, text, media = []) {
  await action(owner, { action: 'post', as, text, media });
  return (
    await ok(owner, '?action=feed&user=' + encodeURIComponent(as || owner))
  ).find((p) => p.text === text);
}
async function image() {
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
      'content.png',
      { type: 'image/png' },
    ),
  );
  const r = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: headers(owner),
    body: form,
  });
  assert.equal(r.status, 200);
  return r.json();
}
async function fileStatus(url, u = reader) {
  const r = await fetch(base + url, { headers: headers(u) });
  await r.arrayBuffer();
  return r.status;
}
const restrict = (id, mode) =>
  action(mod, {
    action: 'moderate',
    id,
    mode,
    reason: 'QA channel decision',
    minutes: null,
  });
for (const u of [mod, owner, reader]) await ok(u, '?action=bootstrap');
const media = await image(),
  p = await post(owner, 'Reported publication ' + run, [media.id]);
const comment = await action(reader, {
  action: 'comment',
  id: p.id,
  text: 'Reported comment ' + run,
});
for (const target of [
  { targetType: 'post', id: p.id },
  { targetType: 'comment', id: comment.id },
]) {
  assert.equal(
    (
      await api(owner, '', {
        action: 'removeContent',
        ...target,
        reason: 'forged',
      })
    ).status,
    403,
  );
  assert.equal(
    (await api(mod, '', { action: 'removeContent', ...target, reason: '' }))
      .status,
    400,
  );
}
await action(reader, { action: 'report', id: p.id, reason: 'post violation' });
await action(owner, {
  action: 'reportComment',
  id: comment.id,
  reason: 'comment violation',
});
assert.equal(
  (
    await api(reader, '', {
      action: 'reportComment',
      id: comment.id,
      reason: 'own',
    })
  ).status,
  400,
);
assert.equal((await api(reader, '?action=moderationReports')).status, 403);
assert.equal((await api(reader, '?action=moderationRemovals')).status, 403);
const report = (await reports()).find((r) => r.targetId === p.id);
assert.equal(report.status, 'new');
assert.equal(
  (
    await api(reader, '', {
      action: 'reviewReport',
      id: report.id,
      expectedStatus: 'new',
      status: 'closed',
      note: 'forged',
    })
  ).status,
  403,
);
await action(mod, {
  action: 'reviewReport',
  id: report.id,
  expectedStatus: 'new',
  status: 'reviewing',
});
assert.equal(
  (await reports('reviewing')).find((r) => r.id === report.id).status,
  'reviewing',
);
assert.equal(
  (
    await api(mod, '', {
      action: 'reviewReport',
      id: report.id,
      expectedStatus: 'new',
      status: 'closed',
      note: 'stale',
    })
  ).status,
  409,
);
assert.equal(
  (
    await api(mod, '', {
      action: 'reviewReport',
      id: report.id,
      expectedStatus: 'reviewing',
      status: 'closed',
      note: '',
    })
  ).status,
  400,
);
await action(mod, {
  action: 'reviewReport',
  id: report.id,
  expectedStatus: 'reviewing',
  status: 'closed',
  note: 'Reviewed',
});
await action(reader, {
  action: 'report',
  id: p.id,
  reason: 'repeat must not reset status',
});
assert.equal(
  (await reports()).find((r) => r.id === report.id).status,
  'closed',
);
assert.equal((await reports()).filter((r) => r.targetId === p.id).length, 1);
await action(mod, {
  action: 'reviewReport',
  id: report.id,
  expectedStatus: 'closed',
  status: 'new',
  note: 'Reopened',
});
await action(mod, {
  action: 'removeContent',
  targetType: 'comment',
  id: comment.id,
  reason: 'Comment removed',
});
assert.equal((await ok(reader, '?action=comments&post=' + p.id)).length, 0);
assert.equal(
  (await reports()).find((r) => r.targetId === comment.id).status,
  'closed',
);
assert.equal((await ok(reader, '?action=post&id=' + p.id)).comments, 0);
const nested = await action(reader, {
  action: 'comment',
  id: p.id,
  text: 'Another comment',
});
await action(owner, {
  action: 'reportComment',
  id: nested.id,
  reason: 'Linked report',
});
const race = await Promise.all(
  [1, 2].map(() =>
    api(mod, '', {
      action: 'removeContent',
      targetType: 'post',
      id: p.id,
      reason: 'Post removed',
    }),
  ),
);
assert.deepEqual(
  race.map((r) => r.status).sort((a, b) => a - b),
  [200, 409],
);
assert.equal((await api(reader, '?action=post&id=' + p.id)).status, 404);
assert.equal(
  (await api(reader, '', { action: 'like', id: p.id, value: true })).status,
  404,
);
assert.equal((await ok(reader, '?action=comments&post=' + p.id)).length, 0);
assert.equal(
  (await reports()).find((r) => r.id === report.id).status,
  'closed',
);
assert.equal(
  (await reports()).find((r) => r.targetId === nested.id).status,
  'closed',
);
assert.equal(
  (await reports()).find((r) => r.targetId === nested.id).available,
  0,
);
assert.equal(
  (await ok(mod, '?action=moderationRemovals')).filter(
    (r) => r.targetId === p.id,
  ).length,
  1,
);
assert.equal(await fileStatus(media.url), 404);
assert.equal(await fileStatus(media.url, owner), 404);
assert.equal(
  (
    await api(owner, '', {
      action: 'post',
      text: 'reuse removed',
      media: [media.id],
    })
  ).status,
  404,
);
const ownDeleted = await post(owner, 'Owner deletes reported post ' + run);
await action(reader, {
  action: 'report',
  id: ownDeleted.id,
  reason: 'Evidence persists',
});
await action(owner, { action: 'delete', id: ownDeleted.id });
assert.equal(
  (await reports()).find((r) => r.targetId === ownDeleted.id).available,
  0,
);

const channel = await action(owner, {
  action: 'createChannel',
  name: 'Moderated channel',
  handle: 'cm_a_' + run,
  bio: 'Channel details',
});
const other = await action(owner, {
  action: 'createChannel',
  name: 'Other channel',
  handle: 'cm_b_' + run,
});
const dedicated = await image(),
  shared = await image(),
  personal = await image();
await action(owner, {
  action: 'profile',
  id: channel.id,
  name: 'Moderated channel',
  bio: 'Channel details',
  avatar: dedicated.url,
  cover: dedicated.url,
  mainHandle: channel.handle,
  extraHandles: [],
});
const cp = await post(channel.id, 'channel_unique_tag_' + run, [
  dedicated.id,
  shared.id,
]);
await post(owner, 'Independent personal photo ' + run, [
  shared.id,
  personal.id,
]);
assert.equal(
  (
    await api(reader, '', {
      action: 'moderate',
      id: channel.id,
      mode: 'blocked',
      reason: 'forged',
      minutes: null,
    })
  ).status,
  403,
);
await restrict(channel.id, 'read_only');
for (const b of [
  { action: 'post', as: channel.id, text: 'blocked write' },
  { action: 'profile', id: channel.id, name: 'changed', bio: '' },
  { action: 'pin', id: cp.id, value: true },
  { action: 'delete', id: cp.id },
])
  assert.equal((await api(owner, '', b)).data.code, 'CHANNEL_READ_ONLY');
assert.equal(
  (await ok(owner, '?action=profile&id=' + channel.id)).restriction.mode,
  'read_only',
);
assert.equal(
  (await ok(reader, '?action=profile&id=' + channel.id)).restriction,
  undefined,
);
await post(owner, 'Owner remains writable ' + run);
await post(other.id, 'Other channel remains writable ' + run);
await action(reader, { action: 'like', id: cp.id, value: true });
await restrict(channel.id, 'blocked');
assert.equal((await api(reader, '?action=post&id=' + cp.id)).status, 404);
assert.equal(
  (await ok(reader, '?action=profile&id=' + channel.id)).blocked,
  true,
);
assert.equal(
  (await ok(reader, '?action=profile&id=' + channel.id)).restriction,
  undefined,
);
assert.equal(
  (await ok(owner, '?action=profile&id=' + channel.id)).restriction.mode,
  'blocked',
);
assert.ok(
  !(await ok(reader, '?action=channels')).some((c) => c.id === channel.id),
);
assert.ok(
  (await ok(owner, '?action=channels')).some(
    (c) => c.id === channel.id && c.blocked,
  ),
);
assert.equal((await ok(reader, '?action=feed&user=' + channel.id)).length, 0);
assert.equal(await fileStatus(dedicated.url), 404);
assert.equal(await fileStatus(dedicated.url, owner), 404);
assert.equal(await fileStatus(shared.url), 200);
assert.equal(await fileStatus(personal.url), 200);
await post(owner, 'Personal posts survive channel block ' + run);
assert.equal((await ok(owner, '?action=account')).restriction, null);
await restrict(channel.id, 'active');
assert.equal(await fileStatus(dedicated.url), 200);
await post(channel.id, 'Channel restored ' + run);
assert.equal(
  (await ok(owner, '?action=profile&id=' + channel.id)).restriction,
  null,
);
const history = await ok(mod, '?action=moderationHistory&id=' + channel.id);
assert.ok(
  ['read_only', 'blocked', 'active'].every((mode) =>
    history.some((r) => r.mode === mode),
  ),
);
console.log(
  'PASS: moderator-only content deletion, preserved report evidence, status transitions/concurrency, media quarantine, independent channel restrictions and shared media, restoration.',
);
