import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
// Only localhost Worker8787 with --persist-to work/features-qa. Never a real account.
const base = 'http://127.0.0.1:8787',
  stamp = Date.now();
const ids = ['owner', 'editor', 'admin', 'reader'].map(
    (r) => 'rt_' + r + '_' + stamp,
  ),
  [owner, editor, admin, reader] = ids,
  mod = 'mod_qa_admin';
const auth = (id) => ({
  'oai-authenticated-user-id': id,
  'oai-authenticated-user-email': id + '@example.com',
  Origin: base,
});
async function api(id, q = '', body) {
  const r = await fetch(base + '/api/social' + q, {
    headers: { ...auth(id), 'Content-Type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
async function ok(id, q = '', body) {
  const r = await api(id, q, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const act = (id, b) => ok(id, '', b);
async function denied(id, b) {
  assert.ok(
    [400, 403, 404, 409].includes((await api(id, '', b)).status),
    JSON.stringify(b),
  );
}
const people = {};
for (const id of [...ids, mod])
  people[id] = (await ok(id, '?action=bootstrap')).me;
const channel = await act(owner, {
  action: 'createChannel',
  name: 'Realtime QA',
  handle: 'rt_' + stamp,
  bio: '',
});
const member = (id, role) =>
  act(owner, { action: 'channelMember', channelId: channel.id, id, role });
await member(editor, 'editor');
await member(admin, 'admin');
assert.equal(
  (await ok(editor, '?action=profile&id=' + channel.id)).canPublish,
  true,
);
assert.equal(
  (await ok(editor, '?action=profile&id=' + channel.id)).canEditProfile,
  false,
);
assert.equal(
  (await ok(admin, '?action=profile&id=' + channel.id)).canEditProfile,
  true,
);
await denied(editor, {
  action: 'profile',
  id: channel.id,
  name: 'No',
  bio: '',
  avatar: '',
  cover: '',
});
await denied(admin, {
  action: 'channelMember',
  channelId: channel.id,
  id: reader,
  role: 'admin',
});
await act(admin, {
  action: 'profile',
  id: channel.id,
  name: 'Team channel',
  bio: 'Updated by admin',
  avatar: '',
  cover: '',
});
await act(reader, { action: 'follow', id: channel.id, value: true });
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
    'qa.png',
    { type: 'image/png' },
  ),
);
const uploaded = await fetch(base + '/api/upload', {
  method: 'POST',
  headers: auth(editor),
  body: form,
});
assert.equal(uploaded.status, 200);
const media = await uploaded.json();
const at = Date.now() + 180000;
const scheduled = await act(editor, {
  action: 'post',
  as: channel.id,
  text: 'Future #rt' + stamp,
  media: [media.id],
  publishAt: at,
});
assert.ok(
  !(await ok(reader, '?action=feed&user=' + channel.id)).some(
    (p) => p.id === scheduled.id,
  ),
);
assert.equal(
  (await api(reader, '?action=post&id=' + scheduled.id)).status,
  404,
);
assert.equal(
  (await ok(reader, '?action=profile&id=' + channel.id)).postCount,
  0,
);
assert.equal(
  (await api(reader, '?action=scheduled&id=' + channel.id)).status,
  403,
);
assert.equal(
  (await ok(editor, '?action=scheduled&id=' + channel.id))[0].id,
  scheduled.id,
);
await denied(reader, { action: 'like', id: scheduled.id, value: true });
assert.equal(
  (await fetch(base + '/api/media/' + media.id, { headers: auth(reader) }))
    .status,
  404,
);
assert.equal(
  (
    await fetch(base + '/api/media/' + media.id, {
      headers: { ...auth(editor), Range: 'bytes=0-7' },
    })
  ).status,
  206,
);
const owned = await act(owner, {
  action: 'post',
  as: channel.id,
  text: 'Owner queue',
  publishAt: at,
});
await denied(editor, {
  action: 'reschedule',
  id: owned.id,
  publishAt: at + 60000,
});
await act(admin, { action: 'reschedule', id: owned.id, publishAt: at + 60000 });
await member(editor, 'remove');
assert.equal(
  (await api(editor, '?action=scheduled&id=' + channel.id)).status,
  403,
);
assert.equal(
  (await fetch(base + '/api/media/' + media.id, { headers: auth(editor) }))
    .status,
  404,
);
await denied(editor, { action: 'story', mediaId: media.id });
assert.ok(
  (await ok(owner, '?action=scheduled&id=' + channel.id)).find(
    (p) => p.id === scheduled.id,
  ).cancelledAt,
);
await member(editor, 'editor');
assert.ok(
  (await ok(editor, '?action=scheduled&id=' + channel.id)).find(
    (p) => p.id === scheduled.id,
  ).cancelledAt,
);
const story = await act(owner, {
  action: 'story',
  text: '24 hours',
  background: 'violet',
});
await act(reader, { action: 'viewStory', id: story.id });
await act(reader, { action: 'viewStory', id: story.id });
assert.equal(
  (await ok(owner, '?action=storyViewers&id=' + story.id)).length,
  1,
);
assert.equal(
  (await api(reader, '?action=storyViewers&id=' + story.id)).status,
  403,
);
await denied(reader, { action: 'deleteStory', id: story.id });
await act(reader, {
  action: 'reportStory',
  id: story.id,
  reason: 'QA evidence',
});
assert.ok(
  (await ok(mod, '?action=moderationReports')).find(
    (r) => r.targetId === story.id && r.targetType === 'story' && r.available,
  ),
);
await act(mod, {
  action: 'removeContent',
  id: story.id,
  targetType: 'story',
  reason: 'QA cleanup',
});
assert.ok(
  !(await ok(reader, '?action=stories')).some((s) => s.id === story.id),
);
const expiring = await act(owner, { action: 'story', text: 'Expiry fixture' });
// Advance only fixture timestamps in the dedicated QA database, without sleeping.
const sql = `UPDATE posts SET publishAt=1,created=${Date.now() - 1000} WHERE id='${owned.id}'; UPDATE stories SET expiresAt=1 WHERE id='${expiring.id}';`;
const qa = path.resolve('work/features-qa');
assert.ok(qa.startsWith(path.resolve('work') + path.sep));
execFileSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'execute',
    'site-creator-d1',
    '--config',
    'wrangler.local.json',
    '--local',
    '--persist-to',
    qa,
    '--command',
    sql,
  ],
  { stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
);
assert.ok(
  (await ok(reader, '?action=feed&user=' + channel.id)).some(
    (p) => p.id === owned.id,
  ),
);
assert.ok(
  !(await ok(reader, '?action=stories')).some((s) => s.id === expiring.id),
);
const notices = await ok(reader, '?action=notifications');
assert.equal(
  notices.filter((n) => n.kind === 'post' && n.targetId === owned.id).length,
  1,
);
assert.equal(
  (await ok(reader, '?action=notifications')).filter(
    (n) => n.targetId === owned.id,
  ).length,
  1,
);
await act(reader, { action: 'readNotifications', before: Date.now() });
assert.ok((await ok(reader, '?action=notifications')).every((n) => n.read));
const device = 'device_' + crypto.randomUUID(),
  otherDevice = 'device_' + crypto.randomUUID(),
  callId = crypto.randomUUID();
await act(owner, { action: 'callStart', id: callId, peer: reader, device });
const incoming = (await ok(reader, '?action=callState&device=' + otherDevice))
  .call;
assert.equal(incoming.id, callId);
assert.equal(incoming.offer, undefined);
assert.equal(
  (await ok(editor, '?action=callState&device=' + device + '&id=' + callId))
    .call,
  null,
);
await act(reader, { action: 'callAccept', id: callId, device: otherDevice });
await act(reader, { action: 'callAccept', id: callId, device: otherDevice });
const sdp =
  'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
await denied(owner, {
  action: 'callSignal',
  id: callId,
  device: otherDevice,
  type: 'offer',
  sdp,
});
await denied(reader, {
  action: 'callSignal',
  id: callId,
  device: otherDevice,
  type: 'answer',
  sdp,
});
await act(owner, {
  action: 'callSignal',
  id: callId,
  device,
  type: 'offer',
  sdp,
});
await act(reader, {
  action: 'callSignal',
  id: callId,
  device: otherDevice,
  type: 'answer',
  sdp,
});
await denied(owner, {
  action: 'callSignal',
  id: callId,
  device,
  type: 'ice',
  candidates: [null],
});
const candidate = {
  key: 'candidate1',
  candidate: {
    candidate: 'candidate:1 1 UDP 1 127.0.0.1 1234 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
  },
};
await act(owner, {
  action: 'callSignal',
  id: callId,
  device,
  type: 'ice',
  candidates: [candidate],
});
await act(owner, {
  action: 'callSignal',
  id: callId,
  device,
  type: 'ice',
  candidates: [candidate],
});
assert.equal(
  (
    await ok(
      reader,
      '?action=callState&device=' + otherDevice + '&id=' + callId,
    )
  ).signals.length,
  1,
);
await act(reader, { action: 'blockUser', id: owner, value: true });
assert.equal(
  (await ok(owner, '?action=callState&device=' + device + '&id=' + callId)).call
    .status,
  'ended',
);
await act(owner, { action: 'callEnd', id: callId, device });
await denied(owner, {
  action: 'callStart',
  id: crypto.randomUUID(),
  peer: reader,
  device,
});
await act(reader, { action: 'blockUser', id: owner, value: false });
assert.equal(
  (await fetch(base + '/api/jobs/run', { method: 'POST' })).status,
  401,
);
console.log(
  'PASS realtime: roles, staff editing, scheduled visibility/media/clock, revoke and regrant, stories/views/expiry/moderation, notification fanout/read, audio consent/device/ICE/privacy, jobs authorization.',
);
