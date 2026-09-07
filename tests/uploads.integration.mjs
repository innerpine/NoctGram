import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8787';
const id = 'upload_limits_' + Date.now();
const headers = {
  'oai-authenticated-user-id': id,
  'oai-authenticated-user-email': id + '@example.com',
  Origin: base,
};
const mib = 1024 * 1024;
// Binary transport fixtures, not playable videos. Real-file checks stay local.
function video(size) {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 24, 102, 116, 121, 112]);
  return new File([bytes], 'transport-fixture.mp4', { type: 'video/mp4' });
}
function form(file) {
  const body = new FormData();
  body.set('file', file);
  return body;
}
async function post(body) {
  const r = await fetch(base + '/api/social', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function upload(file) {
  return fetch(base + '/api/upload', {
    method: 'POST',
    headers,
    body: form(file),
  });
}

if (process.argv.includes('--dev')) {
  // Invalid session guarantees no fallback identity or writes in the main dev DB.
  const options = {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:3000',
      Cookie: 'noct_session=invalid',
    },
  };
  const accepted = await fetch('http://localhost:3000/api/upload', {
    ...options,
    body: form(video(2 * mib)),
  });
  assert.equal(
    accepted.status,
    401,
    'Multipart >1 MiB must reach API authentication in Vinext dev',
  );
  assert.match((await accepted.json()).error, /Войдите/);
  const oversized = await fetch('http://localhost:3000/api/upload', {
    ...options,
    body: form(video(27 * mib)),
  });
  assert.equal(
    oversized.status,
    413,
    'Framework request limit remains bounded',
  );
  await oversized.text();
}

const allowed = await upload(video(2 * mib));
assert.equal(allowed.status, 200);
const media = await allowed.json();
const read = await fetch(base + media.url, { headers });
assert.equal(read.status, 200);
assert.equal((await read.arrayBuffer()).byteLength, 2 * mib);

const tooLarge = await upload(video(25 * mib + 32768));
assert.equal(
  tooLarge.status,
  413,
  'The application still rejects files above 25 MiB',
);
assert.match((await tooLarge.json()).error, /25 МБ/);
assert.equal((await post({ action: 'activatePremiumTest' })).status, 200);
const overAvatarLimit = await upload(video(11 * mib));
assert.equal(
  overAvatarLimit.status,
  200,
  '11 MiB is valid for a post attachment',
);
const largeAvatar = await overAvatarLimit.json();
const result = await post({
  action: 'appearance',
  theme: 'iris',
  nameGradient: false,
  ringText: '',
  avatarMotion: largeAvatar.url,
});
assert.equal(result.status, 400, 'The Premium avatar limit stays at 10 MiB');
assert.match(result.body.error, /10 МБ/);
console.log(
  'PASS uploads: multipart above 1 MiB, private download, app 25 MiB and avatar 10 MiB limits' +
    (process.argv.includes('--dev')
      ? ', dev auth dispatch and bounded 26 MiB request limit.'
      : '.'),
);
