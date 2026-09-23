import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['lib/profile-cover-cache.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { createProfileCoverCache } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture(t) {
  const calls = [],
    created = [],
    revoked = [];
  const state = {
    decode: Promise.resolve(),
    response: () =>
      new Response(new Blob(['cover'], { type: 'image/png' }), {
        headers: { 'content-type': 'image/png' },
      }),
    width: 1000,
    height: 200,
  };
  const original = {
    fetch: globalThis.fetch,
    Image: globalThis.Image,
    create: URL.createObjectURL.bind(URL),
    revoke: URL.revokeObjectURL.bind(URL),
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return state.response();
  };
  globalThis.Image = class {
    naturalWidth = state.width;
    naturalHeight = state.height;
    decode() {
      return state.decode;
    }
  };
  URL.createObjectURL = () => {
    const src = 'blob:cover-' + created.length;
    created.push(src);
    return src;
  };
  URL.revokeObjectURL = (src) => revoked.push(src);
  const cache = createProfileCoverCache();
  cache.reset('alice:0');
  t.after(() => {
    cache.clear();
    globalThis.fetch = original.fetch;
    if (original.Image) globalThis.Image = original.Image;
    else delete globalThis.Image;
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  });
  return { cache, state, calls, created, revoked };
}
void test('preparing a cover coalesces requests and exposes it only after image decoding', async (t) => {
  const f = fixture(t),
    decode = deferred();
  f.state.decode = decode.promise;
  const first = f.cache.prepare('/api/media/cover'),
    second = f.cache.prepare('/api/media/cover');
  assert.equal(first, second);
  assert.equal(f.cache.get('/api/media/cover'), undefined);
  assert.equal(f.cache.loading('/api/media/cover'), true);
  decode.resolve();
  const src = await first;
  assert.equal(f.cache.loading('/api/media/cover'), false);
  assert.equal(f.cache.get('/api/media/cover'), src);
  assert.equal(await f.cache.prepare('/api/media/cover'), src);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.credentials, 'same-origin');
});
void test('account and privacy changes revoke images and reject a late decoded response', async (t) => {
  const f = fixture(t);
  const a = await f.cache.prepare('/api/media/a');
  const decode = deferred();
  f.state.decode = decode.promise;
  const pending = f.cache.prepare('/api/media/b');
  await new Promise(setImmediate);
  f.cache.reset('bob:0');
  assert.ok(f.revoked.includes(a));
  assert.equal(f.calls[1].options.signal.aborted, true);
  decode.resolve();
  assert.equal(await pending, undefined);
  assert.equal(f.cache.get('/api/media/b'), undefined);
  f.state.decode = Promise.resolve();
  const b = await f.cache.prepare('/api/media/b');
  f.cache.reset('bob:1');
  assert.ok(f.revoked.includes(b));
});
void test('eight retained covers use LRU eviction and revoke discarded resources', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) await f.cache.prepare('/api/media/' + i);
  f.cache.get('/api/media/0');
  await f.cache.prepare('/api/media/8');
  assert.equal(f.cache.get('/api/media/1'), undefined);
  assert.equal(f.cache.get('/api/media/0'), 'blob:cover-0');
  assert.deepEqual(f.revoked, ['blob:cover-1']);
});
void test('decoded memory budget evicts large images before count limit and rejects oversized covers', async (t) => {
  const f = fixture(t);
  f.state.width = 2000;
  f.state.height = 2000;
  for (let i = 0; i < 3; i++) await f.cache.prepare('/api/media/' + i);
  assert.equal(f.cache.get('/api/media/0'), undefined);
  assert.equal(f.revoked.length, 1);
  f.state.width = 5000;
  f.state.height = 5000;
  assert.equal(await f.cache.prepare('/api/media/huge'), undefined);
  assert.equal(f.revoked.length, 2);
});
void test('failed, denied and non-image responses are not cached and can be retried', async (t) => {
  const f = fixture(t);
  for (const response of [
    () => new Response('denied', { status: 403 }),
    () => new Response('html', { headers: { 'content-type': 'text/html' } }),
    () =>
      new Response('large', {
        headers: {
          'content-type': 'image/png',
          'content-length': 9 * 1024 * 1024,
        },
      }),
  ]) {
    f.state.response = response;
    assert.equal(await f.cache.prepare('/api/media/fail'), undefined);
    assert.equal(f.cache.get('/api/media/fail'), undefined);
    assert.equal(f.cache.loading('/api/media/fail'), false, 'falls back');
  }
  f.state.response = () =>
    new Response(new Blob(['cover'], { type: 'image/png' }), {
      headers: { 'content-type': 'image/png' },
    });
  assert.ok(await f.cache.prepare('/api/media/fail'));
});
void test('external URLs and signed-out sessions never enter the private media cache', async (t) => {
  const f = fixture(t);
  await f.cache.prepare('https://example.com/cover');
  await f.cache.prepare('/api/social?action=account');
  f.cache.reset('');
  await f.cache.prepare('/api/media/cover');
  assert.equal(f.calls.length, 0);
});
