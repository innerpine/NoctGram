/* eslint-disable typescript/no-implied-eval, typescript/await-thenable */
// In-memory security regression tests; no live email, network or data.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sql = new DatabaseSync(':memory:');
for (const { tag } of JSON.parse(
  readFileSync(ROOT + '/drizzle/meta/_journal.json', 'utf8'),
).entries)
  sql.exec(readFileSync(ROOT + '/drizzle/' + tag + '.sql', 'utf8'));
let beforeBatch = () => {};
const d = {
  prepare(query) {
    return {
      query,
      args: [],
      bind(...a) {
        this.args = a;
        return this;
      },
      async first() {
        return sql.prepare(query).get(...this.args) || null;
      },
      async all() {
        return { results: sql.prepare(query).all(...this.args) };
      },
      async run() {
        return {
          meta: { changes: sql.prepare(query).run(...this.args).changes },
        };
      },
    };
  },
  async batch(list) {
    beforeBatch(list);
    sql.exec('BEGIN');
    try {
      const r = list.map((s) => {
        const q = sql.prepare(s.query);
        let results = [];
        if (q.columns().length) results = q.all(...s.args);
        else q.run(...s.args);
        return {
          results,
          meta: { changes: sql.prepare('SELECT changes() n').get().n },
        };
      });
      sql.exec('COMMIT');
      return r;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function load(file, deps, names) {
  const s = stripTypeScriptTypes(readFileSync(ROOT + '/' + file, 'utf8'), {
    mode: 'transform',
  })
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*/gm, '')
    .replace(/\bexport /g, '');
  return new Function(
    ...Object.keys(deps),
    s + ';return{' + names.join(',') + '}',
  )(...Object.values(deps));
}
const hash = async (v) => createHash('sha256').update(v).digest('hex'),
  token = () => randomBytes(32).toString('hex'),
  cookieValue = (c, n) =>
    c
      ?.split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(n + '='))
      ?.slice(n.length + 1) || '';
let verifyHook = () => {},
  sendHook = () => {},
  viewerUser = 'a';
const subjects = new Map();
const deps = {
  db: () => d,
  ApiError,
  viewer: async () => viewerUser,
  clean: (v, max, required) => {
    if (
      typeof v !== 'string' ||
      v.trim().length > max ||
      (required && !v.trim())
    )
      throw new ApiError(400, 'invalid');
    return v.trim();
  },
  authCookie: (req, name, val) => name + '=' + val,
  cookieValue,
  tokenHash: hash,
  randomToken: token,
  SESSION_COOKIE: 'noct_session',
  CHALLENGE_COOKIE: 'noct_email_challenge',
  SESSION_SECONDS: 2592000,
  limit: async () => {},
  clientIp: () => '127.0.0.1',
  emailAddress: (v) => v.toLowerCase(),
  sendEmailCode: async (email) => {
    await sendHook(email);
  },
  verifyEmailCode: async (email) => {
    await verifyHook(email);
    return { subject: subjects.get(email), email };
  },
  storageUsage: async () => ({}),
  deleteAccount: async () => {},
};
const api = load('lib/account-management.ts', deps, [
  'accountAction',
  'accountStatus',
]);
const now = Date.now();
let serial = 0;
async function fixture() {
  serial++;
  const id = 'u' + serial,
    raw = token(),
    h = await hash(raw),
    email = id + '@example.test',
    sub = 'sub-' + id;
  sql
    .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
    .run(id, id, now);
  sql
    .prepare(
      'INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) VALUES(?,?,?,?,?)',
    )
    .run(h, id, now, now + 86400000, now);
  sql
    .prepare(
      'INSERT INTO auth_identities(subject,userId,email,created) VALUES(?,?,?,?)',
    )
    .run(sub, id, email, now);
  subjects.set(email, sub);
  const req = new Request('http://localhost/api/auth/action', {
    headers: { cookie: 'noct_session=' + raw },
  });
  return { id, raw, h, email, sub, req };
}
function challenge(f, purpose, email) {
  const id = token();
  sql
    .prepare(
      'INSERT INTO account_challenges(id,sessionHash,userId,purpose,subject,email,created,expiresAt) VALUES(?,?,?,?,?,?,?,?)',
    )
    .run(id, f.h, f.id, purpose, f.sub, email, now, now + 300000);
  return id;
}

const checks = [];
async function test(name, fn) {
  verifyHook = () => {};
  sendHook = () => {};
  beforeBatch = () => {};
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (error) {
    checks.push({ name, ok: false });
    console.error('FAIL ' + name + '\n  ' + error.stack);
  }
}
function statement(q, ...args) {
  return sql.prepare(q).run(...args);
}
function one(q, ...args) {
  return sql.prepare(q).get(...args);
}
function count(table, field, value) {
  return one(
    'SELECT COUNT(*) n FROM ' + table + ' WHERE ' + field + '=?',
    value,
  ).n;
}
const { deleteAccount } = load(
  'lib/account-removal.ts',
  { db: () => d, ApiError },
  ['deleteAccount'],
);
const mailDeps = {
  ...deps,
  assertStaticAvatar: async () => {},
  currentIdentity: async () => null,
  removePushDevice: async () => {},
  assertWritable: async () => {},
  getChatGPTUser: async () => null,
  CODE_SECONDS: 300,
  identity: async () => null,
  sitesAuthEnabled: () => false,
  emailConfig: () => ({}),
  requireEmailConfig: () => ({}),
};
const mailApi = load('lib/email-auth.ts', mailDeps, [
  'startEmail',
  'finishEmail',
]);
function emailRequest(raw) {
  return new Request('http://localhost/api/auth/verify', {
    headers: { cookie: 'noct_email_challenge=' + raw },
  });
}
async function loginChallenge(f) {
  const raw = token(),
    h = await hash(raw),
    created = Date.now() - 100;
  statement(
    'INSERT INTO auth_challenges(tokenHash,email,created,expiresAt) VALUES(?,?,?,?)',
    h,
    f.email,
    created,
    created + 300000,
  );
  return emailRequest(raw);
}

await test('reauth fails after session is revoked while provider verifies OTP', async () => {
  const f = await fixture(),
    c = challenge(f, 'reauth-start', f.email);
  verifyHook = () =>
    statement('DELETE FROM auth_sessions WHERE tokenHash=?', f.h);
  await assert.rejects(
    () =>
      api.accountAction(f.req, 'reauth-verify', {
        challengeId: c,
        code: '123456',
      }),
    (e) => e.status === 409,
  );
  assert.equal(count('auth_sessions', 'userId', f.id), 0);
});
await test('email change with a revoked session neither changes identity nor recreates access', async () => {
  const f = await fixture(),
    email = f.id + '-new@example.test',
    c = challenge(f, 'email-change-start', email);
  subjects.set(email, 'new-' + f.sub);
  verifyHook = () =>
    statement('DELETE FROM auth_sessions WHERE tokenHash=?', f.h);
  await assert.rejects(
    () =>
      api.accountAction(f.req, 'email-change-verify', {
        challengeId: c,
        code: '123456',
      }),
    (e) => e.status === 409,
  );
  assert.equal(
    one('SELECT email FROM auth_identities WHERE userId=?', f.id).email,
    f.email,
  );
  assert.equal(count('auth_sessions', 'userId', f.id), 0);
});
await test('email change succeeds, keeps exactly one authenticated session, revokes backup codes and challenges', async () => {
  const f = await fixture(),
    email = f.id + '-new@example.test',
    c = challenge(f, 'email-change-start', email);
  subjects.set(email, 'new-' + f.sub);
  statement(
    'INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) VALUES(?,?,?,?,?)',
    token(),
    f.id,
    now,
    now + 86400000,
    now,
  );
  statement(
    'INSERT INTO recovery_codes(hash,userId,created,expiresAt) VALUES(?,?,?,?)',
    token(),
    f.id,
    now,
    now + 86400000,
  );
  const response = await api.accountAction(f.req, 'email-change-verify', {
    challengeId: c,
    code: '123456',
  });
  assert.equal(response.status, 200);
  assert.equal(
    one('SELECT email FROM auth_identities WHERE userId=?', f.id).email,
    email,
  );
  assert.equal(count('auth_sessions', 'userId', f.id), 1);
  assert.equal(count('account_challenges', 'userId', f.id), 0);
  assert.equal(count('recovery_codes', 'userId', f.id), 0);
});
await test('email belonging to another account rolls the entire change back', async () => {
  const f = await fixture(),
    occupied = await fixture(),
    c = challenge(f, 'email-change-start', occupied.email);
  await assert.rejects(
    () =>
      api.accountAction(f.req, 'email-change-verify', {
        challengeId: c,
        code: '123456',
      }),
    (e) => e.status === 409,
  );
  assert.equal(
    one('SELECT email FROM auth_identities WHERE userId=?', f.id).email,
    f.email,
  );
  assert.equal(count('auth_sessions', 'userId', f.id), 1);
});
await test('fresh new-email OTP does not replace expired reauthentication of the existing account', async () => {
  const f = await fixture(),
    email = f.id + '-new@example.test',
    c = challenge(f, 'email-change-start', email);
  subjects.set(email, 'new-' + f.sub);
  statement(
    'UPDATE auth_sessions SET verifiedAt=? WHERE tokenHash=?',
    Date.now() - 600000,
    f.h,
  );
  await assert.rejects(
    () =>
      api.accountAction(f.req, 'email-change-verify', {
        challengeId: c,
        code: '123456',
      }),
    (e) => e.status === 409 || e.code === 'REAUTH_REQUIRED',
  );
  assert.equal(
    one('SELECT email FROM auth_identities WHERE userId=?', f.id).email,
    f.email,
  );
});
await test('a confirmation challenge is bound to its originating session', async () => {
  const f = await fixture(),
    other = await fixture(),
    c = challenge(f, 'reauth-start', f.email);
  await assert.rejects(
    () =>
      api.accountAction(other.req, 'reauth-verify', {
        challengeId: c,
        code: '123456',
      }),
    (e) => e.status === 400,
  );
  assert.equal(
    one('SELECT attempts FROM account_challenges WHERE id=?', c).attempts,
    0,
  );
});
await test('reauthentication stops after five failed provider verifications', async () => {
  const f = await fixture(),
    c = challenge(f, 'reauth-start', f.email);
  let providerCalls = 0;
  verifyHook = () => {
    providerCalls++;
    throw new ApiError(400, 'invalid fake code');
  };
  for (let i = 0; i < 6; i++)
    await assert.rejects(
      () =>
        api.accountAction(f.req, 'reauth-verify', {
          challengeId: c,
          code: '000000',
        }),
      (e) => e.status === 400,
    );
  assert.equal(providerCalls, 5);
});
await test('starting account OTP must fail if its session is revoked during email delivery', async () => {
  const f = await fixture();
  sendHook = () =>
    statement('DELETE FROM auth_sessions WHERE tokenHash=?', f.h);
  await assert.rejects(
    () => api.accountAction(f.req, 'reauth-start', {}),
    (e) => [401, 409].includes(e.status),
  );
  assert.equal(count('account_challenges', 'userId', f.id), 0);
});
await test('two concurrent recovery requests consume one code and create exactly one session', async () => {
  const f = await fixture(),
    code = randomBytes(16).toString('hex'),
    h = await hash(code);
  statement(
    'INSERT INTO recovery_codes(hash,userId,created,expiresAt) VALUES(?,?,?,?)',
    h,
    f.id,
    now,
    now + 86400000,
  );
  const results = await Promise.allSettled([
    api.accountAction(f.req, 'recover', { code }),
    api.accountAction(f.req, 'recover', { code }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(count('auth_sessions', 'userId', f.id), 1);
  assert.equal(count('recovery_codes', 'hash', h), 0);
});
await test('recovery cannot authenticate a tombstoned account', async () => {
  const f = await fixture(),
    code = randomBytes(16).toString('hex'),
    h = await hash(code);
  statement(
    'INSERT INTO recovery_codes(hash,userId,created,expiresAt) VALUES(?,?,?,?)',
    h,
    f.id,
    now,
    now + 86400000,
  );
  statement('UPDATE users SET deletedAt=? WHERE id=?', Date.now(), f.id);
  statement('DELETE FROM auth_sessions WHERE userId=?', f.id);
  await assert.rejects(
    () => api.accountAction(f.req, 'recover', { code }),
    (e) => e.status === 400,
  );
  assert.equal(count('auth_sessions', 'userId', f.id), 0);
});
await test('regenerating recovery codes invalidates the old batch and stores hashes only', async () => {
  const f = await fixture();
  const r1 = await api.accountAction(f.req, 'recovery-codes', {}),
    b1 = await r1.json();
  assert.equal(b1.codes.length, 8);
  const first = await hash(b1.codes[0].replaceAll('-', ''));
  assert.equal(count('recovery_codes', 'hash', first), 1);
  const r2 = await api.accountAction(f.req, 'recovery-codes', {}),
    b2 = await r2.json();
  assert.equal(b2.codes.length, 8);
  assert.equal(count('recovery_codes', 'hash', first), 0);
  for (const code of b2.codes) {
    assert.equal(count('recovery_codes', 'hash', code), 0);
    assert.equal(
      count('recovery_codes', 'hash', await hash(code.replaceAll('-', ''))),
      1,
    );
  }
});

await test('logout all removes sessions, pending challenges, push subscriptions, call credentials and ICE signals', async () => {
  const f = await fixture(),
    peer = await fixture();
  viewerUser = f.id;
  challenge(f, 'reauth-start', f.email);
  await loginChallenge(f);
  statement(
    'INSERT INTO push_subscriptions(id,userId,device,endpoint,p256dh,auth,created,expiresAt) VALUES(?,?,?,?,?,?,?,?)',
    'push-' + f.id,
    f.id,
    'device',
    'https://push.invalid/' + f.id,
    'fake',
    'fake',
    now,
    now + 86400000,
  );
  statement(
    'INSERT INTO calls(id,caller,callee,callerDevice,offer,answer,created,callerSeen,calleeSeen,expiresAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
    'call-' + f.id,
    f.id,
    peer.id,
    'device',
    'sdp',
    'sdp',
    now,
    now,
    now,
    now + 86400000,
  );
  statement(
    'INSERT INTO call_signals(callId,sender,key,candidate) VALUES(?,?,?,?)',
    'call-' + f.id,
    f.id,
    'signal',
    'ice',
  );
  const response = await api.accountAction(f.req, 'logout-all', {});
  assert.equal(response.status, 200);
  for (const t of ['auth_sessions', 'account_challenges', 'push_subscriptions'])
    assert.equal(count(t, 'userId', f.id), 0);
  assert.equal(count('auth_challenges', 'email', f.email), 0);
  const call = one(
    'SELECT status,offer,answer FROM calls WHERE id=?',
    'call-' + f.id,
  );
  assert.deepEqual({ ...call }, { status: 'ended', offer: null, answer: null });
  assert.equal(count('call_signals', 'callId', 'call-' + f.id), 0);
});

await test('deletion requires explicit owned-channel confirmation; revoked session is a no-op; valid batch preserves foreign data and ledger', async () => {
  const f = await fixture(),
    peer = await fixture(),
    ca = 'owned-' + f.id,
    cb = 'foreign-' + f.id;
  for (const [id, owner] of [
    [ca, f.id],
    [cb, peer.id],
  ])
    statement(
      "INSERT INTO users(id,name,created,kind,ownerId) VALUES(?,?,?,'channel',?)",
      id,
      id,
      now,
      owner,
    );
  const published = 'foreign-published-' + f.id,
    future = 'foreign-future-' + f.id,
    ownPost = 'own-post-' + f.id;
  for (const [id, user, publisher, publish] of [
    [ownPost, f.id, null, 0],
    ['channel-post-' + f.id, ca, f.id, 0],
    [published, cb, f.id, 0],
    [future, cb, f.id, now + 86400000],
  ])
    statement(
      'INSERT INTO posts(id,userId,text,publisherId,publishAt,created) VALUES(?,?,?,?,?,?)',
      id,
      user,
      id,
      publisher,
      publish,
      now,
    );
  statement(
    'INSERT INTO channel_members(channelId,userId,role,created) VALUES(?,?,?,?)',
    cb,
    f.id,
    'admin',
    now,
  );
  statement(
    'INSERT INTO star_transfers(id,sender,recipient,amount,kind,created) VALUES(?,?,?,?,?,?)',
    'transfer-' + f.id,
    f.id,
    peer.id,
    100,
    'support',
    now,
  );
  statement(
    'INSERT INTO messages(id,sender,recipient,text,created) VALUES(?,?,?,?,?)',
    'msg-' + f.id,
    peer.id,
    f.id,
    'received',
    now,
  );
  statement('INSERT INTO likes(postId,userId) VALUES(?,?)', ownPost, peer.id);
  statement(
    'INSERT INTO stories(id,userId,text,created,expiresAt) VALUES(?,?,?,?,?)',
    'story-' + f.id,
    f.id,
    'story',
    now,
    now + 86400000,
  );
  statement(
    'INSERT INTO story_views(storyId,userId,created) VALUES(?,?,?)',
    'story-' + f.id,
    peer.id,
    now,
  );
  const track = 'track-' + f.id,
    object = 'music/' + f.id + '/owned.mp3';
  statement(
    'INSERT INTO music_tracks(id,url,kind,title,artist,authorUrl,created) VALUES(?,?,?,?,?,?,?)',
    track,
    'https://soundcloud.com/qa/' + f.id,
    'track',
    'test',
    'test',
    'https://soundcloud.com/qa',
    now,
  );
  statement(
    'INSERT INTO music_audio(userId,trackId,objectKey,mime,size,created) VALUES(?,?,?,?,?,?)',
    f.id,
    track,
    object,
    'audio/mpeg',
    1024,
    now,
  );
  await assert.rejects(
    () => deleteAccount(f.id, f.h, false),
    (e) => e.status === 409,
  );
  await assert.rejects(
    () => deleteAccount(f.id, 'revoked', true),
    (e) => e.status === 409,
  );
  assert.equal(
    one('SELECT deletedAt FROM users WHERE id=?', f.id).deletedAt,
    0,
  );
  assert.equal(count('posts', 'id', ownPost), 1);
  statement(
    'INSERT INTO music_playlists(id,ownerId,name,created,updatedAt) VALUES(?,?,?,?,?)',
    'own-playlist',
    f.id,
    'Own',
    now,
    now,
  );
  statement(
    'INSERT INTO music_playlists(id,ownerId,name,created,updatedAt) VALUES(?,?,?,?,?)',
    'peer-playlist',
    peer.id,
    'Peer',
    now,
    now,
  );
  statement(
    "INSERT INTO music_playlist_members(playlistId,userId,status,created) VALUES('peer-playlist',?,'accepted',?)",
    f.id,
    now,
  );
  statement(
    "INSERT INTO music_activity(userId,sessionId,sequence,updatedAt,expiresAt) VALUES(?,'test',1,?,?)",
    f.id,
    now,
    now + 30000,
  );
  statement(
    'INSERT INTO chat_themes(firstId,secondId) VALUES(?,?)',
    f.id,
    peer.id,
  );
  await deleteAccount(f.id, f.h, true);
  assert.equal(count('music_playlists', 'ownerId', f.id), 0);
  assert.equal(count('music_playlists', 'ownerId', peer.id), 1);
  assert.equal(count('music_playlist_members', 'userId', f.id), 0);
  assert.equal(count('music_activity', 'userId', f.id), 0);
  assert.equal(count('chat_themes', 'firstId', f.id), 0);
  assert(one('SELECT deletedAt FROM users WHERE id=?', f.id).deletedAt > 0);
  assert(one('SELECT deletedAt FROM users WHERE id=?', ca).deletedAt > 0);
  assert.equal(
    one('SELECT deletedAt FROM users WHERE id=?', peer.id).deletedAt,
    0,
  );
  assert.equal(count('auth_sessions', 'userId', f.id), 0);
  assert.equal(count('posts', 'id', published), 1);
  assert(
    one('SELECT cancelledAt FROM posts WHERE id=?', future).cancelledAt > 0,
  );
  assert.equal(
    one('SELECT amount FROM star_transfers WHERE id=?', 'transfer-' + f.id)
      .amount,
    100,
  );
  assert.equal(count('music_audio', 'userId', f.id), 0);
  assert.equal(count('storage_deletions', 'objectKey', object), 1);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
});
await test('administrator deletion is rejected without mutating account data', async () => {
  const f = await fixture();
  statement(
    'INSERT INTO administrators(userId,created) VALUES(?,?)',
    f.id,
    now,
  );
  await assert.rejects(
    () => deleteAccount(f.id, f.h, true),
    (e) => e.status === 409,
  );
  assert.equal(
    one('SELECT deletedAt FROM users WHERE id=?', f.id).deletedAt,
    0,
  );
  assert.equal(count('auth_sessions', 'userId', f.id), 1);
});

// Regression tests below intentionally assert the desired behavior.
// They fail against the initial reviewed draft and should turn green after fixes.
await test('email login must report failure if a revoke wins between proof consumption and session insertion', async () => {
  const f = await fixture(),
    req = await loginChallenge(f);
  let raced = false;
  beforeBatch = (list) => {
    if (!raced && list.some((s) => /INSERT INTO auth_sessions/.test(s.query))) {
      raced = true;
      statement(
        'UPDATE users SET sessionsRevokedAt=? WHERE id=?',
        Date.now() + 1,
        f.id,
      );
      statement('DELETE FROM auth_sessions WHERE userId=?', f.id);
    }
  };
  await assert.rejects(
    () => mailApi.finishEmail(req, { code: '123456' }),
    (e) => [400, 401, 409].includes(e.status),
  );
  assert.equal(count('auth_sessions', 'userId', f.id), 0);
});
await test('OTP requested before logout all cannot gain a newer creation timestamp by a delayed send', async () => {
  const f = await fixture();
  statement('DELETE FROM auth_sessions WHERE userId=?', f.id);
  sendHook = async () => {
    statement(
      'UPDATE users SET sessionsRevokedAt=? WHERE id=?',
      Date.now(),
      f.id,
    );
    statement('DELETE FROM auth_challenges WHERE email=?', f.email);
    await new Promise((resolve) => setTimeout(resolve, 15));
  };
  const req = new Request('http://localhost/api/auth/start');
  let started;
  try {
    started = await mailApi.startEmail(req, { email: f.email });
  } catch (error) {
    assert([400, 401, 409].includes(error.status));
    return;
  }
  const pending = cookieValue(
    started.headers.getSetCookie().join(';'),
    'noct_email_challenge',
  );
  assert(pending, 'start provided a pending challenge');
  await assert.rejects(
    () => mailApi.finishEmail(emailRequest(pending), { code: '123456' }),
    (e) => [400, 401, 409].includes(e.status),
  );
  assert.equal(count('auth_sessions', 'userId', f.id), 0);
});
await test('legacy logout-all must reject unsupported scope or revoke Sites fallback on another device', async () => {
  const f = await fixture();
  viewerUser = f.id;
  statement('DELETE FROM auth_identities WHERE userId=?', f.id);
  statement('DELETE FROM auth_sessions WHERE userId=?', f.id);
  let accepted;
  try {
    accepted = await api.accountAction(f.req, 'logout-all', {});
  } catch (error) {
    assert([401, 403, 409].includes(error.status));
    return;
  }
  assert.equal(accepted.status, 200);
  const auth = load(
    'lib/auth-session.ts',
    {
      env: { NOCT_AUTH_MODE: 'hybrid' },
      headers: async () => new Headers(),
      getChatGPTUser: async () => ({ userId: f.id, fullName: 'legacy' }),
      db: () => d,
    },
    ['identity'],
  );
  assert.equal(
    await auth.identity(),
    null,
    'another browser still receives its Sites identity after logout-all',
  );
});
await test('all test mutations preserve foreign keys', async () => {
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
});
sql.close();
const failed = checks.filter((c) => !c.ok);
console.log(
  '\n' +
    checks.filter((c) => c.ok).length +
    '/' +
    checks.length +
    ' checks passed. ' +
    failed.length +
    ' failed.',
);
if (failed.length) process.exitCode = 1;
