import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { CloudflareBotStore } from '../bot/cloudflare-store.mjs';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

void test('durable bot queue survives handler restart and deduplicates completed webhook deliveries', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql = {
    exec(query, ...args) {
      if (query.includes('CREATE TABLE')) {
        db.exec(query);
        return;
      }
      const rows = db.prepare(query).all(...args);
      return { toArray: () => rows };
    },
  };
  let store = new CloudflareBotStore(sql);
  const event = { update_id: 10, message: { text: '/start' } };
  store.enqueue(event);
  store.set('pending-payment:charge:paid', { chargeId: 'charge' });
  store = new CloudflareBotStore(sql);
  assert.deepEqual(store.pending(), [event]);
  assert.equal(store.get('pending-payment:charge:paid').chargeId, 'charge');
  store.retry(10);
  assert.equal(store.pending().length, 0);
  assert.ok(store.nextRetry() > Date.now());
  store.complete(10);
  store.enqueue(event);
  assert.equal(store.diagnostics().queuedUpdates, 0);
  store.cleanup();
  assert.equal(store.get('pending-payment:charge:paid').chargeId, 'charge');
});

void test(
  'Cloudflare webhook authenticates, persists updates and answers checkout independently of a stalled command',
  { timeout: 45000 },
  async (t) => {
    const secret = 'fixture_webhook_secret_not_a_real_key';
    const bridge = 'fixture_bridge_secret_not_a_real_key';
    const calls = [],
      credited = new Set();
    let releaseStatus, statusStarted;
    const started = new Promise((resolve) => {
      statusStarted = resolve;
    });
    const blocked = new Promise((resolve) => {
      releaseStatus = resolve;
    });
    const result = await build({
      entryPoints: ['bot/worker.mjs'],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      target: 'es2022',
      external: ['cloudflare:workers', 'node:crypto'],
    });
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: result.outputFiles[0].text,
        compatibilityDate: '2026-09-11',
        compatibilityFlags: ['nodejs_compat'],
        durableObjects: { BOT: { className: 'TelegramBot', useSQLite: true } },
        durableObjectsPersist: false,
        bindings: {
          TELEGRAM_BOT_TOKEN: '123:' + 'x'.repeat(32),
          NOCT_BOT_SECRET: bridge,
          TELEGRAM_WEBHOOK_SECRET: secret,
          NOCT_SITE_URL: 'https://noctgram.com',
        },
        outboundService: async (request) => {
          const url = new URL(request.url),
            body = await request.json();
          if (url.origin === 'https://noctgram.com') {
            assert.equal(url.pathname, '/api/bot');
            assert.equal(
              request.headers.get('Authorization'),
              'Bearer ' + bridge,
            );
            calls.push({ site: body.action });
            if (body.action === 'status') {
              statusStarted();
              await blocked;
              return Response.json({
                linked: true,
                testMode: false,
                balance: 0,
                profile: { name: 'Alice', handle: 'alice' },
              });
            }
            if (body.action === 'paymentReceipt') {
              credited.add(body.chargeId);
              return Response.json({
                id: body.id,
                status: 'paid',
                product: 'stars',
                units: 100,
              });
            }
            if (body.action === 'paymentRefunds')
              return Response.json({ receipts: [] });
            return Response.json({ ok: true });
          }
          assert.equal(url.origin, 'https://api.telegram.org');
          const method = url.pathname.split('/').at(-1);
          calls.push({ telegram: method, body });
          const answer =
            method === 'getStarTransactions'
              ? { transactions: [] }
              : { message_id: 100 };
          return Response.json({ ok: true, result: answer });
        },
      }),
    );
    t.after(async () => {
      releaseStatus();
      await mf.dispose();
    });
    const post = (body, key = secret) =>
      mf.dispatchFetch('https://bot.test/telegram/webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': key },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    const status = async () =>
      (
        await mf.dispatchFetch('https://bot.test/operator/status', {
          headers: { Authorization: 'Bearer ' + bridge },
        })
      ).json();
    const waitEmpty = async () => {
      for (let i = 0; i < 80; i++) {
        if (!(await status()).queuedUpdates) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.fail('Durable queue did not finish');
    };
    assert.equal((await post({ update_id: 1 }, 'wrong')).status, 401);
    assert.equal(
      (await mf.dispatchFetch('https://bot.test/operator/status')).status,
      401,
    );
    assert.equal((await post('{broken')).status, 400);
    assert.equal((await post({ update_id: -1 })).status, 400);
    assert.equal((await post('x'.repeat(65537))).status, 413);
    assert.equal(calls.length, 0);
    const command = {
      update_id: 1,
      message: {
        message_id: 1,
        text: '/start',
        chat: { id: 123, type: 'private' },
        from: { id: 123 },
      },
    };
    assert.equal((await post(command)).status, 200);
    assert.equal((await status()).queuedUpdates, 1);
    await started;
    const now = Date.now();
    assert.equal(
      (
        await post({
          update_id: 2,
          pre_checkout_query: {
            id: 'fixture-precheck',
            from: { id: 123 },
            invoice_payload: 'fixture-order',
            currency: 'XTR',
            total_amount: 19,
          },
        })
      ).status,
      200,
    );
    assert.ok(
      Date.now() - now < 3000,
      'Checkout was blocked by command delivery',
    );
    assert.equal(
      calls.find((c) => c.telegram === 'answerPreCheckoutQuery').body.ok,
      true,
    );
    assert.equal(credited.size, 0, 'Precheckout must never grant goods');
    releaseStatus();
    await waitEmpty();
    const sent = calls.filter((c) => c.telegram === 'sendMessage').length;
    await post(command);
    assert.equal((await status()).queuedUpdates, 0);
    assert.equal(
      calls.filter((c) => c.telegram === 'sendMessage').length,
      sent,
    );
    const paid = {
      update_id: 3,
      message: {
        message_id: 3,
        chat: { id: 123, type: 'private' },
        from: { id: 123 },
        successful_payment: {
          invoice_payload: 'fixture-order',
          currency: 'XTR',
          total_amount: 19,
          telegram_payment_charge_id: 'fixture-charge',
        },
      },
    };
    await post(paid);
    await waitEmpty();
    assert.equal(credited.size, 1);
    await post(paid);
    assert.equal((await status()).queuedUpdates, 0);
    assert.equal(credited.size, 1);
  },
);
