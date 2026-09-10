import test from 'node:test';
import assert from 'node:assert/strict';
import { BotStore } from '../bot/store.mjs';
import {
  normalizeStarTransaction,
  reconcilePayments,
} from '../bot/payment-worker.mjs';
import { handlePaymentUpdate, handleShop } from '../bot/payments.mjs';
import { NoctBot } from '../bot/handler.mjs';
import { RemoteError } from '../bot/transport.mjs';
const id = '12345678-1234-1234-1234-123456789abc';
void test('refund normalization uses receiver direction and same charge ID, never amount sign', () => {
  const user = {
    type: 'user',
    transaction_type: 'invoice_payment',
    user: { id: 123 },
    invoice_payload: id,
  };
  assert.equal(
    normalizeStarTransaction({ id: 'charge', amount: 650, source: user })
      .refund,
    false,
  );
  assert.equal(
    normalizeStarTransaction({ id: 'charge', amount: 650, receiver: user })
      .refund,
    true,
  );
  assert.equal(
    normalizeStarTransaction({
      id: 'gift',
      amount: 5,
      source: { ...user, transaction_type: 'gift_purchase' },
    }),
    null,
  );
  assert.equal(
    normalizeStarTransaction({
      id: 'charge',
      amount: 650,
      nanostar_amount: 3,
      source: user,
    }).review,
    true,
  );
});
void test('pre-checkout only validates and answers; it cannot credit', async () => {
  const events = [],
    methods = [];
  await handlePaymentUpdate(
    {
      site: async (b) => {
        events.push(b);
        return {};
      },
      telegram: async (m, b) => methods.push([m, b]),
    },
    {
      pre_checkout_query: {
        id: 'pre',
        from: { id: 123 },
        invoice_payload: id,
        currency: 'XTR',
        total_amount: 650,
      },
    },
  );
  assert.equal(events[0].action, 'paymentPrecheck');
  assert.equal(methods[0][0], 'answerPreCheckoutQuery');
  assert.equal(methods[0][1].ok, true);
});
void test('paid receipt survives restart and provider replay; scan skips gifts and remembers both directions', async (t) => {
  const store = new BotStore(':memory:', 1);
  t.after(() => store.close());
  const events = [];
  const user = {
    type: 'user',
    transaction_type: 'invoice_payment',
    user: { id: 123 },
    invoice_payload: id,
  };
  const bot = {
    store,
    telegram: async (m) => {
      assert.equal(m, 'getStarTransactions');
      return {
        transactions: [
          { id: 'charge', amount: 650, source: user },
          { id: 'charge', amount: 650, receiver: user },
        ],
      };
    },
    site: async (b) => {
      if (b.action === 'paymentReceipt') {
        events.push(b);
        return { status: 'paid' };
      }
      if (b.action === 'paymentRefunds') return { receipts: [] };
      return {};
    },
  };
  await reconcilePayments(bot);
  await reconcilePayments(bot);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.refund),
    [false, true],
  );
});
void test('paid shop offers Telegram Stars only and Premium is650 for30days', async (t) => {
  const store = new BotStore(':memory:', 1);
  t.after(() => store.close());
  const sent = [];
  const bot = new NoctBot({
    store,
    siteUrl: 'http://localhost:3000',
    telegram: async (m, b) => {
      sent.push(b);
      return { message_id: 1 };
    },
    site: async () => ({}),
  });
  await handleShop(
    bot,
    {
      update_id: 1,
      message: { text: '/premium', chat: { id: 123 }, from: { id: 123 } },
    },
    { linked: true, testMode: false, profile: { handle: 'alice' }, balance: 0 },
  );
  assert.match(sent[0].text, /30 дней/);
  assert.match(sent[0].text, /650 Telegram Stars/);
  assert.doesNotMatch(JSON.stringify(sent), /crypt|149 ₽/i);
  assert.equal(
    sent[0].reply_markup.inline_keyboard[0][0].callback_data,
    'buy:premium30',
  );
});
void test('command updates persist before polling cursor and complete independently', (t) => {
  const store = new BotStore(':memory:', 1);
  t.after(() => store.close());
  const event = { update_id: 1, message: { text: '/start' } };
  store.enqueue(event);
  store.enqueue(event);
  store.set('offset', 2);
  assert.deepEqual(store.pending(), [event]);
  store.complete(1);
  assert.deepEqual(store.pending(), []);
});

function paidFixture(
  t,
  { preferences = {}, denyEmoji = false, linked = true } = {},
) {
  const store = new BotStore(':memory:', 1),
    calls = [];
  t.after(() => store.close());
  store.set('chat:123', preferences);
  const state = {
    linked,
    testMode: false,
    profile: { handle: 'alice<&>' },
    balance: 1234,
  };
  const bot = new NoctBot({
    store,
    siteUrl: 'http://localhost:3000',
    emojiAvailable: true,
    telegram: async (method, body) => {
      calls.push({ method, body });
      if (denyEmoji && body.text?.includes('<tg-emoji'))
        throw new RemoteError('telegram', 400, 'custom emoji denied');
      return { message_id: calls.length };
    },
    site: async (body) => {
      if (body.action === 'status') return state;
      if (body.action === 'paymentHistory')
        return {
          orders: [{ id, sku: 'premium30', amountMinor: 650, fulfilledAt: 1 }],
        };
      if (body.action === 'paymentReceipt')
        return { status: 'paid', product: 'premium', id };
      throw Error('Unexpected site action ' + body.action);
    },
  });
  let update = 10;
  const command = (text) => ({
    update_id: update++,
    message: {
      message_id: update,
      text,
      chat: { id: 123, type: 'private' },
      from: { id: 123 },
    },
  });
  return { bot, store, calls, command };
}

void test('paid menus retain custom icons, expandable blocks, escaping and back navigation', async (t) => {
  const f = paidFixture(t);
  for (const command of [
    '/start',
    '/topup',
    '/premium',
    '/history',
    '/terms',
    '/paysupport',
    '/help',
  ]) {
    await f.bot.handle(f.command(command));
    const { body } = f.calls.at(-1);
    assert.match(body.text, /<tg-emoji/);
    assert.match(body.text, /<blockquote expandable>/);
    assert.doesNotMatch(body.text, /alice<&>/);
    assert.ok(body.text.length < 4096);
    const rows = body.reply_markup.inline_keyboard;
    assert.ok(rows.flat().every((button) => button.icon_custom_emoji_id));
    if (command !== '/start')
      assert.equal(rows.at(-1)[0].callback_data, 'home');
  }
  await f.bot.handle({
    update_id: 100,
    callback_query: {
      id: 'pack-test',
      from: { id: 123 },
      data: 'pack:1000',
      message: { message_id: 55, chat: { id: 123, type: 'private' } },
    },
  });
  assert.equal(f.calls.at(-1).method, 'editMessageText');
  assert.equal(f.calls.at(-1).body.message_id, 55);
  assert.equal(
    f.calls.at(-1).body.reply_markup.inline_keyboard.at(-1)[0].callback_data,
    'packages',
  );
});

void test('paid menus respect disabled emoji/details and unlinked account preferences', async (t) => {
  for (const linked of [true, false]) {
    const f = paidFixture(t, {
      linked,
      preferences: { rich: false, customEmoji: false },
    });
    await f.bot.handle(f.command('/start'));
    const { body } = f.calls.at(-1);
    assert.doesNotMatch(body.text, /<tg-emoji|<blockquote/);
    assert.ok(
      body.reply_markup.inline_keyboard
        .flat()
        .every((button) => !button.icon_custom_emoji_id),
    );
  }
});

void test('paid menu rebuilds both message and buttons after Telegram rejects custom emoji', async (t) => {
  const f = paidFixture(t, { denyEmoji: true });
  await f.bot.handle(f.command('/premium'));
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].body.text, /<tg-emoji/);
  assert.doesNotMatch(f.calls[1].body.text, /<tg-emoji/);
  assert.ok(
    f.calls[1].body.reply_markup.inline_keyboard
      .flat()
      .every((button) => !button.icon_custom_emoji_id),
  );
  assert.match(f.calls[1].body.text, /650 Telegram Stars/);
});

void test('paid navigation updates the optional pinned balance', async (t) => {
  const f = paidFixture(t, { preferences: { pinned: true } });
  await f.bot.handle(f.command('/start'));
  assert.ok(f.calls.some((c) => c.method === 'pinChatMessage'));
  assert.match(f.store.get('chat:123').statusText, /звёзд/);
  assert.equal(f.store.get('chat:123').statusPinned, true);
});

void test('paid receipt notice uses shared design and provider replay does not duplicate it', async (t) => {
  const f = paidFixture(t);
  const event = {
    update_id: 99,
    message: {
      message_id: 88,
      chat: { id: 123, type: 'private' },
      from: { id: 123 },
      successful_payment: {
        currency: 'XTR',
        total_amount: 650,
        invoice_payload: id,
        telegram_payment_charge_id: 'receipt-fixture',
      },
    },
  };
  await f.bot.handle(event);
  await f.bot.handle(event);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].body.text, /<tg-emoji/);
  assert.match(f.calls[0].body.text, /<blockquote expandable>/);
  assert.equal(
    f.calls[0].body.reply_markup.inline_keyboard[0][0].callback_data,
    'home',
  );
});
