import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { sites } from '@openai/sites-vite-plugin';

const { outputFiles } = await build({
  entryPoints: ['scripts/local-test-accounts.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { localTestAccounts } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const handlers = [];
const plugins = localTestAccounts(sites());
for (const plugin of plugins) {
  if (plugin.name !== 'sites') assert.equal(plugin.apply, 'serve');
  plugin.configureServer({
    config: { server: {}, logger: { info() {} } },
    middlewares: {
      use(handler) {
        handlers.push(handler);
      },
    },
  });
}
const server = http.createServer((req, res) => {
  let index = 0;
  const next = () => {
    if (handlers[index]) return handlers[index++](req, res, next);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: req.headers['oai-authenticated-user-id'] || null,
        name: req.headers['oai-authenticated-user-full-name'] || null,
        cookie: req.headers.cookie || '',
        rawIds: req.rawHeaders.filter(
          (_, i) =>
            i % 2 === 0 &&
            req.rawHeaders[i].toLowerCase() === 'oai-authenticated-user-id',
        ).length,
      }),
    );
  };
  next();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const request = (path, options = {}) =>
  fetch(origin + path, { redirect: 'manual', ...options });
// Node's fetch normalizes Host; use HTTP directly for hostile Host checks.
const hostRequest = (path, headers) =>
  new Promise((resolve, reject) => {
    const req = http.get(origin + path, { headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve(
          new Response(Buffer.concat(chunks), {
            status: res.statusCode,
            headers: res.headers,
          }),
        ),
      );
    });
    req.on('error', reject);
  });
const login = (account) =>
  request('/__dev/accounts', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'account=' + account,
  });
try {
  let response = await request('/__dev/accounts');
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('referrer-policy'),
    'same-origin',
    'HTML form submissions must retain their same-origin Origin header',
  );
  assert.match(await response.text(), /Тестовый друг/);
  assert.match(
    response.headers.get('content-security-policy'),
    /form-action 'self'/,
  );
  assert.equal(
    response.headers.get('set-cookie'),
    null,
    'Viewing the picker does not switch accounts',
  );
  response = await hostRequest('/__dev/accounts', {
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-User': '?1',
  });
  assert.equal(
    response.status,
    200,
    'The picker can be opened from an external link',
  );
  assert.equal(response.headers.get('set-cookie'), null);
  for (const [mode, dest] of [
    ['no-cors', 'script'],
    ['navigate', 'iframe'],
    ['cors', 'empty'],
  ]) {
    response = await hostRequest('/__dev/accounts', {
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': mode,
      'Sec-Fetch-Dest': dest,
    });
    assert.equal(
      response.status,
      403,
      'Embedded or scripted cross-site requests stay blocked',
    );
  }
  response = await login('friend');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/music?tab=playlists');
  const cookies = response.headers.getSetCookie();
  const friendCookie = cookies[0].split(';')[0];
  assert.equal(friendCookie, '__sites_local_auth=friend');
  assert.match(cookies[0], /HttpOnly; SameSite=Lax/);
  assert.ok(cookies.some((c) => c.startsWith('noct_session=; Max-Age=0')));
  const mainCookie = (await login('main')).headers
    .getSetCookie()[0]
    .split(';')[0];
  const users = await Promise.all(
    [mainCookie, friendCookie].map(async (cookie) =>
      (await request('/identity', { headers: { Cookie: cookie } })).json(),
    ),
  );
  assert.deepEqual(
    users.map((u) => u.id),
    ['local_seedy', 'local_music_friend'],
  );
  assert.equal(decodeURIComponent(users[1].name), 'Тестовый друг');
  assert.equal(users[1].rawIds, 1);
  assert.equal(
    users[1].cookie,
    '',
    'Sites still strips its internal login cookie',
  );
  response = await request('/identity', {
    headers: {
      Cookie: friendCookie,
      'oai-authenticated-user-id': 'forged-admin',
      'oai-authenticated-user-full-name': 'Forged',
    },
  });
  assert.equal((await response.json()).id, 'local_music_friend');
  for (const cookie of [
    '',
    '__sites_local_auth=unknown',
    '__sites_local_auth=friend; __sites_local_auth=1',
  ]) {
    response = await request('/identity', {
      headers: { Cookie: cookie, 'oai-authenticated-user-id': 'forged-admin' },
    });
    assert.equal((await response.json()).id, null);
  }
  response = await hostRequest('/identity', {
    Host: 'public.example',
    Cookie: friendCookie,
    'oai-authenticated-user-id': 'forged-admin',
  });
  assert.equal(
    (await response.json()).id,
    null,
    'Public hosts cannot use test identity',
  );
  response = await hostRequest('/__dev/accounts', { Host: 'public.example' });
  assert.equal(response.status, 403);
  for (const extra of [
    { Origin: 'https://foreign.example' },
    { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
    { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
    {},
  ]) {
    response = await request('/__dev/accounts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...extra,
      },
      body: 'account=friend',
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal((await login('arbitrary-user')).status, 400);
  assert.equal((await login('friend&account=main')).status, 400);
  assert.equal((await login('x'.repeat(2000))).status, 413);
  response = await request('/__dev/accounts', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 415);
  response = await request('/__dev/accounts', { method: 'DELETE' });
  assert.equal(response.status, 405);
  response = await request('/signout-with-chatgpt?return_to=%2Flogin', {
    headers: { Cookie: friendCookie },
  });
  assert.equal(response.status, 302);
  assert.match(
    response.headers.get('set-cookie'),
    /__sites_local_auth=;.*Max-Age=0/,
  );

  // Even if the dev server is exposed to a LAN, only actual loopback peers may
  // select the local friend; forwarding headers never establish local access.
  let passed = false;
  handlers[0](
    {
      url: '/__dev/accounts',
      method: 'GET',
      headers: { host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1' },
      socket: { remoteAddress: '192.0.2.3' },
    },
    {
      setHeader() {},
      end() {
        assert.equal(this.statusCode, 403);
        passed = true;
      },
    },
    () => assert.fail('Nonlocal request must not reach the app'),
  );
  assert.equal(passed, true);
  console.log(
    'Local accounts: isolated browsers, real Sites middleware, logout, cookie/header boundaries, origin/peer restrictions and bounded login requests passed.',
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
