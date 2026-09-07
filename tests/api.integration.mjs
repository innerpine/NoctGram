import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://localhost:3000';
const h = process.env.TEST_USER
  ? {
      'oai-authenticated-user-id': process.env.TEST_USER,
      'oai-authenticated-user-email': 'test@example.com',
    }
  : { Cookie: '__sites_local_auth=1' };
async function api(query = '', body, headers = h) {
  const r = await fetch(base + '/api/social' + query, {
    headers: {
      ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  return { status: r.status, data };
}
const start = await api('?action=bootstrap');
assert.equal(start.status, 200);
const me = start.data.me;
assert.equal((await api('?action=bootstrap', undefined, {})).status, 401);
assert.equal((await api('', { action: 'delete', id: 'welcome' })).status, 403);
assert.equal(
  (await api('', { action: 'handle', handle: 'noctgram' })).status,
  409,
);
assert.equal(
  (await api('', { action: 'handle', handle: 'bad space' })).status,
  400,
);
assert.equal(
  (await api('', { action: 'post', text: '', poll: ['a', 'b'] })).status,
  400,
);
const tag = 'integration_' + Date.now();
assert.equal(
  (
    await api('', {
      action: 'post',
      text: tag,
      poll: ['First', 'Second'],
      media: [],
    })
  ).status,
  200,
);
let post = (await api('?action=feed&q=' + tag)).data[0];
assert.equal(post.userId, me.id);
for (let i = 0; i < 2; i++)
  assert.equal(
    (await api('', { action: 'like', id: post.id, value: true })).status,
    200,
  );
post = (await api('?action=feed&q=' + tag)).data[0];
assert.equal(post.likes, 1);
await api('', { action: 'like', id: post.id, value: false });
await api('', { action: 'save', id: post.id, value: true });
assert.ok(
  (await api('?action=feed&mode=saved')).data.some((p) => p.id === post.id),
);
assert.equal(
  (await api('', { action: 'vote', id: post.id, option: 9 })).status,
  400,
);
await api('', { action: 'vote', id: post.id, option: 0 });
await api('', { action: 'vote', id: post.id, option: 1 });
post = (await api('?action=feed&q=' + tag)).data[0];
assert.equal(post.voted, 1);
assert.deepEqual(post.votes, [{ option: 1, count: 1 }]);
await api('', {
  action: 'comment',
  id: post.id,
  text: 'Тест комментария <script>not executable</script>',
});
const comments = (await api('?action=comments&post=' + post.id)).data;
assert.equal(comments.length, 1);
assert.equal(comments[0].userId, me.id);
await api('', {
  action: 'profile',
  name: 'Test profile',
  bio: 'Test bio',
  avatar: '',
  cover: '',
});
assert.equal((await api('?action=profile')).data.bio, 'Test bio');
await api('', {
  action: 'profile',
  name: me.name,
  bio: me.bio,
  avatar: me.avatar,
  cover: me.cover,
});
const handle = 'check_' + Date.now();
assert.equal((await api('', { action: 'handle', handle })).status, 200);
assert.equal((await api('?action=profile')).data.handle, handle);
await api('', { action: 'handle', handle: me.handle });
await api('', { action: 'removeHandle', handle });
const image = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
    'base64',
  ),
);
const form = new FormData();
form.set('file', new File([image], 'pixel.png', { type: 'image/png' }));
const up = await fetch(base + '/api/upload', {
  method: 'POST',
  headers: h,
  body: form,
});
assert.equal(up.status, 200);
const media = await up.json();
const file = await fetch(base + media.url, { headers: h });
assert.equal(file.status, 200);
assert.equal(file.headers.get('content-type'), 'image/png');
assert.equal((await file.arrayBuffer()).byteLength, image.length);
const range = await fetch(base + media.url, {
  headers: { ...h, Range: 'bytes=0-7' },
});
assert.equal(range.status, 206);
assert.equal((await range.arrayBuffer()).byteLength, 8);
assert.equal((await fetch(base + media.url)).status, 401);
const bad = new FormData();
bad.set('file', new File(['not an image'], 'bad.png', { type: 'image/png' }));
assert.equal(
  (await fetch(base + '/api/upload', { method: 'POST', headers: h, body: bad }))
    .status,
  400,
);
assert.equal(
  (
    await api('', {
      action: 'post',
      text: tag + '_media',
      media: [media.id],
      poll: [],
    })
  ).status,
  200,
);
const mediaPost = (await api('?action=feed&q=' + tag + '_media')).data[0];
assert.equal(mediaPost.media[0].id, media.id);
await api('', { action: 'delete', id: mediaPost.id });
await api('', { action: 'delete', id: post.id });
assert.equal((await api('?action=feed&q=' + tag)).data.length, 0);
assert.equal((await api('?action=comments&post=' + post.id)).data.length, 0);
// Wrangler may restart its local request proxy after rejecting an unread body. Keep this check last.
assert.equal(
  (
    await api(
      '',
      { action: 'post', text: 'x' },
      { ...h, Origin: 'https://untrusted.example' },
    )
  ).status,
  403,
);
console.log(
  'PASS: authentication, CSRF, ownership, posts, likes, bookmarks, comments, voting, profiles, usernames, image upload, byte ranges and deletion cascade.',
);
