// Isolated D1 and synthetic email proof. Never loads credentials or sends mail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, extname } from 'node:path';
import { compileFunction } from 'node:vm';
const require = createRequire(import.meta.url),
  ts = require('typescript');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

await test(
  'registration Premium promotion with real transactional D1',
  { timeout: 120000 },
  async (t) => {
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: 'export default {fetch(){return new Response("fixture")}}',
        compatibilityDate: '2026-05-15',
        d1Databases: ['DB'],
        d1Persist: false,
        outboundService: () => {
          throw Error('External network forbidden');
        },
      }),
    );
    t.after(() => mf.dispose());
    const d = await mf.getD1Database('DB');
    for (const { tag } of JSON.parse(
      readFileSync('drizzle/meta/_journal.json', 'utf8'),
    ).entries)
      for (const statement of readFileSync(`drizzle/${tag}.sql`, 'utf8').split(
        '--> statement-breakpoint',
      ))
        if (statement.trim()) await d.prepare(statement).run();
    const env = {
      DB: d,
      NOCT_AUTH_MODE: 'email',
      NOCT_DEPLOYMENT_TARGET: 'standalone',
      SUPABASE_URL: 'https://fixture.invalid',
      SUPABASE_PUBLISHABLE_KEY: 'fixture',
      NOCT_SIGNUP_PREMIUM: '1',
    };
    let requestHeaders = new Headers();
    let rejectProof = false,
      confirmed = true;
    const subjects = new Map(),
      modules = new Map();
    function load(file) {
      if (modules.has(file)) return modules.get(file).exports;
      if (file === 'app/chatgpt-auth.ts')
        return { getChatGPTUser: async () => null };
      if (file === 'lib/notifications.ts')
        return { removePushDevice: async () => {} };
      if (file === 'lib/avatar-media.ts')
        return { assertStaticAvatar: async () => {} };
      if (file === 'lib/server.ts')
        return {
          clean: (value, max) => String(value).trim().slice(0, max),
          viewer: async () => {
            const user = await load('lib/auth-session.ts').identity();
            assert.ok(user);
            return user.userId;
          },
        };
      if (file === 'lib/account-access.ts')
        return { assertWritable: async () => {} };
      const m = { exports: {} };
      modules.set(file, m);
      const code = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      }).outputText;
      compileFunction(code, ['require', 'exports', 'module', 'fetch'])(
        (spec) => {
          if (spec === 'cloudflare:workers') return { env };
          if (spec === 'next/headers')
            return { headers: async () => requestHeaders };
          if (!spec.startsWith('.') && !spec.startsWith('@/'))
            return require(spec);
          const path = (
            spec.startsWith('@/')
              ? resolve(spec.slice(2))
              : resolve(dirname(file), spec)
          )
            .slice(process.cwd().length + 1)
            .replaceAll('\\', '/');
          return load(extname(path) ? path : path + '.ts');
        },
        m.exports,
        m,
        async (url, init) => {
          assert.equal(url, 'https://fixture.invalid/auth/v1/verify');
          if (rejectProof) return Response.json({}, { status: 403 });
          const { email } = JSON.parse(init.body);
          if (!subjects.has(email)) subjects.set(email, crypto.randomUUID());
          return Response.json({
            access_token: 'synthetic-proof',
            user: {
              id: subjects.get(email),
              email,
              email_confirmed_at: confirmed ? new Date().toISOString() : null,
            },
          });
        },
      );
      return m.exports;
    }
    const auth = load('lib/email-auth.ts'),
      session = load('lib/auth-session.ts');
    const predicate = load('lib/premium-predicate.ts');
    const bonus = (user) =>
      d
        .prepare('SELECT * FROM premium_entitlements WHERE userId=?')
        .bind(user)
        .first();
    const userFor = async (email) =>
      (
        await d
          .prepare('SELECT userId FROM auth_identities WHERE email=?')
          .bind(email)
          .first()
      )?.userId;
    const active = async (user) =>
      (
        await d
          .prepare(
            `SELECT ${predicate.entitlementActive('u.id')} AS active FROM users u WHERE u.id=?`,
          )
          .bind(user)
          .first()
      ).active;
    let serial = 0;
    async function challenge(email, { link = null, cookie = '' } = {}) {
      const token = session.randomToken(),
        now = Date.now();
      await d
        .prepare(
          'INSERT INTO auth_challenges(tokenHash,email,linkUserId,created,expiresAt) VALUES(?,?,?,?,?)',
        )
        .bind(await session.tokenHash(token), email, link, now, now + 300000)
        .run();
      return new Request('https://noctgram.example/api/auth/verify', {
        method: 'POST',
        headers: {
          Cookie: `${session.CHALLENGE_COOKIE}=${token}; ${cookie}`,
          'cf-connecting-ip': `192.0.2.${++serial}`,
        },
      });
    }
    async function verify(email, options) {
      const req = await challenge(email, options);
      requestHeaders = req.headers;
      return auth.finishEmail(req, { code: '123456' });
    }
    function responseCookie(response) {
      return response.headers
        .getSetCookie()
        .find((value) => value.startsWith(session.SESSION_COOKIE + '='))
        .split(';')[0];
    }
    let newcomer, grant;
    await t.test(
      'new verified person receives exactly 72 hours and sees the expiry immediately',
      async () => {
        const response = await verify('new@example.test');
        newcomer = await userFor('new@example.test');
        grant = await bonus(newcomer);
        assert.equal(grant.source, 'welcome');
        assert.equal(grant.expiresAt - grant.startsAt, 3 * 86400000);
        assert.equal(grant.revokedAt, 0);
        assert.equal(await active(newcomer), 1);
        const req = new Request('https://noctgram.example/api/auth/session', {
          headers: { Cookie: responseCookie(response) },
        });
        requestHeaders = req.headers;
        const status = await auth.authStatus(req);
        assert.equal(status.signupPremiumDays, 3);
        assert.equal(status.user.welcomePremiumExpiresAt, grant.expiresAt);
      },
    );
    await t.test(
      'a returning account never extends or receives the promotion again',
      async () => {
        await verify('new@example.test');
        assert.equal(await userFor('new@example.test'), newcomer);
        assert.deepEqual(await bonus(newcomer), grant);
      },
    );
    await t.test(
      'wrong and unconfirmed email proofs cannot create an account or entitlement',
      async () => {
        rejectProof = true;
        await assert.rejects(
          verify('invalid@example.test'),
          (error) => error.status === 400,
        );
        rejectProof = false;
        confirmed = false;
        await assert.rejects(
          verify('unconfirmed@example.test'),
          (error) => error.status === 400,
        );
        confirmed = true;
        assert.equal(await userFor('invalid@example.test'), undefined);
        assert.equal(await userFor('unconfirmed@example.test'), undefined);
      },
    );
    await t.test(
      'concurrent verification creates one account and one grant',
      async () => {
        const a = await challenge('race@example.test'),
          b = await challenge('race@example.test');
        requestHeaders = new Headers();
        await Promise.all([
          auth.finishEmail(a, { code: '123456' }),
          auth.finishEmail(b, { code: '123456' }),
        ]);
        const id = await userFor('race@example.test');
        assert.equal(
          (await bonus(id)).expiresAt - (await bonus(id)).startsAt,
          3 * 86400000,
        );
        assert.equal(
          (
            await d
              .prepare(
                "SELECT COUNT(*) AS n FROM users WHERE id LIKE 'email_%'",
              )
              .first()
          ).n,
          2,
        );
        assert.equal(
          (
            await d
              .prepare(
                "SELECT COUNT(*) AS n FROM premium_entitlements WHERE source='welcome'",
              )
              .first()
          ).n,
          2,
        );
      },
    );
    await t.test(
      'linking an existing profile preserves its entitlement without issuing a welcome bonus',
      async () => {
        const now = Date.now(),
          token = session.randomToken();
        await d
          .prepare(
            "INSERT INTO users(id,name,created) VALUES('existing','Existing',1)",
          )
          .run();
        await d
          .prepare(
            "INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) VALUES('existing',1,?,'admin',1)",
          )
          .bind(now + 30 * 86400000)
          .run();
        await d
          .prepare(
            "INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) VALUES(?,'existing',?,?,?)",
          )
          .bind(await session.tokenHash(token), now, now + 86400000, now)
          .run();
        const before = await bonus('existing');
        await verify('linked@example.test', {
          link: 'existing',
          cookie: `${session.SESSION_COOKIE}=${token}`,
        });
        assert.equal(await userFor('linked@example.test'), 'existing');
        assert.deepEqual(await bonus('existing'), before);
      },
    );
    await t.test(
      'disabled promotion grants nothing, re-enabling does not backfill older accounts',
      async () => {
        for (const flag of ['0', '', 'true']) {
          env.NOCT_SIGNUP_PREMIUM = flag;
          const email = `disabled-${flag || 'empty'}@example.test`;
          await verify(email);
          assert.equal(await bonus(await userFor(email)), null);
        }
        requestHeaders = new Headers();
        assert.equal(
          (
            await auth.authStatus(
              new Request('https://noctgram.example/api/auth/session'),
            )
          ).signupPremiumDays,
          0,
        );
        assert.deepEqual(
          await bonus(newcomer),
          grant,
          'Ending the promotion preserves issued days',
        );
        env.NOCT_SIGNUP_PREMIUM = '1';
        await verify('disabled-0@example.test');
        assert.equal(
          await bonus(await userFor('disabled-0@example.test')),
          null,
        );
      },
    );
    await t.test(
      'expired or revoked grants stay expired or revoked after another login',
      async () => {
        await d
          .prepare('UPDATE premium_entitlements SET revokedAt=? WHERE userId=?')
          .bind(Date.now(), newcomer)
          .run();
        await verify('new@example.test');
        assert.equal(await active(newcomer), 0);
        assert.ok((await bonus(newcomer)).revokedAt > 0);
        const raced = await userFor('race@example.test');
        await d
          .prepare('UPDATE premium_entitlements SET expiresAt=1 WHERE userId=?')
          .bind(raced)
          .run();
        await verify('race@example.test');
        assert.equal((await bonus(raced)).expiresAt, 1);
        assert.equal(await active(raced), 0);
      },
    );
    await t.test(
      'bonus failure rolls back account creation and can be retried with a new proof',
      async () => {
        await d
          .prepare(
            "CREATE TRIGGER reject_welcome BEFORE INSERT ON premium_entitlements WHEN NEW.source='welcome' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END",
          )
          .run();
        await assert.rejects(verify('rollback@example.test'));
        assert.equal(await userFor('rollback@example.test'), undefined);
        assert.equal(
          (
            await d
              .prepare(
                "SELECT COUNT(*) AS n FROM users u WHERE u.id LIKE 'email_%' AND NOT EXISTS(SELECT 1 FROM auth_identities a WHERE a.userId=u.id)",
              )
              .first()
          ).n,
          0,
        );
        await d.prepare('DROP TRIGGER reject_welcome').run();
        await verify('rollback@example.test');
        assert.equal(
          (await bonus(await userFor('rollback@example.test'))).source,
          'welcome',
        );
      },
    );
  },
);
