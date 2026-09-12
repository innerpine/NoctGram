/* eslint-disable typescript/no-implied-eval */
// Real application modules and full migrations with synthetic SQLite/platform bindings.
// No requests reach a live Worker or external service.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const ROOT =
  process.env.NOCT_TEST_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OVERRIDES = process.env.NOCT_TEST_OVERRIDES || '';
const requireProject = createRequire(path.join(ROOT, 'package.json'));
const ts = requireProject('typescript');
const sql = new DatabaseSync(':memory:');
for (const { tag } of JSON.parse(
  readFileSync(path.join(ROOT, 'drizzle/meta/_journal.json'), 'utf8'),
).entries)
  sql.exec(readFileSync(path.join(ROOT, 'drizzle', tag + '.sql'), 'utf8'));
let beforeBatch = () => {};
let beforeRun = () => {};
const d = {
  prepare(query) {
    return {
      query,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        return sql.prepare(query).get(...this.args) || null;
      },
      async all() {
        return { results: sql.prepare(query).all(...this.args) };
      },
      async run() {
        beforeRun(query);
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
      const result = list.map((s) => {
        const q = sql.prepare(s.query);
        const results = q.columns().length
          ? q.all(...s.args)
          : (q.run(...s.args), []);
        return {
          results,
          meta: { changes: sql.prepare('SELECT changes() n').get().n },
        };
      });
      sql.exec('COMMIT');
      return result;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
const env = { DB: d, FILES: {} };
let requestHeaders = new Headers();
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const loadedModule = { exports: {} };
  cache.set(file, loadedModule);
  const override = OVERRIDES && path.join(OVERRIDES, path.relative(ROOT, file));
  const source = readFileSync(
    override && existsSync(override) ? override : file,
    'utf8',
  );
  if (path.extname(file) === '.json') {
    loadedModule.exports = JSON.parse(source);
    return loadedModule.exports;
  }
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: file,
  }).outputText;
  function importModule(spec) {
    if (spec === 'cloudflare:workers') return { env };
    // Call scheduling has its own isolated lifecycle and delivery regressions.
    if (spec === 'next/server') return { after: () => undefined };
    if (spec === 'next/headers')
      return {
        headers: async () => requestHeaders,
        cookies: async () => ({ get: () => undefined }),
      };
    if (spec === 'next/navigation')
      return {
        redirect: (value) => {
          throw new Error('REDIRECT ' + value);
        },
      };
    if (spec.startsWith('.') || spec.startsWith('@/')) {
      const next = spec.startsWith('@/')
        ? path.join(ROOT, spec.slice(2))
        : path.resolve(path.dirname(file), spec);
      return load(path.extname(next) ? next : next + '.ts');
    }
    return requireProject(spec);
  }
  new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    output,
  )(importModule, loadedModule, loadedModule.exports, file, path.dirname(file));
  return loadedModule.exports;
}
const source = (f) => load(path.join(ROOT, f));
const person = (id) => {
  sql
    .prepare(
      'INSERT INTO users(id,name,created,onboardingComplete) VALUES(?,?,?,1)',
    )
    .run(id, id, Date.now());
  sql
    .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
    .run(id + '_handle', id);
};
for (const id of ['alice', 'bob', 'mallory', 'moderator', 'victim', 'owner'])
  person(id);
const { deleteMessages } = source('lib/chat-actions.ts');
const { readConversation } = source('lib/chat-messages.ts');
const { moderationPost } = source('lib/moderation.ts');
const { contentModerationPost } = source('lib/content-moderation.ts');
const { identity, tokenHash } = source('lib/auth-session.ts');
const { accountAction } = source('lib/account-management.ts');
const socialRoute = source('app/api/social/route.ts');
const authRoute = source('app/api/auth/[action]/route.ts');
sql
  .prepare('INSERT INTO administrators(userId,created) VALUES(?,?)')
  .run('owner', Date.now());
let serial = 0;
function freshPerson(prefix) {
  const id = prefix + '_' + ++serial;
  person(id);
  return id;
}
const moderator = () => {
  const id = freshPerson('mod');
  sql
    .prepare('INSERT INTO moderators(userId,created) VALUES(?,?)')
    .run(id, Date.now());
  return id;
};
const revoke = (id) =>
  sql.prepare('DELETE FROM moderators WHERE userId=?').run(id);
const count = (table, field, value) =>
  sql.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${field}=?`).get(value).n;
const post = (author) => {
  const id = 'post_' + ++serial;
  sql
    .prepare('INSERT INTO posts(id,userId,text,created) VALUES(?,?,?,?)')
    .run(id, author, 'synthetic post', Date.now());
  return id;
};
function restrict(target) {
  const event = 'event_' + ++serial;
  sql
    .prepare(
      "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,?,'blocked','synthetic fixture',?)",
    )
    .run(event, target, 'owner', Date.now());
  sql
    .prepare(
      "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,'blocked','synthetic fixture',?)",
    )
    .run(target, event, Date.now());
  return event;
}
function appeal(target) {
  const event = restrict(target),
    id = 'appeal_' + ++serial;
  sql
    .prepare(
      'INSERT INTO moderation_appeals(id,userId,eventId,text,created) VALUES(?,?,?,?,?)',
    )
    .run(id, target, event, 'synthetic appeal', Date.now());
  return id;
}
function report(author, postId) {
  const id = 'report_' + ++serial;
  sql
    .prepare(
      "INSERT INTO content_reports(id,targetType,targetId,postId,userId,authorId,text,snapshot,reason,created,updated) VALUES(?,'post',?,?,?,?,?,'{}','synthetic report',?,?)",
    )
    .run(
      id,
      postId,
      postId,
      'bob',
      author,
      'synthetic reported post',
      Date.now(),
      Date.now(),
    );
  return id;
}
const statusConflict = (e) => e.status === 403 || e.status === 409;
async function check(name, fn) {
  await test(name, async () => {
    beforeBatch = () => {};
    beforeRun = () => {};
    try {
      await fn();
    } finally {
      beforeBatch = () => {};
      beforeRun = () => {};
    }
  });
}
await check(
  'F01: unset, misspelled, email and incomplete Access modes reject forged Sites headers; explicit hybrid works',
  async () => {
    requestHeaders = new Headers({
      'oai-authenticated-user-id': 'owner',
      'oai-authenticated-user-email': 'attacker@example.test',
    });
    for (const mode of [undefined, '', 'hybird', 'sites', 'email', 'access']) {
      if (mode === undefined) delete env.NOCT_AUTH_MODE;
      else env.NOCT_AUTH_MODE = mode;
      assert.equal(
        await identity(),
        null,
        'Unexpected Sites fallback for ' + mode,
      );
    }
    env.NOCT_AUTH_MODE = 'hybrid';
    assert.equal((await identity()).userId, 'owner');
    env.NOCT_DEPLOYMENT_TARGET = 'standalone';
    assert.equal(
      await identity(),
      null,
      'Standalone cannot accept Sites identity even if hybrid was selected',
    );
    delete env.NOCT_DEPLOYMENT_TARGET;
    requestHeaders.set('cookie', 'noct_session=invalid');
    assert.equal(
      await identity(),
      null,
      'Invalid session cannot fall back to Sites',
    );
  },
);
await check(
  'F01: email sessions remain valid without auth mode; expired sessions cannot fall back to hybrid',
  async () => {
    const token = 'a'.repeat(64),
      hash = await tokenHash(token);
    sql
      .prepare(
        'INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) VALUES(?,?,?,?,?)',
      )
      .run(hash, 'alice', Date.now(), Date.now() + 3600000, Date.now());
    requestHeaders = new Headers({
      cookie: 'noct_session=' + token,
      'oai-authenticated-user-id': 'owner',
      'oai-authenticated-user-email': 'owner@example.test',
    });
    delete env.NOCT_AUTH_MODE;
    assert.equal((await identity()).userId, 'alice');
    env.NOCT_AUTH_MODE = 'access';
    assert.equal(
      await identity(),
      null,
      'Access never accepts old email cookie',
    );
    env.NOCT_AUTH_MODE = 'hybrid';
    sql
      .prepare('UPDATE auth_sessions SET expiresAt=1 WHERE tokenHash=?')
      .run(hash);
    assert.equal(await identity(), null);
  },
);
const makeRequest = (
  actor,
  query,
  body,
  origin = 'https://synthetic.invalid',
) => {
  const headers = new Headers({
    'oai-authenticated-user-id': actor,
    'oai-authenticated-user-email': actor + '@example.test',
  });
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    headers.set('Origin', origin);
  }
  requestHeaders = headers;
  return new Request('https://synthetic.invalid/api/social' + query, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
};
await check(
  'F02: actual HTTP export excludes messages deleted for both; unrelated export contains neither copy',
  async () => {
    env.NOCT_AUTH_MODE = 'hybrid';
    for (const [id, text] of [
      ['deleted-message', 'deleted synthetic secret'],
      ['live-message', 'live synthetic text'],
    ])
      sql
        .prepare(
          'INSERT INTO messages(id,sender,recipient,text,created) VALUES(?,?,?,?,?)',
        )
        .run(id, 'alice', 'bob', text, Date.now());
    await assert.rejects(
      deleteMessages('mallory', {
        ids: ['deleted-message'],
        peer: 'alice',
        everyone: true,
      }),
      (e) => e.status === 403,
    );
    const body = {
      action: 'messageDelete',
      ids: ['deleted-message'],
      peer: 'bob',
      everyone: true,
    };
    assert.equal(
      (
        await socialRoute.POST(
          makeRequest('alice', '', body, 'https://evil.invalid'),
        )
      ).status,
      403,
    );
    assert.equal(
      sql
        .prepare('SELECT deletedAt FROM messages WHERE id=?')
        .get('deleted-message').deletedAt,
      0,
    );
    assert.equal(
      (await socialRoute.POST(makeRequest('alice', '', body))).status,
      200,
    );
    assert.equal(
      (await readConversation('bob', 'alice')).some(
        (m) => m.id === 'deleted-message',
      ),
      false,
    );
    for (const actor of ['alice', 'bob', 'mallory']) {
      const response = await socialRoute.GET(
        makeRequest(actor, '?action=exportAccount'),
      );
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(
        data.messages.some((m) => m.id === 'deleted-message'),
        false,
      );
      assert.equal(
        data.messages.some((m) => m.id === 'live-message'),
        actor !== 'mallory',
      );
    }
  },
);
await check(
  'Recovery and account safeguards: invalid/replayed codes, concurrent recovery, fresh proof and logout-all',
  async () => {
    env.NOCT_AUTH_MODE = 'email';
    const actor = freshPerson('recover'),
      code = 'b'.repeat(32),
      hash = await tokenHash(code);
    sql
      .prepare(
        'INSERT INTO auth_identities(subject,userId,email,created) VALUES(?,?,?,?)',
      )
      .run('subject_' + actor, actor, actor + '@example.test', Date.now());
    const request = new Request('https://synthetic.invalid/api/auth/recover', {
      headers: { 'cf-connecting-ip': '127.0.0.1' },
    });
    await assert.rejects(
      accountAction(request, 'recover', { code: 'c'.repeat(32) }),
      (e) => e.status === 400,
    );
    sql
      .prepare(
        'INSERT INTO recovery_codes(hash,userId,created,expiresAt) VALUES(?,?,?,?)',
      )
      .run(hash, actor, Date.now(), Date.now() + 3600000);
    const attempts = await Promise.allSettled([
      accountAction(request, 'recover', { code }),
      accountAction(request, 'recover', { code }),
    ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(count('auth_sessions', 'userId', actor), 1);
    assert.equal(count('recovery_codes', 'userId', actor), 0);
    const tokenCookie = attempts
      .find((r) => r.status === 'fulfilled')
      .value.headers.get('set-cookie')
      .split(';')[0];
    requestHeaders = new Headers({ cookie: tokenCookie });
    assert.equal((await identity()).userId, actor);
    await assert.rejects(
      accountAction(request, 'recover', { code }),
      (e) => e.status === 400,
    );
    const signedIn = new Request('https://synthetic.invalid/api/auth/action', {
      headers: { cookie: tokenCookie },
    });
    sql
      .prepare('UPDATE auth_sessions SET verifiedAt=? WHERE userId=?')
      .run(Date.now() - 301000, actor);
    for (const action of [
      'delete-account',
      'recovery-codes',
      'email-change-start',
    ])
      await assert.rejects(
        accountAction(signedIn, action, {
          confirm: 'УДАЛИТЬ',
          email: 'new@example.test',
        }),
        (e) => e.status === 403 && e.code === 'REAUTH_REQUIRED',
      );
    await accountAction(signedIn, 'logout-all', {});
    assert.equal(count('auth_sessions', 'userId', actor), 0);
    assert.equal(await identity(), null);
  },
);
await check(
  'Auth CSRF and Access mode checks run before recovery/email providers',
  async () => {
    const invoke = (origin, action = 'recover') => {
      const headers = { 'Content-Type': 'application/json' };
      if (origin !== undefined) headers.Origin = origin;
      return authRoute.POST(
        new Request('https://synthetic.invalid/api/auth/' + action, {
          method: 'POST',
          headers,
          body: '{}',
        }),
        { params: Promise.resolve({ action }) },
      );
    };
    env.NOCT_AUTH_MODE = 'email';
    for (const origin of [undefined, 'null', 'https://evil.invalid'])
      assert.equal((await invoke(origin)).status, 403);
    env.NOCT_AUTH_MODE = 'access';
    for (const action of [
      'start',
      'verify',
      'recover',
      'logout-all',
      'delete-account',
      'email-change-start',
    ])
      assert.equal(
        (await invoke('https://synthetic.invalid', action)).status,
        403,
      );
  },
);
await check(
  'F07: ordinary moderators and administrators can still apply and lift restrictions',
  async () => {
    const staff = moderator(),
      target = freshPerson('target');
    assert.equal(
      (
        await moderationPost(
          'moderate',
          {
            id: target,
            mode: 'blocked',
            reason: 'synthetic valid ban',
            minutes: null,
          },
          staff,
        )
      ).status,
      200,
    );
    assert.equal(count('account_restrictions', 'userId', target), 1);
    assert.equal(
      (
        await moderationPost(
          'moderate',
          {
            id: target,
            mode: 'active',
            reason: 'synthetic valid release',
            minutes: null,
          },
          'owner',
        )
      ).status,
      200,
    );
    assert.equal(count('account_restrictions', 'userId', target), 0);
  },
);
for (const change of ['revoke', 'restrict', 'promote-target'])
  await check(
    'F07: ' +
      change +
      ' during preflight cannot commit a ban or cancel scheduled posts',
    async () => {
      const staff = moderator(),
        target = freshPerson('target'),
        p = post(target);
      sql
        .prepare('UPDATE posts SET publishAt=? WHERE id=?')
        .run(Date.now() + 3600000, p);
      beforeBatch = () => {
        beforeBatch = () => {};
        if (change === 'revoke') revoke(staff);
        else if (change === 'restrict') restrict(staff);
        else
          sql
            .prepare('INSERT INTO moderators(userId,created) VALUES(?,?)')
            .run(target, Date.now());
      };
      await assert.rejects(
        moderationPost(
          'moderate',
          {
            id: target,
            mode: 'blocked',
            reason: 'synthetic race',
            minutes: null,
          },
          staff,
        ),
        statusConflict,
      );
      assert.equal(count('account_restrictions', 'userId', target), 0);
      assert.equal(count('moderation_events', 'userId', target), 0);
      assert.equal(
        sql.prepare('SELECT cancelledAt FROM posts WHERE id=?').get(p)
          .cancelledAt,
        0,
      );
    },
  );
await check('F07: a revoked moderator cannot lift a restriction', async () => {
  const staff = moderator(),
    target = freshPerson('target');
  restrict(target);
  beforeBatch = () => {
    beforeBatch = () => {};
    revoke(staff);
  };
  await assert.rejects(
    moderationPost(
      'moderate',
      { id: target, mode: 'active', reason: 'synthetic race', minutes: null },
      staff,
    ),
    statusConflict,
  );
  assert.equal(count('account_restrictions', 'userId', target), 1);
  assert.equal(count('moderation_events', 'userId', target), 1);
});
for (const decision of ['accepted', 'dismissed'])
  await check(
    'F07: revoked moderator cannot mark an appeal ' + decision,
    async () => {
      const staff = moderator(),
        target = freshPerson('target'),
        id = appeal(target);
      beforeBatch = () => {
        beforeBatch = () => {};
        revoke(staff);
      };
      await assert.rejects(
        moderationPost(
          'reviewAppeal',
          { id, decision, note: 'synthetic race' },
          staff,
        ),
        statusConflict,
      );
      assert.equal(
        sql.prepare('SELECT status FROM moderation_appeals WHERE id=?').get(id)
          .status,
        'pending',
      );
      assert.equal(count('account_restrictions', 'userId', target), 1);
      assert.equal(count('moderation_events', 'userId', target), 1);
    },
  );
await check(
  'F07: a valid appeal decision still lifts its original restriction',
  async () => {
    const staff = moderator(),
      target = freshPerson('target'),
      id = appeal(target);
    assert.equal(
      (
        await moderationPost(
          'reviewAppeal',
          { id, decision: 'accepted', note: 'synthetic valid decision' },
          staff,
        )
      ).status,
      200,
    );
    assert.equal(
      sql.prepare('SELECT status FROM moderation_appeals WHERE id=?').get(id)
        .status,
      'accepted',
    );
    assert.equal(count('account_restrictions', 'userId', target), 0);
  },
);
await check(
  'F07: report review rechecks moderator permission inside its UPDATE',
  async () => {
    const staff = moderator(),
      author = freshPerson('author'),
      p = post(author),
      id = report(author, p);
    beforeRun = (query) => {
      if (query.startsWith('UPDATE content_reports')) {
        beforeRun = () => {};
        revoke(staff);
      }
    };
    await assert.rejects(
      contentModerationPost(
        'reviewReport',
        { id, status: 'closed', expectedStatus: 'new', note: 'synthetic race' },
        staff,
      ),
      statusConflict,
    );
    assert.equal(
      sql.prepare('SELECT status FROM content_reports WHERE id=?').get(id)
        .status,
      'new',
    );
    assert.equal(
      (
        await contentModerationPost(
          'reviewReport',
          {
            id,
            status: 'closed',
            expectedStatus: 'new',
            note: 'synthetic valid review',
          },
          'owner',
        )
      ).status,
      200,
    );
  },
);
for (const type of ['post', 'comment', 'story'])
  await check(
    'F07: ' +
      type +
      ' removal and evidence cannot commit after moderator revocation; valid admin removal works',
    async () => {
      const staff = moderator(),
        author = freshPerson('author');
      const p = post(author),
        id = type === 'post' ? p : type + '_' + ++serial;
      if (type === 'comment')
        sql
          .prepare(
            'INSERT INTO comments(id,postId,userId,text,created) VALUES(?,?,?,?,?)',
          )
          .run(id, p, author, 'synthetic comment', Date.now());
      if (type === 'story')
        sql
          .prepare(
            'INSERT INTO stories(id,userId,text,created,expiresAt) VALUES(?,?,?,?,?)',
          )
          .run(id, author, 'synthetic story', Date.now(), Date.now() + 3600000);
      const table =
        type === 'post' ? 'posts' : type === 'comment' ? 'comments' : 'stories';
      beforeBatch = () => {
        beforeBatch = () => {};
        revoke(staff);
      };
      await assert.rejects(
        contentModerationPost(
          'removeContent',
          { id, targetType: type, reason: 'synthetic race' },
          staff,
        ),
        statusConflict,
      );
      assert.equal(count(table, 'id', id), 1);
      assert.equal(count('content_removals', 'targetId', id), 0);
      assert.equal(
        (
          await contentModerationPost(
            'removeContent',
            { id, targetType: type, reason: 'synthetic valid removal' },
            'owner',
          )
        ).status,
        200,
      );
      assert.equal(count(table, 'id', id), 0);
      assert.equal(count('content_removals', 'targetId', id), 1);
    },
  );
await check(
  'Managed accounts require explicit grants and retain the personal login',
  async () => {
    const manager = freshPerson('manager'),
      teammate = freshPerson('teammate'),
      official = freshPerson('official');
    const cookie = 'c'.repeat(64),
      secondCookie = 'd'.repeat(64),
      foreignCookie = 'e'.repeat(64);
    for (const [value, id] of [
      [cookie, manager],
      [secondCookie, teammate],
      [foreignCookie, 'mallory'],
    ]) {
      sql
        .prepare(
          'INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) VALUES(?,?,?,?,?)',
        )
        .run(
          await tokenHash(value),
          id,
          Date.now(),
          Date.now() + 3600000,
          Date.now(),
        );
    }
    env.NOCT_AUTH_MODE = 'email';
    env.NOCT_DEPLOYMENT_TARGET = 'standalone';
    env.NOCT_MANAGED_ACCOUNTS = JSON.stringify({
      [manager]: [official],
      [teammate]: [official],
    });
    function authRequest(
      action,
      payload,
      sessionCookie = cookie,
      origin = 'https://synthetic.invalid',
    ) {
      requestHeaders = new Headers({
        cookie: 'noct_session=' + sessionCookie,
        Origin: origin,
        'Content-Type': 'application/json',
      });
      const req = new Request('https://synthetic.invalid/api/auth/' + action, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: requestHeaders,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      return payload === undefined
        ? authRoute.GET(req, { params: Promise.resolve({ action }) })
        : authRoute.POST(req, { params: Promise.resolve({ action }) });
    }
    const ownProfileBefore = JSON.stringify(
      sql.prepare('SELECT id,name,avatar FROM users WHERE id=?').get(manager),
    );
    const listed = await (await authRequest('accounts')).json();
    assert.deepEqual(
      new Set(listed.accounts.map((x) => x.id)),
      new Set([manager, official]),
    );
    assert.equal(
      (
        await authRequest(
          'switch-account',
          { accountId: official },
          foreignCookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await authRequest('switch-account', { accountId: 'owner' })).status,
      403,
    );
    assert.equal(
      (
        await authRequest(
          'switch-account',
          { accountId: official },
          cookie,
          'https://attacker.invalid',
        )
      ).status,
      403,
    );
    assert.equal(
      (await authRequest('switch-account', { accountId: official })).status,
      200,
    );
    assert.equal((await identity()).userId, official);
    assert.equal((await identity()).principalUserId, manager);
    assert.equal((await identity(false)).userId, manager);
    assert.equal((await authRequest('account')).status, 403);
    for (const action of [
      'email-change-start',
      'logout-all',
      'delete',
      'onboarding',
    ])
      assert.equal((await authRequest(action, {})).status, 403);
    assert.equal(
      (
        await authRequest('start', {
          email: 'synthetic@example.test',
          link: true,
        })
      ).status,
      403,
    );
    // Real social writes and authorization resolve the selected account, not the manager.
    requestHeaders = new Headers({
      cookie: 'noct_session=' + cookie,
      Origin: 'https://synthetic.invalid',
      'Content-Type': 'application/json',
    });
    const publish = await socialRoute.POST(
      new Request('https://synthetic.invalid/api/social', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          action: 'post',
          text: 'managed synthetic post',
          actor: official,
        }),
      }),
    );
    assert.equal(publish.status, 200);
    const publishedId = (await publish.json()).id;
    assert.equal(
      sql.prepare('SELECT userId FROM posts WHERE id=?').get(publishedId)
        .userId,
      official,
    );
    const stale = await socialRoute.GET(
      new Request(
        'https://synthetic.invalid/api/social?action=bootstrap&actor=' +
          manager,
        { headers: requestHeaders },
      ),
    );
    assert.equal(stale.status, 401);
    assert.equal(
      JSON.stringify(
        sql.prepare('SELECT id,name,avatar FROM users WHERE id=?').get(manager),
      ),
      ownProfileBefore,
    );
    // Each teammate chooses independently; switching one session does not change the other.
    assert.equal(
      (await (await authRequest('accounts', undefined, secondCookie)).json())
        .activeId,
      teammate,
    );
    assert.equal(
      (
        await authRequest(
          'switch-account',
          { accountId: official },
          secondCookie,
        )
      ).status,
      200,
    );
    assert.equal((await identity()).principalUserId, teammate);
    assert.equal(
      (await authRequest('switch-account', { accountId: manager })).status,
      200,
    );
    assert.equal((await identity()).userId, manager);
    assert.equal(
      sql
        .prepare('SELECT actingAs FROM auth_sessions WHERE tokenHash=?')
        .get(await tokenHash(secondCookie)).actingAs,
      official,
    );
    // Revoking the grant fails closed on the next request, but returning to self remains possible.
    assert.equal(
      (await authRequest('switch-account', { accountId: official })).status,
      200,
    );
    env.NOCT_MANAGED_ACCOUNTS = '{}';
    await assert.rejects(
      () => identity(),
      (e) => e.status === 403,
    );
    assert.equal(
      (await authRequest('switch-account', { accountId: manager })).status,
      200,
    );
    env.NOCT_MANAGED_ACCOUNTS = JSON.stringify({ [manager]: [official] });
    restrict(manager);
    assert.equal(
      (await authRequest('switch-account', { accountId: official })).status,
      403,
    );
    sql.prepare('DELETE FROM account_restrictions WHERE userId=?').run(manager);
    restrict(official);
    assert.equal(
      (await authRequest('switch-account', { accountId: official })).status,
      403,
    );
    sql
      .prepare('DELETE FROM account_restrictions WHERE userId=?')
      .run(official);
    assert.equal(
      (await authRequest('switch-account', { accountId: official })).status,
      200,
    );
    sql
      .prepare('DELETE FROM auth_sessions WHERE tokenHash=?')
      .run(await tokenHash(cookie));
    assert.equal(await identity(), null);
    assert.equal((await authRequest('accounts')).status, 401);
    assert.equal(
      (await authRequest('switch-account', { accountId: official })).status,
      401,
    );
    delete env.NOCT_MANAGED_ACCOUNTS;
    delete env.NOCT_DEPLOYMENT_TARGET;
  },
);
await check(
  'Public profile references resolve primary and extra handles, with exact legacy ID fallback',
  async () => {
    const reader = freshPerson('reader'),
      target = freshPerson('url_target'),
      other = freshPerson('other');
    env.NOCT_AUTH_MODE = 'hybrid';
    const get = async (query) =>
      socialRoute.GET(makeRequest(reader, '?action=profile&' + query));
    for (const ref of [
      target,
      target + '_handle',
      (target + '_handle').toUpperCase(),
    ]) {
      const response = await get('ref=' + encodeURIComponent(ref));
      assert.equal(response.status, 200);
      const profile = await response.json();
      assert.equal(profile.id, target);
      assert.equal(profile.handle, target + '_handle');
    }
    sql
      .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,0)')
      .run('public_alias', target);
    assert.equal(
      (await (await get('ref=public_alias')).json()).handle,
      target + '_handle',
    );
    assert.equal((await (await get('handle=public_alias')).json()).id, target);
    assert.equal((await get('ref=missing_profile')).status, 404);
    // A username matching somebody else's internal ID must still resolve as a username.
    sql
      .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,0)')
      .run(target, other);
    assert.equal((await (await get('ref=' + target)).json()).id, other);
    assert.equal((await (await get('id=' + target)).json()).id, target);
  },
);
await check(
  'All synthetic mutations preserve full-schema foreign keys',
  async () => {
    assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length, 0);
  },
);
sql.close();
