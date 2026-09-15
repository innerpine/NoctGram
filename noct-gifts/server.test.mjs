import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createNoctGiftsServer } from './server.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

function request(origin, target, { method = 'GET', body, headers = {}, chunks } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const req = http.request({ hostname: url.hostname, port: url.port, path: target, method, headers }, (res) => {
      const result = [];
      res.on('data', (chunk) => result.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(result).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (chunks) for (const chunk of chunks) req.write(chunk);
    req.end(body);
  });
}

async function fixture(t, options = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'noct-gifts-server-test-'));
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const received = { path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
    seen.push(received);
    if (options.respond) return options.respond(req, res, received);
    if (req.url.startsWith('/assets/')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Set-Cookie': 'should-not-escape=1' });
      res.end('public-art');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'should-not-escape=1' });
      res.end(JSON.stringify({ ok: true, route: req.url }));
    }
  });
  const upstreamOrigin = await listen(upstream);
  const server = createNoctGiftsServer({ rootDir, upstreamOrigin, host: '127.0.0.1', ...options.server });
  const origin = await listen(server);
  t.after(async () => { await close(server); await close(upstream); await rm(rootDir, { recursive: true, force: true }); });
  const put = async (file, content = file) => {
    const target = path.join(rootDir, file);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content);
  };
  const post = (target, body = { initData: 'test-init-data' }, headers = {}) => request(origin, target, {
    method: 'POST', body: JSON.stringify(body), headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
  });
  return { rootDir, upstreamOrigin, server, origin, seen, put, post };
}

void test('avatar proxy forwards only Telegram authentication and returns private image bytes',async t=>{
  const f=await fixture(t,{respond(req,res){res.writeHead(200,{'Content-Type':'image/webp','Set-Cookie':'private=1'});res.end('avatar-bytes');}});
  const result=await f.post('/api/noct-gifts/avatar',{initData:'signed-fixture'},{Cookie:'session=private',Authorization:'Bearer private'});
  assert.equal(result.status,200);assert.equal(result.body,'avatar-bytes');
  assert.equal(result.headers['content-type'],'image/webp');
  assert.match(result.headers['cache-control'],/private.*no-store/);
  assert.equal(result.headers['set-cookie'],undefined);
  assert.equal(f.seen[0].path,'/api/noct-gifts/avatar');assert.equal(f.seen[0].body,JSON.stringify({initData:'signed-fixture'}));
  assert.equal(f.seen[0].headers.cookie,undefined);assert.equal(f.seen[0].headers.authorization,undefined);
});
void test('avatar proxy refuses HTML in place of image bytes',async t=>{
  const f=await fixture(t,{respond(req,res){res.writeHead(200,{'Content-Type':'text/html'});res.end('<script>private</script>');}});
  const result=await f.post('/api/noct-gifts/avatar');assert.equal(result.status,502);
  assert.ok(!result.body.includes('<script>'));
});

void test('serves only the explicit app files and public local assets, including HEAD', async (t) => {
  const f = await fixture(t);
  for (const file of ['index.html', 'Noct Gifts App.dc.html', 'motion.css', 'effects.js', 'account-bridge.js', 'support.js', 'assets/icon.png', 'assets/gifts/gift.json', 'assets/vendor/lottie_light.min.js']) {
    await f.put(file);
    const result = await request(f.origin, '/' + file.split('/').map(encodeURIComponent).join('/'));
    assert.equal(result.status, 200, file);
    assert.equal(result.body, file);
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  assert.equal((await request(f.origin, '/?view=case')).body, 'index.html');
  assert.equal((await request(f.origin, '/index.html', { method: 'HEAD' })).body, '');
  assert.equal((await request(f.origin, '/index.html', { method: 'POST' })).status, 405);
  assert.equal(f.seen.length, 0);
});

void test('private files, source, tests, directories and encoded traversal never become public', async (t) => {
  const f = await fixture(t);
  for (const file of ['.env', '.git/config', 'server.mjs', 'server.test.mjs', 'prototype.test.mjs', 'README.md', 'update-prototype.py', 'db/data.json', 'assets/db/data.json', 'assets/source/app.js', 'assets/test/app.js', 'assets/app.test.js', 'assets/gifts/.secret.json', 'assets/gifts/private.map']) await f.put(file, 'private-value');
  await f.put('index.html', 'PUBLIC');
  for (const target of [
    '/.env', '/%2eenv', '/.git/config', '/server.mjs', '/server.test.mjs', '/prototype.test.mjs', '/README.md',
    '/update-prototype.py', '/db/data.json', '/assets/db/data.json', '/assets/source/app.js', '/assets/test/app.js',
    '/assets/app.test.js', '/assets/gifts/.secret.json', '/assets/gifts/private.map', '/assets/', '/assets',
    '/assets/../index.html', '/assets/%2e%2e/index.html', '/assets/%252e%252e/index.html',
    '/assets/%2e%2e%2findex.html', '/assets/%5c..%5cindex.html', '/assets//icon.png',
    '//index.html', '/index.html%00.png', '/%zz', '/index.html.', '/assets/icon.png:secret',
  ]) {
    const result = await request(f.origin, target);
    assert.equal(result.status, 404, target);
    assert.ok(!result.body.includes('private-value'), target);
  }
  assert.equal(f.seen.length, 0);
});

void test('a public asset symlink cannot reveal a private file', async (t) => {
  const f = await fixture(t);
  await f.put('.env', 'private-value');
  await mkdir(path.join(f.rootDir, 'assets'));
  try { await symlink(path.join(f.rootDir, '.env'), path.join(f.rootDir, 'assets', 'gift.json'), 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Creating symlinks is unavailable on this host'); return; } throw error; }
  const result = await request(f.origin, '/assets/gift.json');
  assert.equal(result.status, 404);
  assert.ok(!result.body.includes('private-value'));
});

void test('account, topup and games forward only their JSON body to the fixed same-path upstream route', async (t) => {
  const f = await fixture(t);
  for (const [route, payload] of [
    ['/api/noct-gifts/account', { initData: 'signed-native-data' }],
    ['/api/noct-gifts/topup', { initData: 'signed-native-data', sku: 'stars-500', key: 'idempotency-key', acceptedTerms: true }],
    ['/api/noct-gifts/case', { initData: 'signed-native-data', caseId: 'moon', version: 'catalog-version', key: 'idempotency-key' }],
    ['/api/noct-gifts/upgrade', { initData: 'signed-native-data', receiptId: 'owned-gift', targetGiftId: 'plush_pepe', version: 'catalog-version', key: 'idempotency-key' }],
  ]) {
    const result = await f.post(route, payload, { Cookie: 'private-cookie=secret', Authorization: 'Bearer private-token', 'X-Forwarded-Host': 'attacker.invalid' });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).route, route);
    assert.equal(result.headers['cache-control'], 'private, no-store');
    assert.equal(result.headers['set-cookie'], undefined);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
    const forwarded = f.seen.at(-1);
    assert.equal(forwarded.method, 'POST');
    assert.equal(forwarded.path, route);
    assert.deepEqual(JSON.parse(forwarded.body), payload);
    assert.equal(forwarded.headers.origin, f.upstreamOrigin);
    for (const forbidden of ['cookie', 'authorization', 'x-forwarded-host']) assert.equal(forwarded.headers[forbidden], undefined);
  }
});

void test('API rejects unknown routes, query strings and all non-POST methods without upstream access', async (t) => {
  const f = await fixture(t);
  for (const route of ['/api/other', '/api/noct-gifts', '/api/noct-gifts/account/extra', '/api/noct-gifts/account?initData=secret']) {
    assert.equal((await f.post(route)).status, 404, route);
  }
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const result = await request(f.origin, '/api/noct-gifts/account', { method, headers: { Origin: f.origin } });
    assert.equal(result.status, 405, method);
    assert.equal(result.headers.allow, 'POST');
  }
  assert.equal(f.seen.length, 0);
});

void test('API requires exact incoming Origin and rejects a rebinding Host', async (t) => {
  const f = await fixture(t);
  for (const origin of ['https://attacker.invalid', 'null', f.origin + '/', f.origin.replace('127.0.0.1', 'localhost'), 'http://127.0.0.1:1']) {
    assert.equal((await f.post('/api/noct-gifts/account', {}, { Origin: origin })).status, 403, origin);
  }
  assert.equal((await request(f.origin, '/api/noct-gifts/account', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).status, 403);
  const evilHost = 'attacker.invalid:' + new URL(f.origin).port;
  assert.equal((await f.post('/api/noct-gifts/account', {}, { Host: evilHost, Origin: 'http://' + evilHost })).status, 403);
  assert.equal(f.seen.length, 0);
});

void test('a configured HTTPS tunnel origin works alongside local access without trusting forwarded headers', async (t) => {
  const publicOrigin = 'https://noct-gifts-example.trycloudflare.com';
  const publicHost = new URL(publicOrigin).host;
  const f = await fixture(t, { server: { publicOrigin } });
  await f.put('index.html', 'PUBLIC');
  assert.equal((await request(f.origin, '/', { headers: { Host: publicHost } })).status, 200);
  assert.equal((await f.post('/api/noct-gifts/account', {}, { Host: publicHost, Origin: publicOrigin })).status, 200);
  assert.equal((await f.post('/api/noct-gifts/account')).status, 200, 'Local development must continue to work');
  const count = f.seen.length;
  for (const headers of [
    { Host: publicHost, Origin: publicOrigin.replace('https:', 'http:') },
    { Host: publicHost, Origin: 'https://attacker.trycloudflare.com' },
    { Host: 'attacker.trycloudflare.com', Origin: 'https://attacker.trycloudflare.com', 'X-Forwarded-Host': publicHost, 'X-Forwarded-Proto': 'https' },
    { Origin: publicOrigin, 'X-Forwarded-Host': publicHost, 'X-Forwarded-Proto': 'https' },
    { Host: publicHost, Origin: f.origin },
  ]) assert.equal((await f.post('/api/noct-gifts/account', {}, headers)).status, 403);
  assert.equal(f.seen.length, count);
});

void test('API rejects oversized declared and chunked bodies and validates JSON content', async (t) => {
  const f = await fixture(t);
  const headers = { Origin: f.origin, 'Content-Type': 'application/json' };
  const huge = JSON.stringify({ initData: 'x'.repeat(32768) });
  assert.equal((await request(f.origin, '/api/noct-gifts/account', { method: 'POST', body: huge, headers: { ...headers, 'Content-Length': Buffer.byteLength(huge) } })).status, 413);
  assert.equal((await request(f.origin, '/api/noct-gifts/account', { method: 'POST', chunks: ['{"initData":"', 'x'.repeat(16384), 'x'.repeat(16384), '"}'], headers })).status, 413);
  for (const body of ['broken', '[]', 'null', '"string"']) assert.equal((await request(f.origin, '/api/noct-gifts/account', { method: 'POST', body, headers })).status, 400);
  assert.equal((await f.post('/api/noct-gifts/account', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.post('/api/noct-gifts/account', {}, { 'Content-Encoding': 'gzip' })).status, 415);
  assert.equal(f.seen.length, 0);
});

void test('public remote gift art maps only to fixed /assets paths and never forwards cookies', async (t) => {
  const f = await fixture(t);
  for (const extension of ['png', 'webp', 'svg', 'json', 'tgs']) {
    const result = await request(f.origin, '/noctgram-assets/gifts/gift.' + extension, { headers: { Cookie: 'private=secret', Authorization: 'Bearer secret' } });
    assert.equal(result.status, 200, extension);
    assert.equal(result.body, 'public-art');
    assert.equal(f.seen.at(-1).path, '/assets/gifts/gift.' + extension);
    assert.equal(f.seen.at(-1).headers.cookie, undefined);
    assert.equal(f.seen.at(-1).headers.authorization, undefined);
    assert.equal(result.headers['set-cookie'], undefined);
  }
  const head = await request(f.origin, '/noctgram-assets/gifts/gift.webp', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(f.seen.at(-1).method, 'HEAD');
  const count = f.seen.length;
  for (const target of ['/noctgram-assets/gift.js', '/noctgram-assets/gift.html', '/noctgram-assets/', '/noctgram-assets/../api/noct-gifts/account', '/noctgram-assets/%2e%2e/.env', '/noctgram-assets/https:%2f%2fattacker.invalid/a.png', '/noctgram-assets/gift.png?url=https://attacker.invalid']) assert.equal((await request(f.origin, target)).status, 404, target);
  assert.equal((await request(f.origin, '/noctgram-assets/gift.png', { method: 'POST' })).status, 405);
  assert.equal(f.seen.length, count);
});

void test('upstream errors and redirects cannot expose secrets or change the destination', async (t) => {
  const f = await fixture(t, { respond(req, res) {
    const status = Number(req.headers['content-length']) ? 500 : 302;
    res.writeHead(status, { 'Content-Type': 'application/json', Location: 'http://attacker.invalid/', 'Set-Cookie': 'secret-cookie' });
    res.end('{"error":"database password=secret-token; stack trace"}');
  } });
  const result = await f.post('/api/noct-gifts/account');
  assert.equal(result.status, 502);
  assert.ok(!result.body.includes('secret'));
  assert.ok(!result.body.includes('stack'));
  assert.equal(result.headers['set-cookie'], undefined);
  const asset = await request(f.origin, '/noctgram-assets/gift.png');
  assert.equal(asset.status, 502);
  assert.equal(asset.headers.location, undefined);
  assert.equal(f.seen.length, 2);
});

void test('upstream non-JSON and malformed success responses are safely rejected', async (t) => {
  let count = 0;
  const f = await fixture(t, { respond(req, res) {
    res.writeHead(200, { 'Content-Type': count++ ? 'application/json' : 'text/html' });
    res.end('<pre>secret-token stack trace</pre>');
  } });
  for (let i = 0; i < 2; i++) {
    const result = await f.post('/api/noct-gifts/account');
    assert.equal(result.status, 502);
    assert.ok(!result.body.includes('secret-token'));
  }
});

void test('oversized upstream JSON is rejected without returning its contents', async (t) => {
  const f = await fixture(t, { respond(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ private: 'secret-token'.repeat(100000) }));
  } });
  const result = await f.post('/api/noct-gifts/account');
  assert.equal(result.status, 502);
  assert.ok(!result.body.includes('secret-token'));
});

void test('upstream requests have a bounded timeout', async (t) => {
  const f = await fixture(t, { server: { upstreamTimeoutMs: 50 }, respond() {} });
  const result = await f.post('/api/noct-gifts/account');
  assert.equal(result.status, 504);
  assert.equal(result.headers['cache-control'], 'private, no-store');
});

void test('an unfinished incoming body times out without reaching the upstream', async (t) => {
  const f = await fixture(t, { server: { bodyTimeoutMs: 50 } });
  const result = await new Promise((resolve, reject) => {
    const req = http.request(f.origin + '/api/noct-gifts/account', {
      method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); req.destroy(); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write('{"initData":"');
  });
  assert.equal(result.status, 408);
  assert.equal(f.seen.length, 0);
});

void test('the trusted upstream setting must be a plain HTTP(S) origin', () => {
  for (const upstreamOrigin of ['file:///tmp/', 'http://user:secret@127.0.0.1:3000', 'http://127.0.0.1:3000/api', 'http://127.0.0.1:3000?token=secret']) {
    assert.throws(() => createNoctGiftsServer({ upstreamOrigin }), TypeError);
  }
  for (const publicOrigin of ['http://public.example', 'https://public.example/path', 'https://user:secret@public.example']) {
    assert.throws(() => createNoctGiftsServer({ publicOrigin }), TypeError);
  }
});
