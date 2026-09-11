// Real D1; synthetic accounts and provider responses only. Never loads .env.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, extname } from 'node:path';
import { compileFunction } from 'node:vm';
const require = createRequire(import.meta.url),
  ts = require('typescript');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
void test(
  'commerce receipts, refunds, Premium, emoji and archive against real D1',
  { timeout: 180000 },
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
      for (const sql of readFileSync('drizzle/' + tag + '.sql', 'utf8').split(
        '--> statement-breakpoint',
      ))
        if (sql.trim()) await d.prepare(sql).run();
    for (const id of ['alice', 'bob', 'carol'])
      await d
        .prepare('INSERT INTO users(id,name,created) VALUES(?,?,1)')
        .bind(id, id)
        .run();
    await d
      .prepare(
        "INSERT INTO telegram_links(id,userId,telegramId,telegramName,telegramUsername,created) VALUES('link-a','alice','123','A','alice',1),('link-b','bob','456','B','bob',1)",
      )
      .run();
    const config = {
      NOCT_BOT_USERNAME: 'NoctFixtureBot',
      NOCT_BOT_SECRET: 'fixture_secret_not_a_real_key_123456',
      CRYPTO_PAY_API_TOKEN: 'fixture_crypto',
    };
    let provider = () => {
      throw Error('Unexpected provider call');
    };
    const modules = new Map(),
      apiError = load('lib/api-error.ts');
    async function writable(id) {
      const r = await d
        .prepare('SELECT mode FROM account_restrictions WHERE userId=?')
        .bind(id)
        .first();
      if (r) throw new apiError.ApiError(403, 'Restricted');
    }
    function load(file) {
      if (modules.has(file)) return modules.get(file).exports;
      if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'));
      if (file === 'lib/storage.ts') return { db: () => d };
      if (file === 'lib/auth-session.ts')
        return {
          setting: (n) => config[n] || '',
          tokenHash: async (value) => value,
        };
      if (file === 'lib/account-access.ts')
        return {
          assertWritable: writable,
          assertReadable: async (id) => {
            if (
              (
                await d
                  .prepare(
                    'SELECT mode FROM account_restrictions WHERE userId=?',
                  )
                  .bind(id)
                  .first()
              )?.mode === 'blocked'
            )
              throw new apiError.ApiError(403, 'Blocked');
          },
          visibleAccount: (a) =>
            `${a}.deletedAt=0 AND NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.userId=${a}.id AND r.mode='blocked')`,
        };
      assert.ok(
        /^lib\/(payments|payment-provider|premium-predicate|premium-emoji-access|premium-emoji|chat-archive|chat-access|star-wallet|rate-limit|api-error)\.ts$/.test(
          file,
        ),
        'Unexpected dependency ' + file,
      );
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
        (p) => {
          const path = resolve(dirname(file), p)
            .slice(process.cwd().length + 1)
            .replaceAll('\\', '/');
          return load(extname(path) ? path : path + '.ts');
        },
        m.exports,
        m,
        (...args) => provider(...args),
      );
      return m.exports;
    }
    const p = load('lib/payments.ts'),
      wallet = load('lib/star-wallet.ts'),
      emoji = load('lib/premium-emoji-access.ts'),
      archive = load('lib/chat-archive.ts');
    const create = (sku = 'stars100', extra = {}) =>
      p.createPayment('alice', {
        sku,
        provider: 'telegram',
        key: crypto.randomUUID(),
        acceptedTerms: true,
        ...extra,
      });
    const receipt = (o, extra = {}) => ({
      provider: o.provider,
      chargeId: 'charge-' + o.id,
      orderId: o.id,
      currency: o.currency,
      amountMinor: o.amountMinor,
      payerId: o.telegramId || '',
      ...extra,
    });
    await t.test(
      'test wallet and test Premium are disabled; emojis require a paid/admin entitlement',
      async () => {
        await wallet.ensureWallet('alice');
        assert.equal(await wallet.balance('alice'), 0);
        await d
          .prepare(
            "INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) VALUES('alice',0,?,'test',1)",
          )
          .bind(Date.now() + 86400000)
          .run();
        await assert.rejects(
          emoji.assertPremiumEmoji('alice', ':noct_fire:'),
          /Premium/,
        );
        await emoji.assertPremiumEmoji('alice', 'ordinary 😀');
        await assert.rejects(
          emoji.assertPremiumEmoji('alice', ':noct_unknown:'),
          /30/,
        );
      },
    );
    await t.test(
      'catalog price is server-owned and create replay is bound to the exact product',
      async () => {
        const key = crypto.randomUUID(),
          o = await create('premium30', { key, amountMinor: 1 });
        assert.equal(o.amountMinor, 75);
        assert.equal(o.units, 30);
        assert.equal((await create('premium30', { key })).id, o.id);
        await assert.rejects(create('stars100', { key }), /другой/);
        await assert.rejects(
          create('stars100', { acceptedTerms: false }),
          /условия/,
        );
      },
    );
    await t.test(
      'wrong payer/amount never grants; identical concurrent receipts credit once',
      async () => {
        const o = await create();
        await assert.rejects(
          p.recordPayment(receipt(o, { payerId: '456' })),
          /соответствует/,
        );
        await assert.rejects(
          p.recordPayment(receipt(o, { amountMinor: 1 })),
          /соответствует/,
        );
        await Promise.all([
          p.recordPayment(receipt(o)),
          p.recordPayment(receipt(o)),
        ]);
        assert.equal(await wallet.balance('alice'), 100);
        await p.recordPayment(receipt(o, { chargeId: 'duplicate' }));
        assert.equal(await wallet.balance('alice'), 100);
        const refunds = await p.botPayments({ action: 'paymentRefunds' });
        assert.equal(refunds.receipts[0].chargeId, 'duplicate');
        await p.recordPayment(
          receipt(o, { chargeId: 'duplicate', refund: true }),
        );
        assert.equal(await wallet.balance('alice'), 100);
        await p.recordPayment(receipt(o, { refund: true }));
        await p.recordPayment(receipt(o, { refund: true }));
        assert.equal(await wallet.balance('alice'), 0);
      },
    );
    await t.test('refund before delivery prevents a later grant', async () => {
      const o = await create();
      await p.recordPayment(receipt(o, { refund: true }));
      await p.recordPayment(receipt(o));
      assert.equal(await wallet.balance('alice'), 0);
    });
    await t.test(
      'Premium stacks30days once, refund preserves later full30days and admin grants',
      async () => {
        const a = await create('premium30'),
          b = await create('premium30');
        await p.recordPayment(receipt(a));
        await p.recordPayment(receipt(a));
        await p.recordPayment(receipt(b));
        const before = (
          await d
            .prepare(
              'SELECT * FROM premium_purchases WHERE userId=? ORDER BY startsAt',
            )
            .bind('alice')
            .all()
        ).results;
        assert.equal(before.length, 2);
        assert.equal(before[0].expiresAt - before[0].startsAt, 30 * 86400000);
        assert.equal(before[1].startsAt, before[0].expiresAt);
        await emoji.assertPremiumEmoji('alice', ':noct_fire:');
        await d
          .prepare(
            "UPDATE premium_entitlements SET source='admin',expiresAt=? WHERE userId='alice'",
          )
          .bind(Date.now() + 90 * 86400000)
          .run();
        const admin = (
          await d
            .prepare(
              "SELECT expiresAt FROM premium_entitlements WHERE userId='alice'",
            )
            .first()
        ).expiresAt;
        await p.recordPayment(receipt(a, { refund: true }));
        await p.recordPayment(receipt(a, { refund: true }));
        const after = await d
          .prepare('SELECT * FROM premium_purchases WHERE orderId=?')
          .bind(b.id)
          .first();
        assert.equal(after.expiresAt - after.startsAt, 30 * 86400000);
        assert.equal(
          (
            await d
              .prepare(
                "SELECT expiresAt FROM premium_entitlements WHERE userId='alice'",
              )
              .first()
          ).expiresAt,
          admin,
        );
      },
    );
    await t.test(
      'precheckout freezes a single attempt and unlink blocks checkout, while paid receipt still belongs to original buyer',
      async () => {
        const o = await create(),
          b = {
            action: 'paymentPrecheck',
            id: o.id,
            telegramId: '123',
            currency: 'XTR',
            amount: 19,
            precheckoutId: 'pre-1',
          };
        await p.botPayments(b);
        await p.botPayments(b);
        await assert.rejects(
          p.botPayments({ ...b, precheckoutId: 'pre-2' }),
          /обрабатывается/,
        );
        await d
          .prepare("DELETE FROM telegram_links WHERE userId='alice'")
          .run();
        await assert.rejects(
          p.botPayments({
            action: 'paymentInvoice',
            id: o.id,
            telegramId: '123',
          }),
          /Привязка/,
        );
        await p.recordPayment(receipt(o));
        assert.equal(await wallet.balance('alice'), 100);
        await d
          .prepare(
            "INSERT INTO telegram_links(id,userId,telegramId,telegramName,telegramUsername,created) VALUES('new-link','alice','123','A','alice',1)",
          )
          .run();
      },
    );
    await t.test(
      'Crypto checkout accepts only trusted HTTPS web invoice URLs',
      () => {
        const { cryptoInvoiceUrl } = load('lib/payment-provider.ts');
        for (const host of ['app.cr.bot', 'app.send.tg', 'pay.crypt.bot']) {
          const url = `https://${host}/invoice/fixture`;
          assert.equal(cryptoInvoiceUrl(url), url);
        }
        for (const url of [
          undefined,
          null,
          42,
          '',
          'not a url',
          'http://app.cr.bot/invoice/fixture',
          'https://app.cr.bot.attacker.example/invoice/fixture',
          'https://other.cr.bot/invoice/fixture',
          'https://user:secret@app.cr.bot/invoice/fixture',
          'https://app.cr.bot:8443/invoice/fixture',
          'https://t.me/CryptoBot?start=fixture',
        ])
          assert.equal(cryptoInvoiceUrl(url), null);
      },
    );
    await t.test(
      'Crypto invoice uses RUB149 and current app.cr.bot URL; paid amount/payload are verified',
      async () => {
        const o = await create('premium30', { provider: 'crypto' });
        assert.equal(o.amountMinor, 14900);
        const invoice = {
          invoice_id: 42,
          status: 'active',
          currency_type: 'fiat',
          fiat: 'RUB',
          amount: '149',
          payload: o.id,
          web_app_invoice_url: 'https://app.cr.bot/invoice/fixture',
        };
        provider = async (url, init) => {
          const body = JSON.parse(init.body);
          if (url.endsWith('createInvoice')) {
            assert.equal(body.amount, '149.00');
            assert.equal(body.fiat, 'RUB');
            return Response.json({ ok: true, result: invoice });
          }
          return Response.json({ ok: true, result: { items: [invoice] } });
        };
        for (const invalid of [
          { web_app_invoice_url: 'invalid' },
          { fiat: 'USD' },
          { currency_type: 'crypto' },
          { invoice_id: 0 },
          { amount: '1' },
          { payload: 'other-order' },
        ]) {
          const original = { ...invoice };
          Object.assign(invoice, invalid);
          await assert.rejects(p.checkout(o), /некорректный счёт/);
          assert.equal((await p.paymentOrder(o.id)).providerInvoiceId, null);
          Object.assign(invoice, original);
        }
        assert.equal(
          (await p.checkout(o)).checkoutUrl,
          invoice.web_app_invoice_url,
        );
        let current = await p.paymentOrder(o.id);
        assert.equal((await p.verifyCrypto(current)).fulfilledAt, null);
        invoice.status = 'paid';
        invoice.amount = '1.00';
        await assert.rejects(p.verifyCrypto(current), /не совпадают/);
        invoice.amount = '149.00';
        current = await p.verifyCrypto(current);
        assert.ok(current.fulfilledAt);
        assert.equal(
          (await p.verifyCrypto(current)).fulfilledAt,
          current.fulfilledAt,
        );
      },
    );
    await t.test(
      'archiving is viewer-owned, idempotent, read-only allowed and leaves messages/unread intact',
      async () => {
        await d
          .prepare(
            "INSERT INTO messages(id,sender,recipient,text,created) VALUES('dm1','alice','bob','hello',1)",
          )
          .run();
        await archive.archiveDirectChat('alice', {
          peer: 'bob',
          archived: true,
          actor: 'alice',
        });
        await archive.archiveDirectChat('alice', {
          peer: 'bob',
          archived: true,
        });
        assert.equal(
          (
            await d
              .prepare('SELECT COUNT(*) n FROM direct_chat_archives')
              .first()
          ).n,
          1,
        );
        assert.equal(
          (await d.prepare("SELECT read FROM messages WHERE id='dm1'").first())
            .read,
          0,
        );
        await assert.rejects(
          archive.archiveDirectChat('bob', {
            peer: 'alice',
            archived: true,
            actor: 'alice',
          }),
          /изменился/,
        );
        await assert.rejects(
          archive.archiveDirectChat('carol', { peer: 'alice', archived: true }),
          /недоступен/,
        );
        await d
          .prepare(
            "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('fixture','alice','bob','read_only','fixture',1)",
          )
          .run();
        await d
          .prepare(
            "INSERT INTO account_restrictions(userId,mode,reason,created,eventId) VALUES('alice','read_only','fixture',1,'fixture')",
          )
          .run();
        await archive.archiveDirectChat('alice', {
          peer: 'bob',
          archived: false,
        });
        assert.equal(
          (
            await d
              .prepare(
                "SELECT archivedAt FROM direct_chat_archives WHERE userId='alice'",
              )
              .first()
          ).archivedAt,
          0,
        );
      },
    );
  },
);
