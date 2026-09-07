import test from 'node:test';
import assert from 'node:assert/strict';
import { NoctBot } from '../bot/handler.mjs';
import { screen } from '../bot/screens.mjs';
import { RemoteError, safeBase, telegramTransport } from '../bot/transport.mjs';
import { BotStore } from '../bot/store.mjs';
const state = {
  linked: true,
  profile: { name: '<script>', handle: 'qa<&>' },
  balance: 11000,
  dailyLimit: 50000,
  usedToday: 1000,
  packages: [100, 1000, 10000],
  history: [{ id: 'receipt', amount: 1000, creditedAt: Date.now() }],
};
const options = {
  siteUrl: 'http://localhost:3000',
  order: { id: '12345678-1234-1234-1234-123456789abc', amount: 1000 },
};
function fixture(site) {
  const calls = [],
    store = new BotStore(':memory:', 123);
  const telegram = async (method, body) => {
    calls.push({ method, body });
    return { message_id: 90 };
  };
  return {
    calls,
    store,
    bot: new NoctBot({
      telegram,
      site,
      store,
      secret: 'qa_secret_only_not_a_live_credential',
      siteUrl: 'http://localhost:3000',
    }),
  };
}
function event(id, data) {
  return {
    update_id: id,
    callback_query: {
      id: 'callback_' + id,
      from: { id: 123 },
      data,
      message: { message_id: 90, chat: { id: 123, type: 'private' } },
    },
  };
}
test('Every bot screen is HTML-safe, has bounded buttons and never offers a payment', () => {
  for (const preferences of [{}, { rich: false }, { customEmoji: true }]) {
    for (const name of [
      'home',
      'packages',
      'confirm',
      'success',
      'history',
      'settings',
      'help',
      'proof',
      'error',
    ]) {
      const view = screen(name, state, {
        ...options,
        preferences,
        emojiAvailable: true,
        code: '00000001',
        message: '<broken>',
      });
      assert.ok(view.text.length < 4096);
      assert.ok(
        !view.text.includes('<script>') &&
          !view.text.includes('qa<&>') &&
          !view.text.includes('<broken>'),
      );
      for (const row of view.rows)
        for (const button of row) {
          assert.equal(button.pay, undefined);
          assert.ok(!button.url?.includes('localhost'));
          if (button.callback_data)
            assert.ok(Buffer.byteLength(button.callback_data) <= 64);
        }
    }
  }
  assert.throws(
    () => telegramTransport('fake')('sendInvoice', {}),
    /not enabled/,
  );
});
test('Bridge credentials only travel over HTTPS or actual loopback', () => {
  assert.equal(safeBase('http://localhost:3000'), 'http://localhost:3000');
  assert.throws(() => safeBase('http://example.com'));
  assert.throws(() => safeBase('https://user:pass@example.com'));
  assert.throws(() => safeBase('https://example.com/?secret=x'));
});
test('Callback navigation edits one panel and always answers the callback', async () => {
  const f = fixture(async () => state);
  try {
    await f.bot.handle(event(1, 'home'));
    await f.bot.handle(event(2, 'history'));
    assert.equal(f.calls.filter((x) => x.method === 'sendMessage').length, 1);
    assert.equal(
      f.calls.filter((x) => x.method === 'editMessageText').length,
      1,
    );
    assert.equal(
      f.calls.filter((x) => x.method === 'answerCallbackQuery').length,
      2,
    );
  } finally {
    f.store.close();
  }
});
test('Private identity cannot be replaced by a group, forward or mismatched sender', async () => {
  let siteCalls = 0;
  const f = fixture(async () => {
    siteCalls++;
    return state;
  });
  try {
    const group = event(1, 'credit:abc');
    group.callback_query.message.chat.type = 'group';
    const other = event(2, 'credit:abc');
    other.callback_query.from.id = 456;
    await f.bot.handle(group);
    await f.bot.handle(other);
    assert.equal(siteCalls, 0);
  } finally {
    f.store.close();
  }
});
test('Link proof is stable across retries and only issued to a private Telegram chat', async () => {
  const requests = [],
    f = fixture(async (body) => {
      requests.push(body);
      return { pending: true };
    });
  try {
    const update = {
      update_id: 3,
      message: {
        from: { id: 123, first_name: 'qa' },
        chat: { id: 123, type: 'private' },
        text: '/start link_' + 'a'.repeat(32),
      },
    };
    await f.bot.handle(update);
    await f.bot.handle(update);
    assert.equal(requests.length, 2);
    assert.match(requests[0].code, /^[0-9]{8}$/);
    assert.equal(requests[0].code, requests[1].code);
    assert.equal(requests[0].telegramId, '123');
  } finally {
    f.store.close();
  }
});
test('Lost reply after credit retries the same order without making another quote', async () => {
  const requests = [],
    f = fixture(async (body) => {
      requests.push(body);
      return body.action === 'credit'
        ? { ...state, order: options.order }
        : state;
    });
  try {
    const real = f.bot.telegram;
    f.bot.telegram = async (method, body) => {
      if (method === 'sendMessage')
        throw new RemoteError('telegram', 503, 'network');
      return real(method, body);
    };
    const update = event(4, 'credit:' + options.order.id);
    await assert.rejects(() => f.bot.handle(update));
    f.bot.telegram = real;
    await f.bot.handle(update);
    assert.deepEqual(
      requests.filter((x) => x.action === 'credit').map((x) => x.id),
      [options.order.id, options.order.id],
    );
    assert.equal(
      requests.some((x) => x.action === 'order'),
      false,
    );
  } finally {
    f.store.close();
  }
});
test('Backend outages stay retryable; business rejections become readable screens', async () => {
  const f = fixture(async () => {
    throw new RemoteError('site', 503, 'down');
  });
  try {
    await assert.rejects(() => f.bot.handle(event(5, 'home')));
    f.bot.site = async () => {
      throw new RemoteError('site', 409, 'Пакет истёк');
    };
    await f.bot.handle(event(6, 'packages'));
    assert.match(f.calls.at(-1).body.text, /пакет истёк/);
  } finally {
    f.store.close();
  }
});
test('Preference toggles survive replay without inverting twice', async () => {
  const f = fixture(async () => state);
  try {
    await f.bot.handle(event(7, 'toggle:rich'));
    await f.bot.handle(event(7, 'toggle:rich'));
    assert.equal(f.store.get('chat:123').rich, false);
    await f.bot.handle(event(8, 'toggle:rich'));
    assert.equal(f.store.get('chat:123').rich, true);
  } finally {
    f.store.close();
  }
});
