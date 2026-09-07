import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
// Run only against the dedicated local QA Worker with NOCT_PREMIUM_TEST_MODE=1.
const base = 'http://127.0.0.1:8787',
  stamp = Date.now();
const a = 'premium_a_' + stamp,
  b = 'premium_b_' + stamp,
  mod = 'mod_qa_admin';
const headers = (id) => ({
  'oai-authenticated-user-id': id,
  'oai-authenticated-user-email': id + '@example.com',
  Origin: base,
});
async function api(id, q = '', body) {
  const r = await fetch(base + '/api/social' + q, {
    headers: { ...headers(id), 'Content-Type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
async function ok(id, q = '', body) {
  const r = await api(id, q, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function deny(id, body) {
  const r = await api(id, '', body);
  assert.ok([400, 403, 404, 409].includes(r.status), JSON.stringify(r));
}
async function upload(id, bytes, type) {
  const form = new FormData();
  form.set('file', new File([bytes], 'qa-avatar', { type }));
  const r = await fetch(base + '/api/upload', {
    headers: headers(id),
    method: 'POST',
    body: form,
  });
  assert.equal(r.status, 200);
  return r.json();
}
async function mediaStatus(id, url) {
  const r = await fetch(base + url, { headers: headers(id) });
  await r.arrayBuffer();
  return r.status;
}
function fixtureSQL(sql) {
  assert.match(sql, new RegExp(a));
  const qa = path.resolve('work/features-qa');
  assert.ok(qa.startsWith(path.resolve('work') + path.sep));
  execFileSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'DB',
      '--config',
      'wrangler.local.json',
      '--local',
      '--persist-to',
      qa,
      '--command',
      sql,
    ],
    { stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
  );
}
const pa = (await ok(a, '?action=bootstrap')).me;
await ok(b, '?action=bootstrap');
await ok(mod, '?action=bootstrap');
const design = {
  action: 'appearance',
  theme: 'rose',
  nameGradient: true,
  ringText: 'Своя орбита ☾',
  avatarMotion: '',
  poster: '',
};
assert.equal(pa.premium, 0);
await deny(a, design);
await ok(a, '', {
  action: 'profile',
  name: pa.name,
  bio: '',
  avatar: '',
  cover: '',
  premium: 1,
  profileTheme: 'rose',
  nameGradient: true,
});
assert.equal(
  (await ok(a, '?action=profile')).premium,
  0,
  'Profile endpoint cannot grant Premium',
);
assert.equal((await ok(a, '?action=premium')).testMode, true);
assert.equal(
  (await ok(a, '', { action: 'activatePremiumTest', id: b })).premium,
  1,
);
assert.equal(
  (await ok(b, '?action=profile')).premium,
  0,
  'Activation targets the caller',
);
const expiry = (await ok(a, '?action=premium')).expiresAt;
await ok(a, '', { action: 'activatePremiumTest' });
assert.equal(
  (await ok(a, '?action=premium')).expiresAt,
  expiry,
  'No repeated extension',
);
let styled = await ok(a, '', design);
assert.equal(styled.nameGradient, 1);
assert.equal(styled.ringText, design.ringText);
assert.equal(styled.profileTheme, 'rose');
await deny(a, { ...design, theme: 'url(javascript:bad)' });
await deny(a, { ...design, nameGradient: 'true' });
await deny(a, { ...design, ringText: 'x'.repeat(49) });
await deny(a, { ...design, ringText: 'text\u202eevil' });
await ok(a, '', { ...design, ringText: 'Семья 👨‍👩‍👧' });
const gif = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64',
);
const motion = await upload(a, gif, 'image/gif'),
  poster = await upload(a, png, 'image/png'),
  foreign = await upload(b, gif, 'image/gif'),
  foreignPoster = await upload(b, png, 'image/png');
assert.equal(
  await mediaStatus(b, motion.url),
  404,
  'Unpublished avatar stays private',
);
await deny(a, { ...design, avatarMotion: motion.url });
await deny(a, { ...design, avatarMotion: foreign.url, poster: poster.url });
await deny(a, {
  ...design,
  avatarMotion: motion.url,
  poster: foreignPoster.url,
});
await deny(a, { ...design, avatarMotion: motion.url, poster: motion.url });
const animated = { ...design, avatarMotion: motion.url, poster: poster.url };
styled = await ok(a, '', animated);
assert.equal(styled.avatar, poster.url);
assert.equal(styled.avatarMotion, motion.url);
assert.equal(styled.avatarMotionType, 'image/gif');
assert.equal(
  await mediaStatus(b, motion.url),
  200,
  'Published active avatar is readable',
);
await deny(b, {
  action: 'profile',
  name: 'Not Premium',
  bio: '',
  avatar: foreign.url,
  cover: '',
});
await deny(b, {
  action: 'createChannel',
  name: 'No animation',
  handle: 'nogif_' + stamp,
  avatar: foreign.url,
});
await ok(a, '', {
  action: 'profile',
  name: pa.name,
  bio: 'Preserve animation',
  avatar: poster.url,
  cover: '',
});
assert.equal(
  (await ok(a, '?action=profile')).avatarMotion,
  motion.url,
  'Text-only edits preserve motion',
);
const postResult = await ok(a, '', {
  action: 'post',
  text: 'premium fixture ' + stamp,
});
const rows = await ok(b, '?action=feed&user=' + a),
  post = rows.find((p) => p.id === postResult.id);
assert.ok(post);
assert.equal(post.premium, 1);
assert.equal(post.avatarMotion, motion.url);
const comment = await ok(a, '', {
  action: 'comment',
  id: post.id,
  text: 'premium comment',
});
assert.equal(comment.profileTheme, 'rose');
await ok(b, '', { action: 'follow', id: a, value: true });
const following = await ok(b, '?action=connections&kind=following&id=' + b);
assert.equal(following.people.find((p) => p.id === a).premium, 1);
await ok(a, '', { action: 'message', id: b, text: 'premium DM' });
assert.equal(
  (await ok(b, '?action=threads')).find((p) => p.id === a).avatarMotion,
  motion.url,
);
await ok(a, '', { action: 'story', text: 'premium story' });
assert.equal(
  (await ok(b, '?action=stories')).find((p) => p.userId === a).premium,
  1,
);
const channel = await ok(a, '', {
  action: 'createChannel',
  name: 'Plain channel',
  handle: 'premium_ch_' + stamp,
});
assert.equal(channel.premium, 0, 'Channels do not inherit owner cosmetics');
await ok(a, '', { ...animated, id: channel.id });
assert.equal((await ok(a, '?action=profile&id=' + channel.id)).premium, 0);
await ok(mod, '', {
  action: 'moderate',
  id: a,
  mode: 'read_only',
  reason: 'Premium QA read-only',
  minutes: 60,
});
await deny(a, animated);
await deny(a, { action: 'activatePremiumTest' });
await ok(mod, '', {
  action: 'moderate',
  id: a,
  mode: 'active',
  reason: 'Premium QA restore',
  minutes: null,
});
fixtureSQL(`UPDATE premium_entitlements SET expiresAt=1 WHERE userId='${a}';`);
const expired = await ok(b, '?action=profile&id=' + a);
assert.equal(expired.premium, 0);
assert.equal(expired.nameGradient, 0);
assert.equal(expired.ringText, '');
assert.equal(expired.avatarMotion, '');
assert.equal(expired.avatar, poster.url);
assert.equal(
  await mediaStatus(b, motion.url),
  404,
  'Expired motion is no longer public',
);
await deny(a, animated);
await deny(a, { action: 'activatePremiumTest' });
fixtureSQL(
  `UPDATE premium_entitlements SET expiresAt=${Date.now() + 86400000} WHERE userId='${a}';`,
);
assert.equal(
  (await ok(a, '?action=profile')).ringText,
  design.ringText,
  'Cosmetics resume after renewal',
);
await ok(a, '', {
  action: 'profile',
  name: pa.name,
  bio: 'Replace avatar',
  avatar: '',
  cover: '',
});
assert.equal(
  (await ok(a, '?action=profile')).avatarMotion,
  '',
  'Replacing the normal avatar clears motion',
);
await ok(a, '', animated);
fixtureSQL(
  `UPDATE premium_entitlements SET revokedAt=${Date.now()} WHERE userId='${a}';`,
);
assert.equal(
  (await ok(a, '?action=profile')).premium,
  0,
  'Revoked Premium cannot render cosmetics',
);
assert.equal(await mediaStatus(b, motion.url), 404);
console.log(
  'PASS Premium: entitlements, spoofing, expiry/revocation, projections, static/motion ownership, channel scope, read-only, media access.',
);
