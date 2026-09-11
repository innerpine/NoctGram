import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('work/tests', { recursive: true });
await build({
  entryPoints: ['worker/public.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'work/tests/public-worker.mjs',
  plugins: [
    {
      name: 'app-fixture',
      setup(builder) {
        builder.onResolve(
          { filter: /^vinext\/server\/fetch-handler$/ },
          () => ({ path: 'app', namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export default { async fetch(request, env) {
      return new Response(JSON.stringify({ method:request.method, url:request.url, headers:Object.fromEntries(request.headers), body:await request.text() }),{status:env.testStatus||200});
    }};`,
          loader: 'js',
        }));
      },
    },
  ],
});
const { default: worker } = await import('../work/tests/public-worker.mjs');
const settings = {
  NOCT_DEPLOYMENT_TARGET: 'standalone',
  NOCT_AUTH_MODE: 'email',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
};

await test('www redirects to HTTPS apex while retaining path and query', async () => {
  const response = await worker.fetch(
    new Request('https://www.noctgram.com/music?tab=library'),
    settings,
    {},
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get('location'),
    'https://noctgram.com/music?tab=library',
  );
});

await test('HTTP public links redirect before loading the app or assets', async () => {
  const env = {
    ...settings,
    ASSETS: {
      fetch() {
        throw Error('An insecure request must not load assets');
      },
    },
  };
  for (const hostname of ['noctgram.com', 'www.noctgram.com']) {
    for (const path of ['/', '/?profile=invoker', '/music?tab=library']) {
      const response = await worker.fetch(
        new Request(`http://${hostname}${path}`),
        env,
        {},
      );
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('location'), `https://noctgram.com${path}`);
    }
  }
});

await test('HTTPS public links and local HTTP development do not redirect', async () => {
  for (const url of ['https://noctgram.com/', 'http://localhost:8791/']) {
    const response = await worker.fetch(new Request(url), settings, {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
    assert.equal((await response.json()).url, url);
  }
});

await test('public entry fails closed before serving assets or application on invalid configuration', async () => {
  for (const change of [
    { NOCT_AUTH_MODE: 'hybrid' },
    { NOCT_AUTH_MODE: 'access' },
    { NOCT_DEPLOYMENT_TARGET: '' },
    { SUPABASE_PUBLISHABLE_KEY: '' },
    { SUPABASE_URL: 'http://127.0.0.1:8791' },
    { SUPABASE_URL: 'https://user:pass@example.com' },
    { SUPABASE_URL: 'https://example.com/path' },
    { NOCT_AUTH_ALLOW_LOCAL_PROVIDER: '1' },
  ]) {
    const env = {
      ...settings,
      ...change,
      ASSETS: {
        fetch() {
          throw Error('Assets must remain unavailable');
        },
      },
    };
    const response = await worker.fetch(
      new Request('https://noctgram.com/'),
      env,
      {},
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
await test('public requests retain session and body but discard all gateway identity headers', async () => {
  const response = await worker.fetch(
    new Request('https://noctgram.com/api/profile', {
      method: 'POST',
      headers: {
        cookie: 'noct_session=test',
        'content-type': 'application/json',
        'oai-authenticated-user-id': 'admin',
        'Oai-Authenticated-User-Email': 'attacker@example.com',
        'x-noct-preview-user-id': 'admin',
        'cf-access-jwt-assertion': 'forged',
      },
      body: '{"name":"Alice"}',
    }),
    settings,
    {},
  );
  const request = await response.json();
  assert.equal(request.method, 'POST');
  assert.equal(request.body, '{"name":"Alice"}');
  assert.equal(request.headers.cookie, 'noct_session=test');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(
    Object.keys(request.headers).some(
      (k) =>
        k.startsWith('oai-authenticated-') ||
        k.startsWith('x-noct-preview-') ||
        k === 'cf-access-jwt-assertion',
    ),
    false,
  );
});
await test('assets bypass React, missing chunks keep their 404, pages reach the app', async () => {
  const env = {
    ...settings,
    ASSETS: { fetch: async () => new Response('asset') },
  };
  assert.equal(
    await (
      await worker.fetch(new Request('https://noctgram.com/app.js'), env, {})
    ).text(),
    'asset',
  );
  assert.equal(
    (
      await worker.fetch(
        new Request('https://noctgram.com/_next/static/missing.js'),
        settings,
        {},
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request('https://noctgram.com/login'),
        settings,
        {},
      )
    ).status,
    200,
  );
});
await test('scheduled jobs require valid public config and a secret, and surface job failures', async () => {
  await assert.rejects(() => worker.scheduled({}, settings, {}));
  await assert.rejects(() =>
    worker.scheduled(
      {},
      { ...settings, NOCT_AUTH_MODE: 'hybrid', NOCT_JOBS_SECRET: 'test' },
      {},
    ),
  );
  await worker.scheduled({}, { ...settings, NOCT_JOBS_SECRET: 'test' }, {});
  await assert.rejects(
    () =>
      worker.scheduled(
        {},
        { ...settings, NOCT_JOBS_SECRET: 'test', testStatus: 503 },
        {},
      ),
    /503/,
  );
});
