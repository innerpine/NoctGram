import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoctBot } from '../bot/handler.mjs';
import { syncAdminCommands } from '../bot/admin.mjs';
import { BotStore } from '../bot/store.mjs';
import { RemoteError } from '../bot/transport.mjs';
import {
  deliverReceipt,
  reconcilePayments,
  paymentKey,
} from '../bot/payment-worker.mjs';
import {
  parseAdminIds,
  recordAdminTopup,
  flushAdminNotifications,
} from '../bot/admin.mjs';

const admin = 1356155405;
const since = Date.now() - 60000;
const event = (extra = {}) => ({
  action: 'paymentReceipt',
  id: 'order-fixture',
  telegramId: '456',
  currency: 'XTR',
  amount: 19,
  chargeId: 'charge-fixture',
  refund: false,
  ...extra,
});
const order = (extra = {}) => ({
  id: 'order-fixture',
  status: 'paid',
  product: 'stars',
  provider: 'telegram',
  currency: 'XTR',
  units: 100,
  amountMinor: 19,
  fulfilledAt: since + 1000,
  reversedAt: null,
  ...extra,
});
function fixture(t, file = ':memory:') {
  const store = new BotStore(file, 1),
    calls = [];
  const bot = new NoctBot({
    store,
    adminIds: String(admin),
    adminNotificationsSince: new Date(since).toISOString(),
    siteUrl: 'https://noctgram.com',
    site: async (body) => {
      calls.push({ site: body });
      return order();
    },
    telegram: async (method, body) => {
      calls.push({ method, body });
      return method === 'getMyStarBalance'
        ? { amount: 38, nanostar_amount: 500000000 }
        : { message_id: calls.length };
    },
  });
  t.after(() => store.close());
  return { bot, store, calls };
}
function command(id = admin, extra = {}) {
  return {
    update_id: 10,
    message: {
      message_id: 5,
      text: '/admin',
      from: { id },
      chat: { id, type: 'private' },
      ...extra,
    },
  };
}

await test('admin access uses numeric sender ID, works without a website link, and rejects forwarded/group callbacks', async (t) => {
  assert.deepEqual(
    parseAdminIds('1356155405,1356155405 @flthq -1 0 9007199254740992'),
    [String(admin)],
  );
  const f = fixture(t);
  await f.bot.handle(command());
  assert.equal(
    f.calls.some((c) => c.site),
    false,
  );
  const panel = f.calls.find((c) => c.method === 'sendMessage').body;
  assert.equal(panel.chat_id, admin);
  assert.match(panel.text, /Админ-панель/);
  assert.match(panel.text, /38,5 Telegram Stars/);
  f.calls.length = 0;
  await f.bot.handle(command(789, { from: { id: 789, username: 'flthq' } }));
  assert.equal(
    f.calls.some((c) => c.method === 'getMyStarBalance' || c.site),
    false,
  );
  assert.match(
    f.calls.find((c) => c.method === 'sendMessage').body.text,
    /недоступна/,
  );
  for (const update of [
    command(admin, { chat: { id: admin, type: 'supergroup' } }),
    command(admin, { from: { id: admin, is_bot: true } }),
    {
      callback_query: {
        id: 'forged',
        data: 'admin:home',
        from: { id: 789 },
        message: { message_id: 5, chat: { id: admin, type: 'private' } },
      },
    },
  ]) {
    f.calls.length = 0;
    await f.bot.handle(update);
    assert.equal(
      f.calls.some((c) => c.method !== 'answerCallbackQuery'),
      false,
    );
  }
});

await test('paid site confirmation queues exact Noct/XTR amounts; duplicate receipts and concurrent flushes notify once', async (t) => {
  const f = fixture(t);
  await deliverReceipt(f.bot, event());
  await deliverReceipt(f.bot, event({ chargeId: 'duplicate-charge' }));
  assert.equal(f.calls.filter((c) => c.method === 'sendMessage').length, 0);
  assert.equal(
    f.store.entries('admin-payment-pending:').filter((v) => v.value).length,
    1,
  );
  await Promise.all([
    flushAdminNotifications(f.bot),
    flushAdminNotifications(f.bot),
  ]);
  const messages = f.calls.filter((c) => c.method === 'sendMessage');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body.chat_id, admin);
  assert.match(messages[0].body.text, /100 Noct Stars/);
  assert.match(messages[0].body.text, /19 Telegram Stars/);
  assert.match(messages[0].body.text, /tg:\/\/user\?id=456/);
  await deliverReceipt(f.bot, event());
  await flushAdminNotifications(f.bot);
  assert.equal(f.calls.filter((c) => c.method === 'sendMessage').length, 1);
});

await test('unconfirmed, mismatched, Premium, refunded and historical orders never announce successful top-ups', async (t) => {
  const f = fixture(t);
  for (const item of [
    { status: 'pending', fulfilledAt: null },
    { status: 'review' },
    { status: 'expired' },
    { status: 'refunded', reversedAt: Date.now() },
    { product: 'premium' },
    { provider: 'crypto' },
    { currency: 'RUB' },
    { amountMinor: 18 },
    { units: 0 },
    { fulfilledAt: since - 1 },
    { id: 'other-order' },
  ])
    recordAdminTopup(f.bot, event(), order(item));
  await flushAdminNotifications(f.bot);
  assert.equal(f.calls.length, 0);
  f.bot.site = async () => {
    throw new RemoteError('site', 409, 'Mismatch');
  };
  assert.equal(await deliverReceipt(f.bot, event()), null);
  await flushAdminNotifications(f.bot);
  assert.equal(f.calls.length, 0);
});

await test('primary refund cancels queued success; refund of a duplicate charge preserves the original top-up', async (t) => {
  const f = fixture(t);
  recordAdminTopup(f.bot, event(), order());
  recordAdminTopup(
    f.bot,
    event({ refund: true, chargeId: 'duplicate' }),
    order(),
  );
  await flushAdminNotifications(f.bot);
  assert.equal(f.calls.filter((c) => c.method === 'sendMessage').length, 1);
  const next = event({ id: 'second-order' });
  recordAdminTopup(f.bot, next, order({ id: next.id }));
  recordAdminTopup(
    f.bot,
    { ...next, refund: true },
    order({ id: next.id, status: 'refunded', reversedAt: Date.now() }),
  );
  recordAdminTopup(f.bot, next, order({ id: next.id }));
  await flushAdminNotifications(f.bot);
  assert.equal(f.calls.filter((c) => c.method === 'sendMessage').length, 1);
  assert.ok(f.store.get('admin-topup:' + next.id).reversedAt);
});

await test('notification failure preserves the committed purchase and durable outbox across a process restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'noct-admin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite');
  let store = new BotStore(path, 1);
  let sends = 0;
  const bot = new NoctBot({
    store,
    adminIds: String(admin),
    adminNotificationsSince: new Date(since).toISOString(),
    site: async () => order(),
    telegram: async () => {
      sends++;
      throw new RemoteError('telegram', 429, 'rate limit', 60);
    },
  });
  assert.equal((await deliverReceipt(bot, event())).status, 'paid');
  const at = Date.now();
  await flushAdminNotifications(bot, at);
  const saved = store.entries('admin-payment-pending:').find((v) => v.value);
  assert.equal(saved.value.attempts, 1);
  assert.equal(saved.value.nextAt, at + 60000);
  store.close();
  store = new BotStore(path, 1);
  try {
    const restarted = new NoctBot({
      store,
      adminIds: String(admin),
      adminNotificationsSince: new Date(since).toISOString(),
      telegram: async () => {
        sends++;
        return { message_id: 99 };
      },
    });
    await flushAdminNotifications(restarted, at + 59000);
    assert.equal(sends, 1);
    await flushAdminNotifications(restarted, at + 60001);
    await flushAdminNotifications(restarted, at + 60002);
    assert.equal(sends, 2);
    assert.equal(store.get(saved.key), null);
  } finally {
    store.close();
  }
});

await test('provider reconciliation catches missed and previously delivered recent receipts, without replaying older purchases', async (t) => {
  const f = fixture(t);
  const recent = event(),
    old = event({ id: 'old', chargeId: 'old-charge' });
  for (const e of [recent, old])
    f.store.set('delivered:' + paymentKey(e), true);
  const sends = [];
  f.bot.telegram = async (method, body) => {
    if (method === 'sendMessage') {
      sends.push(body);
      return { message_id: 1 };
    }
    return {
      transactions: [recent, old].map((e) => ({
        id: e.chargeId,
        amount: e.amount,
        date: Math.floor((e === old ? since - 5000 : Date.now()) / 1000),
        source: {
          type: 'user',
          transaction_type: 'invoice_payment',
          user: { id: 456 },
          invoice_payload: e.id,
        },
      })),
    };
  };
  let receipts = 0;
  f.bot.site = async (body) => {
    if (body.action === 'paymentReceipt') {
      receipts++;
      assert.equal(body.id, recent.id);
      return order();
    }
    if (body.action === 'paymentRefunds') return { receipts: [] };
    return {};
  };
  await reconcilePayments(f.bot);
  await flushAdminNotifications(f.bot);
  await reconcilePayments(f.bot);
  await flushAdminNotifications(f.bot);
  assert.equal(receipts, 1);
  assert.equal(sends.length, 1);
});

await test('admin command menu preserves ordinary commands and is scoped only to authorized private chats', async () => {
  const calls = [];
  const telegram = async (method, body) => {
    calls.push({ method, body });
    return [
      { command: 'start', description: 'Start' },
      { command: 'topup', description: 'Top up' },
    ];
  };
  await syncAdminCommands(telegram, '');
  assert.equal(calls.length, 0);
  await syncAdminCommands(telegram, String(admin));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.scope, { type: 'chat', chat_id: admin });
  assert.deepEqual(
    calls[1].body.commands.map((c) => c.command),
    ['admin', 'start', 'topup'],
  );
});

await test('removing an administrator prevents delivery of already queued payment details', async (t) => {
  const f = fixture(t);
  recordAdminTopup(f.bot, event(), order());
  f.bot.adminIds = ['999'];
  await flushAdminNotifications(f.bot);
  assert.equal(f.calls.length, 0);
  assert.equal(
    f.store.entries('admin-payment-pending:').filter((v) => v.value).length,
    0,
  );
});
