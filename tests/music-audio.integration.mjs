import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Only isolated local Worker tests are allowed');
const alice = 'audio_alice_' + Date.now(),
  bob = 'audio_bob_' + Date.now();
const headers = (user) =>
  user
    ? {
        'oai-authenticated-user-id': user,
        'oai-authenticated-user-email': 'audio-test@example.test',
      }
    : {};
const url = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
async function api(user, body) {
  const response = await fetch(
    base + '/api/music' + (body ? '' : '?action=home'),
    {
      headers: {
        ...headers(user),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    },
  );
  return { status: response.status, data: await response.json() };
}
const saved = await api(alice, { action: 'save', url });
assert.equal(saved.status, 200, JSON.stringify(saved.data));
assert.equal(saved.data.provider, 'spotify');
assert.equal(saved.data.artist, 'Rick Astley');
assert.ok(saved.data.durationMs > 200000);
const id = saved.data.id,
  path = '/api/music/audio/' + id;
assert.equal(
  (await api(alice)).data.discoveries.some((t) => t.id === id),
  false,
);
assert.equal(
  (await api(bob)).data.library.some((t) => t.id === id),
  false,
);
assert.deepEqual((await api(alice, { action: 'start', url })).data, {
  session: null,
});
const wav = new Uint8Array(8044);
const view = new DataView(wav.buffer),
  text = (at, s) => [...s].forEach((c, i) => (wav[at + i] = c.charCodeAt(0)));
text(0, 'RIFF');
view.setUint32(4, wav.length - 8, true);
text(8, 'WAVEfmt ');
view.setUint32(16, 16, true);
view.setUint16(20, 1, true);
view.setUint16(22, 1, true);
view.setUint32(24, 8000, true);
view.setUint32(28, 8000, true);
view.setUint16(32, 1, true);
view.setUint16(34, 8, true);
text(36, 'data');
view.setUint32(40, 8000, true);
wav.fill(128, 44); // Synthetic silence, no copyrighted audio.
async function upload(user, bytes, extra = {}) {
  const body = new FormData();
  body.set('file', new File([bytes], 'test.wav', { type: 'audio/wav' }));
  return fetch(base + path, {
    method: 'POST',
    headers: { ...headers(user), ...extra },
    body,
  });
}
assert.equal((await upload(null, wav)).status, 401);
assert.equal((await upload(bob, wav)).status, 404);
assert.equal(
  (await upload(alice, wav, { Origin: 'https://evil.test' })).status,
  403,
);
assert.equal(
  (await upload(alice, new TextEncoder().encode('<html>fake-audio</html>')))
    .status,
  400,
);
assert.equal((await upload(alice, wav)).status, 200);
assert.equal(
  (await api(alice)).data.library.find((t) => t.id === id).audioUrl,
  path,
);
assert.equal((await fetch(base + path)).status, 401);
assert.equal((await fetch(base + path, { headers: headers(bob) })).status, 404);
const full = await fetch(base + path, { headers: headers(alice) });
assert.equal(full.status, 200);
assert.equal(full.headers.get('Content-Type'), 'audio/wav');
assert.deepEqual(new Uint8Array(await full.arrayBuffer()), wav);
const partial = await fetch(base + path, {
  headers: { ...headers(alice), Range: 'bytes=44-99' },
});
assert.equal(partial.status, 206);
assert.equal(partial.headers.get('Content-Range'), `bytes 44-99/${wav.length}`);
assert.deepEqual(
  new Uint8Array(await partial.arrayBuffer()),
  wav.slice(44, 100),
);
const suffix = await fetch(base + path, {
  headers: { ...headers(alice), Range: 'bytes=-10' },
});
assert.equal(suffix.status, 206);
assert.equal((await suffix.arrayBuffer()).byteLength, 10);
assert.equal(
  (
    await fetch(base + path, {
      headers: { ...headers(alice), Range: 'bytes=999999-' },
    })
  ).status,
  416,
);
assert.equal(
  (
    await fetch(
      base + '/api/music?action=track&url=' + encodeURIComponent(url),
      { headers: headers(bob) },
    )
  ).status,
  404,
);
const replaced = wav.slice();
replaced[100] = 127;
assert.equal((await upload(alice, replaced)).status, 200);
assert.deepEqual(
  new Uint8Array(
    await (await fetch(base + path, { headers: headers(alice) })).arrayBuffer(),
  ),
  replaced,
);
await api(bob, { action: 'remove', id });
assert.equal(
  (await fetch(base + path, { headers: headers(alice) })).status,
  200,
);
await api(alice, { action: 'remove', id });
assert.equal(
  (await fetch(base + path, { headers: headers(alice) })).status,
  404,
);
console.log(
  'Spotify link import and private server audio: auth, upload, playback ranges, replacement and deletion passed.',
);
