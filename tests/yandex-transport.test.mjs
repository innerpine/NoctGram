import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['lib/yandex-transport.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { fetchYandex, checkYandexConnection } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64')
);
for (const [failure, code, status] of [
  [
    new TypeError('request with sensitive-header', {
      cause: { code: 'ENOTFOUND' },
    }),
    'YANDEX_DNS_ERROR',
    502,
  ],
  [
    new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN' } }),
    'YANDEX_DNS_ERROR',
    502,
  ],
  [new TypeError('DNS lookup failed'), 'YANDEX_DNS_ERROR', 502],
  [
    new DOMException('Request timed out', 'TimeoutError'),
    'YANDEX_TIMEOUT',
    504,
  ],
  [
    new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } }),
    'YANDEX_TIMEOUT',
    504,
  ],
  [
    new TypeError('fetch failed', { cause: { code: 'CERT_HAS_EXPIRED' } }),
    'YANDEX_TLS_ERROR',
    502,
  ],
  [new TypeError('sensitive-header'), 'YANDEX_NETWORK_ERROR', 502],
]) {
  await assert.rejects(
    fetchYandex('/account/status', 'synthetic-test-token', async () => {
      throw failure;
    }),
    (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.ok(!error.message.includes('sensitive-header'));
      assert.ok(!error.message.includes('synthetic-test-token'));
      return true;
    },
  );
}
const unauthorized = await fetchYandex(
  '/account/status',
  'synthetic-test-token',
  async (url, init) => {
    assert.equal(url, 'https://api.music.yandex.net/account/status');
    assert.equal(init.headers.Authorization, 'OAuth synthetic-test-token');
    assert.equal(init.redirect, 'manual');
    return Response.json(
      { error: { name: 'session-expired' } },
      { status: 401 },
    );
  },
);
assert.equal(
  unauthorized.status,
  401,
  'Authentication remains separate from transport errors',
);
for (const status of [200, 401])
  assert.deepEqual(
    await checkYandexConnection(async (_url, init) => {
      assert.ok(!('Authorization' in init.headers));
      return Response.json(
        status === 200
          ? { result: { account: null } }
          : { error: 'unauthorized' },
        { status },
      );
    }),
    { ok: true },
  );
await assert.rejects(
  checkYandexConnection(async () => new Response('<html>Proxy login</html>')),
  (e) => e.code === 'YANDEX_UPSTREAM_ERROR',
);
await assert.rejects(
  checkYandexConnection(async () => Response.json({ unrelated: true })),
  (e) => e.code === 'YANDEX_UPSTREAM_ERROR',
);
await assert.rejects(
  checkYandexConnection(
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'https://other.example/' },
      }),
  ),
  (e) => e.code === 'YANDEX_UPSTREAM_ERROR',
);
console.log(
  'Yandex transport: DNS/timeouts/TLS, sanitized errors, authentication separation and token-free connection checks passed.',
);
