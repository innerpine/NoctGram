import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('work/tests', { recursive: true });
const calls = [];
globalThis.__previewWorkerCalls = calls;
await build({
  entryPoints: ['worker/shared-preview.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'work/tests/preview-worker.mjs',
  plugins: [
    {
      name: 'isolated-worker-boundaries',
      setup(builder) {
        builder.onResolve(
          {
            filter: /^(vinext\/server\/fetch-handler|\.\.\/lib\/access-auth)$/,
          },
          (args) => ({ path: args.path, namespace: 'boundary' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, (args) => ({
          loader: 'js',
          contents: args.path.startsWith('vinext')
            ? 'export default {async fetch(req){globalThis.__previewWorkerCalls.push({target:"app",path:new URL(req.url).pathname,headers:req.headers});return new Response("application")}}'
            : 'export async function accessIdentity(headers){return headers.get("test-verified-identity")==="allowed"?{userId:"alice"}:null}',
        }));
      },
    },
  ],
});
const worker = (await import('../work/tests/preview-worker.mjs')).default;
const env = {
  ASSETS: {
    async fetch(req) {
      const path = new URL(req.url).pathname;
      calls.push({ target: 'assets', path });
      return path === '/_next/static/chunks/client.js'
        ? new Response('export const ready=true;', {
            headers: { 'Content-Type': 'text/javascript' },
          })
        : new Response('missing', { status: 404 });
    },
  },
};
function req(path, allowed = true) {
  return new Request('https://preview.example' + path, {
    headers: {
      'test-verified-identity': allowed ? 'allowed' : '',
      'oai-authenticated-user-id': 'forged',
    },
  });
}
await test('private assets are rejected before reaching the asset binding when not signed in', async () => {
  calls.length = 0;
  assert.equal(
    (await worker.fetch(req('/_next/static/chunks/client.js', false), env, {}))
      .status,
    403,
  );
  assert.equal(calls.length, 0);
});
await test('authenticated JS is served as JS instead of falling through to the app router', async () => {
  calls.length = 0;
  const response = await worker.fetch(
    req('/_next/static/chunks/client.js'),
    env,
    {},
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/javascript');
  assert.equal(await response.text(), 'export const ready=true;');
  assert.deepEqual(
    calls.map((c) => c.target),
    ['assets'],
  );
});
await test('missing chunks stay 404 while dynamic routes reach the app with forged headers removed', async () => {
  calls.length = 0;
  assert.equal(
    (await worker.fetch(req('/_next/static/chunks/missing.js'), env, {}))
      .status,
    404,
  );
  assert.deepEqual(
    calls.map((c) => c.target),
    ['assets'],
  );
  calls.length = 0;
  assert.equal(
    (await worker.fetch(req('/api/auth/session'), env, {})).status,
    200,
  );
  assert.deepEqual(
    calls.map((c) => c.target),
    ['assets', 'app'],
  );
  assert.equal(calls[1].headers.get('oai-authenticated-user-id'), null);
});
await test('scheduled jobs use the server credential, with no public login bypass', async () => {
  calls.length = 0;
  await assert.rejects(worker.scheduled({}, env, {}), /secret/);
  assert.equal(calls.length, 0);
  await worker.scheduled(
    {},
    { ...env, NOCT_JOBS_SECRET: 'synthetic-test-secret' },
    {},
  );
  assert.equal(calls[0].path, '/api/jobs/run');
  assert.equal(
    calls[0].headers.get('authorization'),
    'Bearer synthetic-test-secret',
  );
});
