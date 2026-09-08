// Requires the isolated account-qa Worker on :8787, never the user's live site.
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:8787',
  mails = new Map(),
  subjects = new Map(),
  run = Date.now();
const provider = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const b = JSON.parse(raw || '{}');
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.apikey !== 'qa-publishable') {
    res.writeHead(401);
    res.end('{}');
    return;
  }
  if (req.url === '/auth/v1/otp') {
    if (!subjects.has(b.email)) subjects.set(b.email, randomUUID());
    mails.set(b.email, '123456');
    res.end('{}');
    return;
  }
  if (req.url === '/auth/v1/verify' && mails.get(b.email) === b.token) {
    mails.delete(b.email);
    res.end(
      JSON.stringify({
        access_token: 'mock-only',
        user: {
          id: subjects.get(b.email),
          email: b.email,
          email_confirmed_at: new Date().toISOString(),
        },
      }),
    );
    return;
  }
  res.writeHead(403);
  res.end('{}');
});
await new Promise((resolve) => provider.listen(8791, '127.0.0.1', resolve));
const jar = (legacy = '') => ({ cookies: new Map(), legacy });
const headers = (j) => ({
  Origin: base,
  'Content-Type': 'application/json',
  Connection: 'close',
  Cookie: [...j.cookies].map(([k, v]) => k + '=' + v).join('; '),
  ...(j.legacy
    ? {
        'oai-authenticated-user-id': j.legacy,
        'oai-authenticated-user-email': j.legacy + '@example.test',
      }
    : {}),
});
async function api(j, path, body, status = 200) {
  const r = await fetch(base + path, {
    headers: headers(j),
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const line of r.headers.getSetCookie()) {
    const part = line.split(';')[0],
      i = part.indexOf('=');
    j.cookies.set(part.slice(0, i), part.slice(i + 1));
  }
  const data = await r.json();
  assert.equal(r.status, status, `${path}: ${JSON.stringify(data)}`);
  return data;
}
const auth = (j, action, b, status) => api(j, '/api/auth/' + action, b, status);
const social = (j, b, status) => api(j, '/api/social', b, status);
async function login(j, email, link = false) {
  await auth(j, 'start', { email, link });
  return auth(j, 'verify', { code: mails.get(email) });
}
try {
  const admin = jar('account_qa_admin'),
    plain = jar(),
    mod = jar('mod_qa_admin');
  await login(admin, `admin-${run}@example.test`, true);
  await login(plain, `person-${run}@example.test`);
  await auth(plain, 'onboarding', {
    name: 'QA Person',
    handle: 'qa_' + String(run),
    avatar: '',
  });
  const me = (await api(plain, '/api/social?action=bootstrap')).me;
  const a = (await api(admin, '/api/social?action=bootstrap')).me;
  assert.equal(a.canAdmin, true);
  assert.equal(me.canAdmin, false);
  const stars = {
    action: 'adminGrant',
    kind: 'stars',
    target: me.id,
    amount: 150,
    reason: 'Integration test',
    requestId: randomUUID(),
  };
  await social(plain, stars, 403);
  await social(mod, stars, 403);
  const before = await api(plain, '/api/social?action=wallet');
  await social(admin, stars);
  await social(admin, stars);
  await social(admin, { ...stars, amount: 151 }, 409);
  const after = await api(plain, '/api/social?action=wallet');
  assert.equal(after.balance, before.balance + 150);
  assert.equal(after.topupCount, before.topupCount + 1);
  await social(admin, {
    ...stars,
    kind: 'premium',
    amount: 30,
    requestId: randomUUID(),
  });
  await social(admin, {
    ...stars,
    kind: 'verified',
    amount: 1,
    requestId: randomUUID(),
  });
  await social(admin, {
    ...stars,
    kind: 'moderator',
    amount: 1,
    requestId: randomUUID(),
  });
  const granted = await api(plain, '/api/social?action=profile');
  assert.equal(granted.verified, 1);
  assert.equal(granted.premium, 1);
  assert.equal(granted.canModerate, true);
  assert.equal(granted.canAdmin, false);
  await social(plain, { ...stars, requestId: randomUUID() }, 403);
  console.log(
    'PASS HTTP administration gates, idempotent ledger, Premium, verification, moderator',
  );
  const csrf = await fetch(base + '/api/auth/recovery-codes', {
    method: 'POST',
    headers: { ...headers(plain), Origin: 'https://evil.example' },
    body: '{}',
  });
  assert.equal(csrf.status, 403);
  const codes = await auth(plain, 'recovery-codes', {});
  assert.equal(codes.codes.length, 8);
  const second = jar();
  await auth(second, 'recover', { code: codes.codes[0] });
  await api(plain, '/api/social?action=bootstrap', undefined, 401);
  await auth(jar(), 'recover', { code: codes.codes[0] }, 400);
  const changed = await auth(second, 'email-change-start', {
    email: `changed-${run}@example.test`,
  });
  await auth(second, 'email-change-verify', {
    challengeId: changed.challengeId,
    code: '123456',
  });
  const status = await auth(second, 'account');
  assert.equal(status.email, `changed-${run}@example.test`);
  assert.equal(status.recoveryCodes, 0);
  assert.equal((await api(second, '/api/social?action=profile')).id, me.id);
  console.log(
    'PASS HTTP recovery, old-session revocation, email change and CSRF',
  );
  const valid = new FormData();
  valid.set(
    'file',
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'qa.png', {
      type: 'image/png',
    }),
  );
  const h = headers(second);
  delete h['Content-Type'];
  const upload = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: h,
    body: valid,
  });
  assert.equal(upload.status, 200);
  const media = await upload.json();
  const post = await social(second, {
    action: 'post',
    text: 'QA retained upload',
    media: [media.id],
    poll: [],
  });
  assert.ok(post);
  const mediaResponse = await fetch(base + media.url, { headers: h });
  assert.equal(mediaResponse.status, 200);
  const duplicate = new FormData();
  duplicate.append('file', new File(['a'], 'a.png', { type: 'image/png' }));
  duplicate.append('file', new File(['b'], 'b.png', { type: 'image/png' }));
  const rejected = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: h,
    body: duplicate,
  });
  assert.equal(rejected.status, 400);
  // Stream without a Content-Length header, including all multipart fields.
  const boundary = 'noct-qa-boundary';
  let chunks = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (chunks === 0) {
        controller.enqueue(
          new TextEncoder().encode(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="huge.png"\r\nContent-Type: image/png\r\n\r\n`,
          ),
        );
        chunks++;
      } else if (chunks <= 26) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        chunks++;
      } else {
        controller.enqueue(new TextEncoder().encode(`\r\n--${boundary}--\r\n`));
        controller.close();
      }
    },
  });
  const large = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: {
      ...h,
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
    },
    body: stream,
    duplex: 'half',
  });
  assert.equal(large.status, 413);
  assert.ok((await large.text()).length);
  for (let i = 1; i < 5; i++)
    await social(second, {
      action: 'post',
      text: 'Rate ' + i,
      media: [],
      poll: [],
    });
  const limited = await fetch(base + '/api/social', {
    method: 'POST',
    headers: headers(second),
    body: JSON.stringify({
      action: 'post',
      text: 'Too many',
      media: [],
      poll: [],
    }),
  });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  console.log(
    'PASS HTTP uploads, duplicate fields, chunked size limit, post rate limit',
  );
  const deletion = jar();
  await login(deletion, `delete-${run}@example.test`);
  await auth(deletion, 'onboarding', {
    name: 'Delete QA',
    handle: 'delete_' + String(run),
    avatar: '',
  });
  const doomed = (await api(deletion, '/api/social?action=profile')).id;
  await auth(deletion, 'delete-account', {
    confirm: 'УДАЛИТЬ',
    deleteChannels: false,
  });
  await api(deletion, '/api/social?action=bootstrap', undefined, 401);
  await api(admin, '/api/social?action=profile&id=' + doomed, undefined, 404);
  await auth(second, 'logout-all', {});
  await api(second, '/api/social?action=bootstrap', undefined, 401);
  console.log('PASS HTTP account deletion, invisible tombstone, global logout');
  for (const path of ['/login', '/recover', '/assets/noct-verified.png']) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200);
    await r.arrayBuffer();
  }
  console.log('PASS built login/recovery pages and supplied verified asset');
} finally {
  await new Promise((resolve) => provider.close(resolve));
}
