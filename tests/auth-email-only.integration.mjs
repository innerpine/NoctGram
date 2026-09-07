import assert from 'node:assert/strict';
const h = {
  'oai-authenticated-user-id': 'mod_qa_admin',
  'oai-authenticated-user-email': 'forged@example.com',
};
let r = await fetch('http://127.0.0.1:8787/api/auth/session', { headers: h });
assert.equal(r.status, 200);
const s = await r.json();
assert.equal(s.sitesEnabled, false);
assert.equal(s.user, null);
assert.equal(s.emailEnabled, false);
r = await fetch('http://127.0.0.1:8787/api/social?action=bootstrap', {
  headers: h,
});
assert.equal(r.status, 401);
await r.text();
r = await fetch('http://127.0.0.1:8787/api/auth/start', {
  method: 'POST',
  headers: {
    ...h,
    Origin: 'http://127.0.0.1:8787',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email: 'nobody@example.com' }),
});
assert.equal(r.status, 503);
assert.equal((await r.json()).code, 'EMAIL_NOT_CONFIGURED');
console.log(
  'PASS: email-only mode ignores forged Sites headers and fails closed without mail configuration.',
);
