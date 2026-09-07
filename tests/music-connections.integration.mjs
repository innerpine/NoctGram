import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Use the isolated local music-qa Worker');
const user = 'music_services_' + Date.now();
async function api(path, { account = user, body, origin = base } = {}) {
  const response = await fetch(base + path, {
    headers: {
      ...(account
        ? {
            'oai-authenticated-user-id': account,
            'oai-authenticated-user-email': 'music-qa@example.test',
          }
        : {}),
      ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}),
    },
    // Origin is rejected before body parsing. Empty POST avoids Windows workerd's
    // early-body-response connection reset; valid-origin cases still send JSON.
    ...(body
      ? {
          method: 'POST',
          ...(origin === base ? { body: JSON.stringify(body) } : {}),
        }
      : {}),
  });
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  return { status: response.status, data: await response.json() };
}
assert.equal((await api('/api/music/yandex', { account: null })).status, 401);
assert.equal(
  (await api('/api/music/yandex', { account: 'music_qa_blocked' })).status,
  403,
);
assert.equal(
  (
    await api('/api/music/yandex', {
      body: { action: 'connect', token: 'synthetic-test-token' },
      origin: 'https://other.example',
    })
  ).status,
  403,
);
assert.equal(
  (
    await api('/api/music/yandex', {
      body: { action: 'sync' },
      account: 'music_qa_readonly',
    })
  ).status,
  403,
);
assert.equal(
  (
    await api('/api/music/yandex', {
      body: { action: 'disconnect' },
      account: 'music_qa_readonly',
    })
  ).status,
  200,
);
const yandex = await api('/api/music/yandex');
assert.equal(yandex.status, 200);
assert.deepEqual(yandex.data.items, []);
assert.ok(!JSON.stringify(yandex.data).includes('sealedTokens'));
assert.equal(
  (await api('/api/music/yandex?playlist=../../account/status')).status,
  400,
);
const tokenPath = '/api/music/services/spotify/playback-token';
assert.equal((await api(tokenPath, { account: null, body: {} })).status, 401);
assert.equal(
  (await api(tokenPath, { body: {}, origin: 'https://other.example' })).status,
  403,
);
assert.equal(
  (await api(tokenPath, { account: 'music_qa_readonly', body: {} })).status,
  403,
);
assert.equal((await api(tokenPath)).status, 404, 'No SDK credential over GET');
assert.ok(
  [409, 503].includes((await api(tokenPath, { body: {} })).status),
  'Missing app/account never produces a token',
);
assert.equal(
  (await api('/api/music/services/soundcloud/search?q=' + 'a'.repeat(151)))
    .status,
  400,
);
assert.ok(
  [409, 503].includes(
    (await api('/api/music/services/soundcloud/search?q=vendetta')).status,
  ),
);
console.log(
  'Built Worker music connections: authentication, account restrictions, Origin, private responses, invalid input and unconfigured services passed.',
);
