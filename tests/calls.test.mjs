/**
 * Isolated call/TURN regressions against CURRENT project TypeScript and real migrations.
 * Run: node --test tests/calls.test.mjs
 * Run from the project directory, or copy this file into the project's tests directory.
 * No .env, network, Worker,
 * browser, disk database, or production secrets are used. All credentials below are fixtures.
 * D1 is modeled by SQLite :memory: with atomic SQL/batches and controllable interleavings.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto, randomUUID, createHmac } from 'node:crypto';
import test from 'node:test';
import { compileFunction } from 'node:vm';

const root = [
  process.cwd(),
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
].find((p) => existsSync(join(p, 'lib/turn.ts')));
assert.ok(
  root,
  'Run from the project directory or place this file in its tests directory.',
);
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const cached = new Map();
const source = (name) => {
  if (!cached.has(name))
    cached.set(name, readFileSync(join(root, name), 'utf8'));
  return cached.get(name);
};
const journal = JSON.parse(source('drizzle/meta/_journal.json')).entries;
assert.ok(
  journal.some((e) => e.tag.startsWith('0015_')),
  'The journal must include the call negotiation migration.',
);
const migrations = journal.map((e) => [
  e.tag,
  source('drizzle/' + e.tag + '.sql'),
]);
const NOW = Date.UTC(2026, 8, 8, 12, 0, 0, 875);
const CALLER_DEVICE = 'caller_device_fixture_001';
const CALLEE_DEVICE = 'callee_device_fixture_001';
const FOREIGN_DEVICE = 'another_device_fixture_001';
const API_TOKEN = 'fixture-provider-token-never-a-real-secret';
const SETTINGS = {
  NOCT_TURN_PROVIDER: 'cloudflare',
  NOCT_CF_TURN_KEY_ID: 'fixture_key_12345',
  NOCT_CF_TURN_API_TOKEN: API_TOKEN,
};
const sdp = (ufrag, suffix = '') =>
  [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=fixture',
    't=0 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=mid:0',
    'a=ice-ufrag:' + ufrag,
    'a=ice-pwd:fixture-password-only',
    'a=sendrecv' + suffix,
  ].join('\r\n');
const normalized = (text) => text.trim().replace(/\r?\n/g, '\r\n') + '\r\n';
const candidate = (key, ufrag = 'offer1') => ({
  key,
  candidate: {
    candidate: 'candidate:1 1 UDP 2122252543 192.0.2.1 45678 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
    usernameFragment: ufrag,
  },
});
const relayPayload = () => ({
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:untrusted.invalid:3478'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
        'turn:evil.invalid:3478?transport=udp',
      ],
      username: 'fixture-temporary-user',
      credential: 'fixture-temporary-password',
    },
  ],
});
function declaration(file, name) {
  const text = source(file),
    ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
  );
  assert.ok(node, file + ' must contain ' + name);
  return node.getText(ast);
}

function fixture(t) {
  const clock = { now: NOW };
  class Clock extends Date {
    static now() {
      return clock.now;
    }
  }
  const sql = new DatabaseSync(':memory:');
  sql.function('strftime', (format, value) => {
    assert.equal(format, '%s');
    assert.equal(value, 'now');
    return String(Math.floor(clock.now / 1000));
  });
  for (const [tag, migration] of migrations) {
    try {
      sql.exec(migration);
    } catch (e) {
      throw new Error('Migration failed: ' + tag, { cause: e });
    }
  }
  sql.exec('PRAGMA foreign_keys=ON');
  for (const id of ['alice', 'bob', 'outsider']) {
    sql
      .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
      .run(id, id, NOW - 1000);
    sql
      .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
      .run(id, id);
  }
  const config = {};
  const network = { calls: [], respond: null };
  const hooks = { beforeOperation: null };
  const adapter = {
    prepare(text) {
      const stmt = (args) => ({
        text,
        args,
        bind(...values) {
          return stmt(values);
        },
        async first(column) {
          await Promise.resolve();
          hooks.beforeOperation?.('first', text, args);
          const row = sql.prepare(text).get(...args) || null;
          return column ? (row?.[column] ?? null) : row;
        },
        async all() {
          await Promise.resolve();
          hooks.beforeOperation?.('all', text, args);
          return { success: true, results: sql.prepare(text).all(...args) };
        },
        async run() {
          await Promise.resolve();
          hooks.beforeOperation?.('run', text, args);
          const r = sql.prepare(text).run(...args);
          return {
            success: true,
            meta: {
              changes: Number(r.changes),
              last_row_id: Number(r.lastInsertRowid),
            },
          };
        },
      });
      return stmt([]);
    },
    async batch(statements) {
      await Promise.resolve();
      sql.exec('BEGIN IMMEDIATE');
      try {
        const rows = statements.map((s) => {
          const r = sql.prepare(s.text).run(...s.args);
          return { success: true, meta: { changes: Number(r.changes) } };
        });
        sql.exec('COMMIT');
        return rows;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const fakeFetch = async (...args) => {
    network.calls.push(args);
    assert.ok(
      network.respond,
      'Real network is forbidden: configure the fixture fetch response.',
    );
    return network.respond(...args);
  };
  const modules = new Map();
  const allowed = new Set([
    'lib/calls.ts',
    'lib/turn.ts',
    'lib/account-access.ts',
    'lib/privacy.ts',
    'lib/chat-files.ts',
    'lib/chat-access.ts',
    'lib/premium-access.ts',
    'lib/premium-predicate.ts',
    'lib/premium-emoji.ts',
    'lib/premium-emoji-access.ts',
    'lib/boost-access.ts',
    'lib/boost-rules.ts',
    'lib/channel-access.ts',
    'lib/rate-limit.ts',
    'lib/api-error.ts',
  ]);
  function evaluate(file, text) {
    const loadedModule = { exports: {} };
    modules.set(file, loadedModule);
    const output = ts.transpileModule(text, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: file,
    }).outputText;
    const scopedRequire = (specifier) => {
      const target = specifier.startsWith('@/')
        ? resolve(root, specifier.slice(2))
        : specifier.startsWith('.')
          ? resolve(root, dirname(file), specifier)
          : null;
      assert.ok(target, 'Unexpected external dependency: ' + specifier);
      const relative = target
        .slice(resolve(root).length + 1)
        .replaceAll('\\', '/');
      return load(extname(relative) ? relative : relative + '.ts');
    };
    compileFunction(output, [
      'require',
      'exports',
      'module',
      'Date',
      'crypto',
      'fetch',
    ])(
      scopedRequire,
      loadedModule.exports,
      loadedModule,
      Clock,
      webcrypto,
      fakeFetch,
    );
    return loadedModule.exports;
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    if (file === 'lib/storage.ts') return { db: () => adapter };
    if (file === 'lib/server.ts') {
      const api = load('lib/api-error.ts');
      const result = evaluate(
        file,
        `import { ApiError } from './api-error';\n${declaration(file, 'clean')}`,
      );
      return Object.assign(result, {
        db: () => adapter,
        ApiError: api.ApiError,
      });
    }
    if (file === 'lib/auth-session.ts') {
      const result = evaluate(file, declaration(file, 'tokenHash'));
      return Object.assign(result, { setting: (name) => config[name] || '' });
    }
    assert.ok(allowed.has(file), 'Unexpected dependency: ' + file);
    return evaluate(file, source(file));
  }
  const calls = load('lib/calls.ts'),
    turn = load('lib/turn.ts'),
    { ApiError } = load('lib/api-error.ts');
  const ctx = {
    sql,
    clock,
    config,
    network,
    hooks,
    calls,
    turn,
    ApiError,
    load,
    row(id = 'call_fixture') {
      const row = sql.prepare('SELECT * FROM calls WHERE id=?').get(id);
      return row ? { ...row } : null;
    },
    async post(action, body = {}, actor = 'alice') {
      return calls.callsPost(
        action,
        {
          id: 'call_fixture',
          device: actor === 'bob' ? CALLEE_DEVICE : CALLER_DEVICE,
          ...body,
        },
        actor,
      );
    },
    async signal(type, body = {}, actor = 'alice') {
      return ctx.post('callSignal', { type, negotiation: 1, ...body }, actor);
    },
    async get(action, params = {}, actor = 'alice') {
      return calls.callsGet(
        action,
        new URLSearchParams({
          id: 'call_fixture',
          device: actor === 'bob' ? CALLEE_DEVICE : CALLER_DEVICE,
          ...params,
        }),
        actor,
      );
    },
    async accepted() {
      await ctx.post('callStart', { peer: 'bob' });
      await ctx.post('callAccept', {}, 'bob');
    },
    async negotiated() {
      await ctx.accepted();
      await ctx.signal('offer', { sdp: sdp('offer1') });
      await ctx.signal('answer', { sdp: sdp('answer1') }, 'bob');
    },
    restrict(id, mode = 'read_only') {
      const event = randomUUID();
      sql
        .prepare(
          'INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,?,?,?,?)',
        )
        .run(event, id, 'outsider', mode, 'fixture restriction', clock.now);
      sql
        .prepare(
          'INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,?,?,?)',
        )
        .run(id, event, mode, 'fixture restriction', clock.now);
    },
    managed() {
      Object.assign(config, SETTINGS);
      network.respond = async () => Response.json(relayPayload());
    },
  };
  t.after(() => {
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    sql.close();
  });
  return ctx;
}
const options = { concurrency: false, timeout: 10000 };
function scenario(name, run) {
  void test(name, options, (t) => run(fixture(t), t));
}
const rejectStatus = (fn, status) =>
  assert.rejects(fn, (e) => {
    assert.equal(e.status, status, e.message);
    return true;
  });

scenario(
  'offer/answer are role- and device-bound; same SDP is idempotent',
  async (f) => {
    await f.accepted();
    await rejectStatus(
      () => f.signal('offer', { sdp: sdp('wrong') }, 'bob'),
      409,
    );
    await rejectStatus(
      () => f.signal('offer', { sdp: sdp('wrong'), device: FOREIGN_DEVICE }),
      409,
    );
    await rejectStatus(
      () => f.signal('answer', { sdp: sdp('early') }, 'bob'),
      409,
    );
    await f.signal('offer', { sdp: sdp('offer1') });
    await rejectStatus(() => f.signal('answer', { sdp: sdp('wrong') }), 409);
    await rejectStatus(
      () =>
        f.signal(
          'answer',
          { sdp: sdp('wrong'), device: FOREIGN_DEVICE },
          'bob',
        ),
      409,
    );
    await f.signal('answer', { sdp: sdp('answer1') }, 'bob');
    const before = f.row();
    await f.signal('offer', { sdp: sdp('offer1') });
    await f.signal('answer', { sdp: sdp('answer1') }, 'bob');
    assert.equal(f.row().answer, before.answer);
    assert.equal(f.row().negotiation, 1);
    await rejectStatus(() => f.signal('offer', { sdp: sdp('different') }), 409);
    await rejectStatus(
      () => f.signal('answer', { sdp: sdp('different') }, 'bob'),
      409,
    );
    assert.equal(f.row().offer, normalized(sdp('offer1')));
  },
);
scenario(
  'concurrent replacement offers use compare-and-set; stale answer cannot attach',
  async (f) => {
    await f.negotiated();
    const results = await Promise.allSettled([
      f.signal('offer', { negotiation: 2, sdp: sdp('offer2a') }),
      f.signal('offer', { negotiation: 2, sdp: sdp('offer2b') }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.status,
      409,
    );
    assert.equal(f.row().negotiation, 2);
    assert.equal(f.row().answer, null);
    await rejectStatus(
      () => f.signal('answer', { negotiation: 1, sdp: sdp('answer1') }, 'bob'),
      409,
    );
    await rejectStatus(
      () => f.signal('offer', { negotiation: 4, sdp: sdp('skip') }),
      409,
    );
    await f.signal('answer', { negotiation: 2, sdp: sdp('answer2') }, 'bob');
    const answer = f.row().answer;
    await f.signal('offer', { negotiation: 2, sdp: f.row().offer });
    assert.equal(
      f.row().answer,
      answer,
      'An offer retry must not reset the received answer',
    );
  },
);
scenario(
  'callee restart request is revision-bound and survives a retry of the old offer',
  async (f) => {
    await f.negotiated();
    await rejectStatus(() => f.signal('restart'), 409);
    await rejectStatus(
      () => f.signal('restart', { device: FOREIGN_DEVICE }, 'bob'),
      409,
    );
    await f.signal('restart', {}, 'bob');
    assert.equal(f.row().restartRequested, 1);
    await f.signal('offer', { sdp: sdp('offer1') });
    assert.equal(f.row().restartRequested, 1);
    assert.ok(f.row().answer);
    await f.signal('offer', { negotiation: 2, sdp: sdp('offer2') });
    assert.equal(f.row().restartRequested, 0);
    assert.equal(f.row().answer, null);
    await rejectStatus(
      () => f.signal('restart', { negotiation: 1 }, 'bob'),
      409,
    );
  },
);
scenario(
  'SDP/version validation prevents mixed media and invalid negotiation values',
  async (f) => {
    await f.accepted();
    for (const negotiation of [0, -1, 1001, 1.1, '1', null])
      await rejectStatus(
        () => f.signal('offer', { negotiation, sdp: sdp('offer1') }),
        400,
      );
    for (const value of [
      'not SDP',
      sdp('x') + '\r\nm=video 9 UDP/TLS/RTP/SAVPF 96',
      sdp('x') + '\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',
    ])
      await rejectStatus(() => f.signal('offer', { sdp: value }), 400);
    await f.signal('offer', { negotiation: undefined, sdp: sdp('legacy') });
    assert.equal(
      f.row().negotiation,
      1,
      'Legacy clients may complete their first negotiation',
    );
  },
);
scenario(
  'ICE preserves usernameFragment, tags revisions and rejects late generations',
  async (f) => {
    await f.negotiated();
    await f.signal('ice', { candidates: [candidate('event_one')] });
    await f.signal('ice', { candidates: [candidate('event_one')] });
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM call_signals').get().n,
      1,
    );
    let state = await (await f.get('callState', {}, 'bob')).json();
    assert.equal(state.signals.length, 1);
    assert.equal(state.signals[0].negotiation, 1);
    assert.equal(
      JSON.parse(state.signals[0].candidate).usernameFragment,
      'offer1',
    );
    await f.signal('offer', { negotiation: 2, sdp: sdp('offer2') });
    await rejectStatus(
      () =>
        f.signal('ice', {
          negotiation: 1,
          candidates: [candidate('late_event')],
        }),
      409,
    );
    await rejectStatus(
      () =>
        f.signal('ice', {
          negotiation: 2,
          device: FOREIGN_DEVICE,
          candidates: [candidate('foreign_event')],
        }),
      403,
    );
    // Keys identify immutable candidate events across the entire call, not reusable slots.
    await rejectStatus(
      () =>
        f.signal('ice', {
          negotiation: 2,
          candidates: [candidate('event_one', 'offer2')],
        }),
      409,
    );
    await f.signal('ice', {
      negotiation: 2,
      candidates: [candidate('event_two', 'offer2')],
    });
    state = await (await f.get('callState', {}, 'bob')).json();
    assert.deepEqual(
      state.signals.map((r) => r.negotiation),
      [1, 2],
    );
    assert.equal(
      JSON.parse(state.signals[1].candidate).usernameFragment,
      'offer2',
    );
  },
);
scenario(
  'ICE validates the complete input batch before inserting any candidate',
  async (f) => {
    await f.negotiated();
    for (const bad of [42, 'x'.repeat(257)]) {
      const item = candidate('bad');
      item.candidate.usernameFragment = bad;
      await rejectStatus(
        () => f.signal('ice', { candidates: [candidate('valid'), item] }),
        400,
      );
      assert.equal(
        f.sql.prepare('SELECT COUNT(*) AS n FROM call_signals').get().n,
        0,
      );
    }
    await rejectStatus(
      () =>
        f.signal('ice', {
          candidates: Array.from({ length: 21 }, (_, i) =>
            candidate('large_' + i),
          ),
        }),
      400,
    );
  },
);
scenario(
  'ICE concurrent cap is 200 per sender/revision; duplicates still succeed at cap',
  async (f) => {
    await f.negotiated();
    const results = await Promise.allSettled(
      Array.from({ length: 201 }, (_, i) =>
        f.signal('ice', { candidates: [candidate('cap_' + i)] }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 200);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.status,
      409,
    );
    const first = f.sql
      .prepare('SELECT key FROM call_signals ORDER BY id LIMIT 1')
      .get().key;
    await f.signal('ice', { candidates: [candidate(first)] });
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM call_signals').get().n,
      200,
    );
    await f.signal(
      'ice',
      { candidates: [candidate('peer_event', 'answer1')] },
      'bob',
    );
    await f.signal('offer', { negotiation: 2, sdp: sdp('offer2') });
    await f.signal('ice', {
      negotiation: 2,
      candidates: [candidate('new_generation', 'offer2')],
    });
    assert.equal(
      f.sql
        .prepare('SELECT COUNT(*) AS n FROM call_signals WHERE negotiation=2')
        .get().n,
      1,
    );
  },
);
scenario(
  'an ICE request cannot write after the call revision changes during its precheck',
  async (f) => {
    await f.negotiated();
    let interleaved = false;
    f.hooks.beforeOperation = (kind, text) => {
      if (
        !interleaved &&
        kind === 'run' &&
        text.includes('INSERT OR IGNORE INTO call_signals')
      ) {
        interleaved = true;
        f.sql
          .prepare(
            'UPDATE calls SET negotiation=2,offer=?,answer=NULL WHERE id=?',
          )
          .run(normalized(sdp('offer2')), 'call_fixture');
      }
    };
    await rejectStatus(
      () => f.signal('ice', { candidates: [candidate('racing_old_event')] }),
      409,
    );
    assert.equal(interleaved, true);
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) AS n FROM call_signals').get().n,
      0,
    );
  },
);
scenario(
  'callState hides SDP and ICE from another device and unrelated accounts',
  async (f) => {
    await f.negotiated();
    await f.signal('ice', { candidates: [candidate('private')] });
    const otherDevice = await (
      await f.get('callState', { device: FOREIGN_DEVICE }, 'bob')
    ).json();
    assert.equal(otherDevice.call.deviceOwned, false);
    assert.equal('offer' in otherDevice.call, false);
    assert.equal('answer' in otherDevice.call, false);
    assert.deepEqual(otherDevice.signals, []);
    assert.equal(
      (await (await f.get('callState', {}, 'outsider')).json()).call,
      null,
    );
  },
);
scenario(
  'TURN config requires an owned accepted live call before contacting the provider',
  async (f) => {
    f.managed();
    await rejectStatus(() => f.get('callConfig'), 403);
    await f.post('callStart', { peer: 'bob' });
    await rejectStatus(() => f.get('callConfig'), 403);
    await f.post('callAccept', {}, 'bob');
    await rejectStatus(
      () => f.get('callConfig', { device: FOREIGN_DEVICE }),
      403,
    );
    await rejectStatus(() => f.get('callConfig', {}, 'outsider'), 403);
    assert.equal(f.network.calls.length, 0);
    const response = await f.get('callConfig');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal((await response.json()).relayConfigured, true);
    await f.post('callEnd');
    await rejectStatus(() => f.get('callConfig'), 403);
    assert.equal(f.network.calls.length, 1);
  },
);
scenario(
  'TURN provider requests are atomically limited to eight per account/minute',
  async (f) => {
    await f.accepted();
    f.managed();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => f.get('callConfig')),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 8);
    assert.equal(f.network.calls.length, 8);
    for (const r of results.filter((r) => r.status === 'rejected')) {
      assert.equal(r.reason.status, 429);
      assert.ok(r.reason.retryAfter > 0);
    }
    await f.get('callConfig', {}, 'bob');
    assert.equal(f.network.calls.length, 9);
  },
);
for (const revoke of [
  'ended',
  'blocked',
  'read_only',
  'privacy',
  'blacklist',
  'device',
])
  scenario(
    'TURN credentials are withheld after concurrent ' + revoke + ' revocation',
    async (f) => {
      await f.accepted();
      f.managed();
      f.network.respond = async () => {
        if (revoke === 'ended')
          f.sql
            .prepare("UPDATE calls SET status='ended' WHERE id='call_fixture'")
            .run();
        else if (revoke === 'blocked' || revoke === 'read_only')
          f.restrict('bob', revoke);
        else if (revoke === 'privacy')
          f.sql
            .prepare(
              "INSERT INTO user_privacy(userId,messagePolicy) VALUES('bob','nobody')",
            )
            .run();
        else if (revoke === 'blacklist')
          f.sql
            .prepare(
              "INSERT INTO user_blocks(blocker,blocked,created) VALUES('bob','alice',?)",
            )
            .run(NOW);
        else
          f.sql
            .prepare("UPDATE calls SET callerDevice=? WHERE id='call_fixture'")
            .run(FOREIGN_DEVICE);
        return Response.json(relayPayload());
      };
      await rejectStatus(() => f.get('callConfig'), 403);
      assert.equal(f.network.calls.length, 1);
    },
  );
scenario(
  'managed TURN emits temporary credentials and filters browser-unsafe/untrusted URLs',
  async (f) => {
    f.managed();
    const result = await f.turn.turnConfiguration(
      (name) => f.config[name] || '',
      async (...args) => {
        f.network.calls.push(args);
        return Response.json(relayPayload());
      },
      NOW,
    );
    assert.equal(result.relayConfigured, true);
    assert.equal(result.expiresAt, NOW + 10800000);
    const [url, options] = f.network.calls[0];
    assert.equal(
      url,
      'https://rtc.live.cloudflare.com/v1/turn/keys/fixture_key_12345/credentials/generate-ice-servers',
    );
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + API_TOKEN);
    assert.deepEqual(JSON.parse(options.body), { ttl: 10800 });
    const publicJson = JSON.stringify(result);
    for (const disallowed of [
      API_TOKEN,
      ':53?',
      'evil.invalid',
      'untrusted.invalid',
    ])
      assert.equal(publicJson.includes(disallowed), false);
    assert.ok(publicJson.includes('fixture-temporary-password'));
  },
);
scenario(
  'managed TURN errors never leak the upstream body or provider API token',
  async (f) => {
    f.managed();
    const failures = [
      async () => new Response('provider echoed ' + API_TOKEN, { status: 403 }),
      async () => {
        throw new Error('provider network failure ' + API_TOKEN);
      },
      async () => new Response('invalid JSON ' + API_TOKEN, { status: 200 }),
      async () => Response.json({ iceServers: [] }),
      async () =>
        Response.json({
          iceServers: [
            {
              urls: 'turn:turn.cloudflare.com:3478?transport=udp',
              username: 'temporary',
              credential: API_TOKEN,
            },
          ],
        }),
    ];
    for (const fetcher of failures)
      await assert.rejects(
        () =>
          f.turn.turnConfiguration(
            (name) => f.config[name] || '',
            fetcher,
            NOW,
          ),
        (e) => {
          assert.equal(e.status, 503);
          assert.equal(e.message.includes(API_TOKEN), false);
          assert.equal(e.message.includes('provider echoed'), false);
          return true;
        },
      );
  },
);
scenario(
  'none/coturn configurations avoid external network and never expose the shared secret',
  async (f) => {
    const forbidden = async () => {
      throw new Error('Network forbidden');
    };
    const none = await f.turn.turnConfiguration(() => '', forbidden, NOW);
    assert.equal(none.relayConfigured, false);
    assert.equal(none.iceServers[0].urls[0], 'stun:stun.cloudflare.com:3478');
    const settings = {
      NOCT_TURN_PROVIDER: 'coturn',
      NOCT_TURN_URLS:
        'turn:relay.fixture.invalid:3478?transport=udp, turns:relay.fixture.invalid:5349?transport=tcp',
      NOCT_TURN_SECRET: 'fixture-coturn-shared-secret',
    };
    const result = await f.turn.turnConfiguration(
      (name) => settings[name] || '',
      forbidden,
      NOW,
    );
    assert.equal(result.relayConfigured, true);
    const relay = result.iceServers.at(-1);
    assert.equal(
      relay.username.split(':')[0],
      String(Math.floor(NOW / 1000 + 10800)),
    );
    assert.equal(
      relay.credential,
      createHmac('sha1', settings.NOCT_TURN_SECRET)
        .update(relay.username)
        .digest('base64'),
    );
    assert.equal(
      JSON.stringify(result).includes(settings.NOCT_TURN_SECRET),
      false,
    );
    assert.equal(relay.username.includes('alice'), false);
  },
);

// Append to tests/calls.test.mjs; uses its fixture/scenario helpers.
// All state below is isolated SQLite :memory:; no requests or production data.

scenario(
  'a cancellation racing the initial lookup prevents a late ringing call and notification',
  async (f) => {
    let cancelled;
    let interleaved = false;
    f.hooks.beforeOperation = (kind, text) => {
      if (
        kind === 'first' &&
        text.includes(
          'SELECT id FROM calls WHERE id=? AND caller=? AND callee=?',
        )
      ) {
        f.hooks.beforeOperation = null;
        interleaved = true;
        // Queue cancellation before callStart reaches its asynchronous atomic batch.
        cancelled = f.post('callEnd', { reason: 'cancelled' });
      }
    };
    await rejectStatus(() => f.post('callStart', { peer: 'bob' }), 409);
    assert.equal(interleaved, true);
    await Promise.resolve(cancelled);
    await f.post('callEnd', { reason: 'cancelled' }); // Idempotent retry.
    assert.equal(f.row(), null);
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) n FROM notifications WHERE kind='call' AND targetId='call_fixture'",
        )
        .get().n,
      0,
    );
    assert.equal(
      f.sql
        .prepare(
          'SELECT COUNT(*) n FROM call_cancellations WHERE callId=? AND caller=? AND device=?',
        )
        .get('call_fixture', 'alice', CALLER_DEVICE).n,
      1,
    );
  },
);

scenario(
  'a different user cannot pre-cancel another caller even with the same call ID and device string',
  async (f) => {
    await f.post(
      'callEnd',
      { reason: 'cancelled', device: CALLER_DEVICE },
      'outsider',
    );
    await f.post('callStart', { peer: 'bob' });
    assert.equal(f.row().status, 'ringing');
    await rejectStatus(
      () => f.post('callEnd', { reason: 'cancelled' }, 'outsider'),
      403,
    );
    assert.equal(f.row().status, 'ringing');
  },
);

scenario(
  'cancellation tombstones from another device do not block a call on this device or grant hangup rights',
  async (f) => {
    await f.post('callEnd', { reason: 'cancelled', device: FOREIGN_DEVICE });
    await f.post('callStart', { peer: 'bob' });
    assert.equal(f.row().status, 'ringing');
    await rejectStatus(
      () => f.post('callEnd', { reason: 'cancelled', device: FOREIGN_DEVICE }),
      403,
    );
    assert.equal(f.row().status, 'ringing');
    await f.post('callEnd', { reason: 'cancelled' });
    assert.equal(f.row().status, 'ended');
  },
);

scenario(
  'unknown-call cancellation does not weaken participant/device checks for an existing accepted call',
  async (f) => {
    await f.negotiated();
    const before = f.row();
    for (const [actor, device] of [
      ['outsider', CALLER_DEVICE],
      ['alice', FOREIGN_DEVICE],
      ['bob', FOREIGN_DEVICE],
    ]) {
      await rejectStatus(
        () => f.post('callEnd', { reason: 'cancelled', device }, actor),
        403,
      );
      assert.deepEqual(f.row(), before);
    }
    assert.equal(
      f.sql.prepare('SELECT COUNT(*) n FROM call_cancellations').get().n,
      0,
    );
    await f.post('callEnd', { reason: 'completed' }, 'bob');
    assert.equal(f.row().status, 'ended');
  },
);

scenario(
  'tombstones are capped per caller without preventing a valid hangup and expire after five minutes',
  async (f) => {
    await f.accepted();
    for (let i = 0; i < 100; i++)
      f.sql
        .prepare(
          'INSERT INTO call_cancellations(callId,caller,device,created) VALUES(?,?,?,?)',
        )
        .run('cancel-' + i, 'alice', CALLER_DEVICE, f.clock.now);
    await rejectStatus(
      () => f.post('callEnd', { id: 'overflow', reason: 'cancelled' }),
      403,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) n FROM call_cancellations WHERE caller='alice'",
        )
        .get().n,
      100,
    );
    await f.post('callEnd', { id: 'cancel-0', reason: 'cancelled' }); // Retry works at cap.
    await f.post('callEnd', { reason: 'completed' }); // Existing call still ends at cap.
    assert.equal(f.row().status, 'ended');
    f.clock.now += 300001;
    await f.calls.expireCalls();
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) n FROM call_cancellations WHERE caller='alice'",
        )
        .get().n,
      0,
    );
    await f.post('callStart', { id: 'cancel-0', peer: 'bob' });
    assert.equal(f.row('cancel-0').status, 'ringing');
  },
);
