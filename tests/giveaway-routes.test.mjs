import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = process.env.NOCT_GIVEAWAY_SOURCE || root;
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const errorModule = JSON.stringify(path.join(root, 'lib/api-error.ts'));
const stubs = {
  '@/lib/server': `import {ApiError,failure} from ${errorModule};
    export {ApiError,failure};
    export async function viewer(){const s=globalThis.__giveawayRoutes;s.calls.push(['viewer']);if(!s.actor)throw new ApiError(401,'Signed out');return s.actor;}`,
  '@/lib/account-access': `import {ApiError} from ${errorModule};
    export async function assertReadable(actor){const s=globalThis.__giveawayRoutes;s.calls.push(['readable',actor]);if(s.blocked)throw new ApiError(403,'Blocked');}
    export async function assertWritable(actor){const s=globalThis.__giveawayRoutes;s.calls.push(['writable',actor]);if(s.readOnly)throw new ApiError(403,'Read-only');}`,
  '@/lib/rate-limit': 'export async function rateLimit(...args){globalThis.__giveawayRoutes.calls.push(["rate",...args]);}',
  '@/lib/giveaways': `import {ApiError} from ${errorModule};
    export async function createGiveaway(actor,body){const s=globalThis.__giveawayRoutes;s.calls.push(['create',actor,body]);if(s.readOnly&&!s.committed)throw new ApiError(403,'Read-only','GIVEAWAY_REJECTED');return {giveaway:{id:'giveaway:receipt',creator:actor,totalCost:500},balance:4500};}
    export async function getGiveaway(actor,id){globalThis.__giveawayRoutes.calls.push(['get',actor,id]);return {id,status:'active'};}
    export async function settleDueGiveaways(){globalThis.__giveawayRoutes.calls.push(['settle']);return {completed:2,failed:0};}`,
  '@/lib/auth-session': 'export function setting(key){return key==="NOCT_JOBS_SECRET"?globalThis.__giveawayRoutes.jobsSecret:undefined;}',
  '@/lib/notifications': 'export async function flushPush(){globalThis.__giveawayRoutes.calls.push(["push"]);return {sent:3};}',
  '@/lib/calls': 'export async function expireCalls(){globalThis.__giveawayRoutes.calls.push(["calls"]);}',
  '@/lib/upload-storage': 'export async function cleanUploads(){globalThis.__giveawayRoutes.calls.push(["uploads"]);return {deleted:4};}',
};
async function route(file) {
  const compiled = await build({
    entryPoints: [path.join(source, file)], bundle: true, write: false,
    platform: 'node', format: 'esm',
    plugins: [{ name: 'isolated-route-contract', setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => stubs[args.path]
        ? { path: args.path, namespace: 'route-fixture' }
        : { path: path.join(root, args.path.slice(2) + '.ts') });
      build.onLoad({ filter: /.*/, namespace: 'route-fixture' }, (args) => ({ contents: stubs[args.path], resolveDir: root }));
    } }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
}
const giveaways = await route('app/api/giveaways/route.ts');
const jobs = await route('app/api/jobs/run/route.ts');
function setup() {
  return globalThis.__giveawayRoutes = { actor: 'owner', readOnly: false, blocked: false, committed: false, jobsSecret: 'isolated-test-secret', calls: [] };
}
const payload = () => ({ action: 'create', actor: 'owner', key: crypto.randomUUID(), targetKind: 'group', targetId: 'group', prize: 'premium', winnerCount: 1, starsPerWinner: 0, endsAt: Date.now() + 3600000 });
function request(body = payload(), headers = {}) {
  return new Request('https://noctgram.test/api/giveaways', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://noctgram.test', ...headers }, body: JSON.stringify(body) });
}
const mutations = (s) => s.calls.filter(([name]) => ['create', 'settle', 'push', 'calls', 'uploads'].includes(name));

test('session actor mismatch and missing actor never reach payment creation', async () => {
  for (const actor of ['different-account', undefined]) {
    const s = setup();
    const response = await giveaways.POST(request({ ...payload(), actor }));
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /Аккаунт изменился/);
    assert.deepEqual(mutations(s), []);
  }
});

test('cross-origin and cross-site requests fail before viewing or paying', async () => {
  for (const headers of [{ Origin: 'https://foreign.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const s = setup();
    const response = await giveaways.POST(request(payload(), headers));
    assert.equal(response.status, 403);
    assert.deepEqual(s.calls, []);
  }
});

test('matching authenticated actor delegates exact draft and returns private committed receipt', async () => {
  const s = setup(), body = payload();
  const response = await giveaways.POST(request(body));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(mutations(s), [['create', 'owner', body]]);
  assert.deepEqual(await response.json(), { giveaway: { id: 'giveaway:receipt', creator: 'owner', totalCost: 500 }, balance: 4500 });
});

test('read-only account can resolve a committed retry; new creation remains backend-rejected', async () => {
  const s = setup();
  s.readOnly = true;
  s.committed = true;
  let response = await giveaways.POST(request());
  assert.equal(response.status, 200);
  assert.equal(s.calls.some(([name]) => name === 'writable'), false);
  assert.equal(s.calls.filter(([name]) => name === 'create').length, 1);
  s.committed = false;
  response = await giveaways.POST(request());
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'GIVEAWAY_REJECTED');
});

test('GET respects session and readable guard before loading a private giveaway', async () => {
  let s = setup();
  s.blocked = true;
  let response = await giveaways.GET(new Request('https://noctgram.test/api/giveaways?id=secret'));
  assert.equal(response.status, 403);
  assert.equal(s.calls.some(([name]) => name === 'get'), false);
  s = setup();
  s.actor = null;
  response = await giveaways.GET(new Request('https://noctgram.test/api/giveaways?id=secret'));
  assert.equal(response.status, 401);
  assert.equal(s.calls.some(([name]) => name === 'get'), false);
});

test('jobs requires exact configured Bearer token and never acts on unauthorized calls', async () => {
  for (const [secret, authorization] of [['isolated-test-secret', ''], ['isolated-test-secret', 'Bearer wrong'], ['', 'Bearer ']]) {
    const s = setup();
    s.jobsSecret = secret;
    const response = await jobs.POST(new Request('https://noctgram.test/api/jobs/run?task=giveaways', { method: 'POST', headers: { authorization } }));
    assert.equal(response.status, 401);
    assert.deepEqual(mutations(s), []);
  }
});

test('authorized giveaway-only job settles prizes without sending push or other jobs', async () => {
  const s = setup();
  const response = await jobs.POST(new Request('https://noctgram.test/api/jobs/run?task=giveaways', { method: 'POST', headers: { authorization: 'Bearer isolated-test-secret' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { giveaways: { completed: 2, failed: 0 } });
  assert.deepEqual(s.calls, [['settle']]);
});

test('ordinary authorized jobs still settle prizes, calls, push and upload cleanup', async () => {
  const s = setup();
  const response = await jobs.POST(new Request('https://noctgram.test/api/jobs/run', { method: 'POST', headers: { authorization: 'Bearer isolated-test-secret' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { giveaways: { completed: 2, failed: 0 }, sent: 3, uploads: { deleted: 4 } });
  assert.deepEqual(s.calls, [['settle'], ['calls'], ['push'], ['uploads']]);
});
