import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:8787',
  run = Date.now();
// Apply tests/fixtures/moderation.sql and tests/fixtures/auth.sql to the isolated store first.
// An isolated local email provider: it never sends mail and is never bundled in the app.
const mail = new Map(),
  subjects = new Map();
let verificationCalls = 0;
const provider = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const b = JSON.parse(raw || '{}');
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.apikey !== 'qa-publishable') {
    res.writeHead(401);
    return res.end('{}');
  }
  if (req.url === '/auth/v1/otp') {
    if (b.email.startsWith('unavailable')) {
      res.writeHead(503);
      return res.end('{}');
    }
    if (!subjects.has(b.email)) subjects.set(b.email, randomUUID());
    mail.set(b.email, {
      code: String(Math.floor(100000 + Math.random() * 900000)),
      used: false,
    });
    return res.end('{}');
  }
  if (req.url === '/auth/v1/verify') {
    verificationCalls++;
    const entry = mail.get(b.email);
    if (!entry || entry.used || entry.code !== b.token || b.type !== 'email') {
      res.writeHead(403);
      return res.end('{}');
    }
    entry.used = true;
    return res.end(
      JSON.stringify({
        access_token: 'provider-token-not-for-browser',
        refresh_token: 'refresh-not-for-browser',
        user: {
          id: subjects.get(b.email),
          email: b.email,
          email_confirmed_at: b.email.startsWith('unconfirmed')
            ? null
            : new Date().toISOString(),
        },
      }),
    );
  }
  res.writeHead(404);
  res.end('{}');
});
await new Promise((resolve) => provider.listen(8791, '127.0.0.1', resolve));
let nextIp = 1;
function browser(legacy) {
  return { cookies: new Map(), ip: '192.0.2.' + nextIp++, legacy };
}
async function api(jar, path, body, extras = {}) {
  const response = await fetch(base + path, {
    headers: {
      Connection: 'close', // Isolate requests from Wrangler's unread-body keep-alive quirk.
      'Content-Type': 'application/json',
      Origin: base,
      'cf-connecting-ip': jar.ip,
      ...(jar.legacy
        ? {
            'oai-authenticated-user-id': jar.legacy,
            'oai-authenticated-user-email': jar.legacy + '@example.com',
          }
        : {}),
      Cookie: Array.from(jar.cookies, ([k, v]) => k + '=' + v).join('; '),
      ...extras,
    },
    ...(body !== undefined
      ? { method: 'POST', body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(15000),
    redirect: 'manual',
  });
  const cookies = response.headers.getSetCookie();
  for (const c of cookies) {
    const pair = c.split(';')[0],
      at = pair.indexOf('='),
      key = pair.slice(0, at),
      value = pair.slice(at + 1);
    if (value) jar.cookies.set(key, value);
    else jar.cookies.delete(key);
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 250) };
  }
  return { status: response.status, data, cookies, headers: response.headers };
}
async function ok(jar, path, body) {
  const r = await api(jar, path, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r;
}
const status = async (jar) => (await ok(jar, '/api/auth/session')).data;
const start = (jar, email, link = false) =>
  ok(jar, '/api/auth/start', { email, link });
const verify = (jar, email) =>
  ok(jar, '/api/auth/verify', { code: mail.get(email).code });
async function register(jar, prefix) {
  const email = prefix + run + '@example.com';
  await start(jar, email);
  await verify(jar, email);
  return email;
}
async function upload(jar) {
  const form = new FormData();
  form.set(
    'file',
    new File(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      'avatar.png',
      { type: 'image/png' },
    ),
  );
  const r = await fetch(base + '/api/upload', {
    method: 'POST',
    body: form,
    headers: {
      Origin: base,
      Cookie: Array.from(jar.cookies, ([k, v]) => k + '=' + v).join('; '),
    },
  });
  assert.equal(r.status, 200);
  return r.json();
}
try {
  const a = browser(),
    b = browser();
  const configured = await status(a);
  assert.equal(
    configured.sitesEnabled,
    true,
    'Start the isolated test Worker with --var NOCT_AUTH_MODE:hybrid for trusted Sites fixtures',
  );
  assert.equal(configured.emailEnabled, true);
  assert.equal((await status(a)).user, null);
  const expiredSession = browser('mod_qa_admin');
  expiredSession.cookies.set('noct_session', 'a'.repeat(64));
  assert.equal(
    (await status(expiredSession)).user,
    null,
    'Expired sessions cannot fall back to Sites',
  );
  const expiredChallenge = browser();
  expiredChallenge.cookies.set('noct_email_challenge', 'b'.repeat(64));
  assert.equal(
    (await api(expiredChallenge, '/api/auth/verify', { code: '123456' }))
      .status,
    400,
  );
  assert.equal(
    verificationCalls,
    0,
    'Expired challenges are rejected before calling Supabase',
  );
  assert.equal((await api(a, '/api/social?action=bootstrap')).status, 401);
  assert.equal(
    (await api(a, '/api/auth/start', { email: 'bad-email' })).status,
    400,
  );
  assert.equal(
    (
      await api(
        a,
        '/api/auth/start',
        { email: 'csrf@example.com' },
        { Origin: 'https://foreign.example' },
      )
    ).status,
    403,
  );
  await status(a); // Wrangler may restart its proxy after rejecting an unread body.
  assert.equal(
    (
      await api(
        a,
        '/api/auth/start',
        { email: 'csrf@example.com' },
        { Origin: '' },
      )
    ).status,
    403,
  );
  await status(a); // drain local proxy after a rejected request
  const emailA = 'alpha' + run + '@example.com';
  const sent = await start(a, '  ' + emailA.toUpperCase() + '  ');
  assert.ok(
    sent.cookies.some(
      (c) => c.includes('HttpOnly') && c.includes('SameSite=Lax'),
    ),
  );
  assert.ok(!JSON.stringify(sent.data).includes(mail.get(emailA).code));
  assert.equal((await status(a)).challenge.email, emailA);
  const cooldown = await api(a, '/api/auth/start', { email: emailA });
  assert.equal(cooldown.status, 429);
  assert.ok(Number(cooldown.headers.get('retry-after')) > 0);
  assert.equal(
    (await api(b, '/api/auth/verify', { code: mail.get(emailA).code })).status,
    400,
    'Challenge is bound to the requesting browser',
  );
  assert.equal(
    (await api(a, '/api/auth/verify', { code: '000000' })).status,
    400,
  );
  const pendingCookie = a.cookies.get('noct_email_challenge');
  const confirmed = await verify(a, emailA);
  assert.equal(confirmed.data.redirectTo, '/welcome');
  assert.ok(!JSON.stringify(confirmed.data).includes('provider-token'));
  assert.ok(
    confirmed.cookies.some(
      (c) => c.includes('noct_session=') && c.includes('HttpOnly'),
    ),
  );
  assert.equal(a.cookies.has('noct_email_challenge'), false);
  const before = await status(a);
  assert.equal(before.user.onboardingComplete, false);
  assert.equal(before.user.email, emailA);
  const userA = before.user.id;
  assert.equal((await api(a, '/api/social?action=bootstrap')).status, 428);
  assert.equal(
    (await api(a, '/api/social', { action: 'post', text: 'bypass' })).status,
    428,
  );
  assert.equal(
    (await api(a, '/api/auth/onboarding', { name: 'Test', handle: 'root' }))
      .status,
    409,
  );
  assert.equal(
    (await api(a, '/api/auth/onboarding', { name: '', handle: 'test_' + run }))
      .status,
    400,
  );
  assert.equal(
    (
      await api(a, '/api/auth/onboarding', {
        name: 'Test',
        handle: 'valid_' + run,
        avatar: 'https://foreign.example/a.png',
      })
    ).status,
    400,
  );
  const avatar = await upload(a);
  const preview = await fetch(base + avatar.url, {
    headers: { Cookie: 'noct_session=' + a.cookies.get('noct_session') },
  });
  assert.equal(preview.status, 200);
  await preview.arrayBuffer();
  const handle = 'email_' + run;
  await ok(a, '/api/auth/onboarding', {
    name: 'Email Author',
    handle,
    avatar: avatar.url,
  });
  const own = (await ok(a, '/api/social?action=bootstrap')).data.me;
  assert.equal(own.id, userA);
  assert.equal(own.handle, handle);
  assert.equal(own.avatar, avatar.url);
  assert.equal(own.canModerate, false);
  await ok(a, '/api/auth/onboarding', {
    name: 'Overwrite',
    handle: 'overwrite',
    avatar: '',
  });
  assert.equal(
    (await status(a)).user.name,
    'Email Author',
    'Onboarding is one-time',
  );
  const replay = browser();
  replay.cookies.set('noct_email_challenge', pendingCookie);
  assert.equal(
    (await api(replay, '/api/auth/verify', { code: mail.get(emailA).code }))
      .status,
    400,
  );
  const forged = browser('mod_qa_admin');
  forged.cookies.set('noct_session', 'f'.repeat(64));
  assert.equal(
    (await status(forged)).user,
    null,
    'Forged email session cannot fall back to a privileged Sites identity',
  );
  const emailB = await register(b, 'beta');
  assert.equal(
    (
      await api(b, '/api/auth/onboarding', {
        name: 'Other',
        handle,
        avatar: '',
      })
    ).status,
    409,
  );
  assert.equal((await status(b)).user.onboardingComplete, false);
  assert.equal(
    (
      await api(b, '/api/auth/onboarding', {
        name: 'Other',
        handle: 'other_' + run,
        avatar: avatar.url,
      })
    ).status,
    400,
  );
  await ok(b, '/api/auth/onboarding', {
    name: 'Other',
    handle: 'other_' + run,
    avatar: '',
  });
  const fullProfile = (await ok(b, '/api/social?action=profile&id=' + userA))
    .data;
  assert.equal(fullProfile.email, undefined, 'Email stays private');
  assert.equal(
    (await api(b, '/api/social?action=profile&id=auth_qa_pending')).status,
    404,
  );
  assert.equal(
    (
      await api(b, '/api/social', {
        action: 'follow',
        id: 'auth_qa_pending',
        value: true,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await api(b, '/api/social', {
        action: 'message',
        id: 'auth_qa_pending',
        text: 'hidden registration',
      })
    ).status,
    404,
  );
  const oldToken = b.cookies.get('noct_session');
  await ok(b, '/api/auth/logout', {});
  assert.equal((await status(b)).user, null);
  b.cookies.set('noct_session', oldToken);
  assert.equal(
    (await status(b)).user,
    null,
    'Logout revokes the server-side session',
  );
  b.cookies.clear();
  // Force only the isolated mock to treat the next email as the same verified provider identity.
  const returning = 'returning' + run + '@example.com';
  subjects.set(returning, subjects.get(emailB));
  await start(b, returning);
  await verify(b, returning);
  assert.equal(
    (await status(b)).user.onboardingComplete,
    true,
    'Returning accounts skip onboarding',
  );
  assert.equal((await status(b)).user.handle, 'other_' + run);
  const attempts = browser(),
    badMail = 'attempts' + run + '@example.com';
  await start(attempts, badMail);
  const calls = verificationCalls;
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await api(attempts, '/api/auth/verify', { code: '000000' })).status,
      400,
    );
  assert.equal(
    (await api(attempts, '/api/auth/verify', { code: mail.get(badMail).code }))
      .status,
    400,
  );
  assert.equal(
    verificationCalls - calls,
    5,
    'Attempt limit is enforced before the provider',
  );
  const unconfirmed = browser(),
    unconfirmedMail = 'unconfirmed' + run + '@example.com';
  await start(unconfirmed, unconfirmedMail);
  assert.equal(
    (
      await api(unconfirmed, '/api/auth/verify', {
        code: mail.get(unconfirmedMail).code,
      })
    ).status,
    400,
  );
  assert.equal((await status(unconfirmed)).user, null);
  const unavailable = browser();
  assert.equal(
    (
      await api(unavailable, '/api/auth/start', {
        email: 'unavailable' + run + '@example.com',
      })
    ).status,
    503,
  );
  assert.equal(
    (await status(unavailable)).challenge,
    null,
    'Failed delivery must not pretend a code was sent',
  );
  const legacy = browser('mod_qa_admin');
  const original = (await ok(legacy, '/api/social?action=bootstrap')).data.me;
  const linkMail = 'linked' + run + '@example.com';
  assert.equal(
    (await api(legacy, '/api/auth/start', { email: linkMail })).status,
    409,
  );
  await start(legacy, linkMail, true);
  assert.equal((await status(legacy)).challenge.link, true);
  await verify(legacy, linkMail);
  const linked = (await ok(legacy, '/api/social?action=bootstrap')).data.me;
  assert.equal(linked.id, original.id);
  assert.equal(linked.handle, original.handle);
  assert.equal(linked.canModerate, true);
  assert.equal((await status(legacy)).user.email, linkMail);
  assert.equal(
    (
      await api(a, '/api/auth/start', {
        email: 'oversize@example.com',
        padding: 'a'.repeat(5000),
      })
    ).status,
    413,
  );
  console.log(
    'PASS: email OTP and browser binding, CSRF/body limits, cooldown/attempt limits, provider errors, replay protection, private revocable sessions, returning identity, required onboarding, avatar ownership, reserved/conflicting usernames, profile preservation and moderator linking. No real email sent.',
  );
} finally {
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
}
