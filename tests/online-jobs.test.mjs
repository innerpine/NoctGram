import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const calls = [];
globalThis.__onlineJobs = { calls, failSnapshot: false };
const { outputFiles } = await build({
  entryPoints: ['app/api/jobs/run/route.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'isolated-jobs',
      setup(builder) {
        builder.onResolve({ filter: /^@\/lib\// }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: {
            '@/lib/auth-session': 'export const setting=()=>"fixture-secret";',
            '@/lib/storage': 'export const db=()=>({});',
            '@/lib/access-security':
              'export async function cleanAccessHistory(){globalThis.__onlineJobs.calls.push("access-cleanup"); if(globalThis.__onlineJobs.failAccess)throw new Error("cleanup failed");}',
            '@/lib/admin-online':
              'export async function recordOnlineSnapshot(){ globalThis.__onlineJobs.calls.push("online"); if(globalThis.__onlineJobs.failSnapshot) throw new Error("snapshot failed"); }',
            '@/lib/giveaways':
              'export async function settleDueGiveaways(){globalThis.__onlineJobs.calls.push("giveaways"); return {completed:0,failed:0};}',
            '@/lib/notifications':
              'export async function flushPush(){globalThis.__onlineJobs.calls.push("push"); return {delivered:0};}',
            '@/lib/calls':
              'export async function expireCalls(){globalThis.__onlineJobs.calls.push("calls");}',
            '@/lib/antispam':
              'export async function cleanSpamActivity(){globalThis.__onlineJobs.calls.push("antispam");}',
            '@/lib/upload-storage':
              'export async function cleanUploads(){globalThis.__onlineJobs.calls.push("uploads"); return 0;}',
          }[path],
        }));
      },
    },
  ],
});
const { POST } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const request = (query = '', authorized = true) =>
  new Request('https://noct.test/api/jobs/run' + query, {
    method: 'POST',
    headers: authorized ? { Authorization: 'Bearer fixture-secret' } : {},
  });
await test('anonymous callers cannot record samples or run maintenance', async () => {
  calls.length = 0;
  assert.equal((await POST(request('?onlineOnly=1', false))).status, 401);
  assert.deepEqual(calls, []);
});
await test('minute-only job does not run five-minute maintenance', async () => {
  calls.length = 0;
  assert.equal((await POST(request('?onlineOnly=1'))).status, 200);
  assert.deepEqual(calls, ['online', 'giveaways']);
});
await test('full job records online and preserves existing maintenance', async () => {
  calls.length = 0;
  assert.deepEqual(await (await POST(request())).json(), {
    delivered: 0,
    uploads: 0,
    giveaways: { completed: 0, failed: 0 },
  });
  assert.deepEqual(calls, [
    'online',
    'giveaways',
    'calls',
    'antispam',
    'push',
    'uploads',
    'access-cleanup',
  ]);
});
await test('access cleanup failure does not prevent existing maintenance', async () => {
  calls.length = 0;
  globalThis.__onlineJobs.failAccess = true;
  try {
    await assert.rejects(POST(request()), /cleanup failed/);
    assert.deepEqual(calls, [
      'online',
      'giveaways',
      'calls',
      'antispam',
      'push',
      'uploads',
      'access-cleanup',
    ]);
  } finally {
    globalThis.__onlineJobs.failAccess = false;
  }
});
await test('sampling failure surfaces without preventing maintenance from starting', async () => {
  calls.length = 0;
  globalThis.__onlineJobs.failSnapshot = true;
  await assert.rejects(POST(request()), /snapshot failed/);
  await Promise.resolve();
  assert.ok(calls.includes('calls'));
  assert.ok(calls.includes('uploads'));
  globalThis.__onlineJobs.failSnapshot = false;
});
delete globalThis.__onlineJobs;
