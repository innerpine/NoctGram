import test from 'node:test';
import assert from 'node:assert/strict';
import { NoctBot } from '../bot/handler.mjs';
import { screen } from '../bot/screens.mjs';
import { icons } from '../bot/emoji.mjs';
import { RemoteError, safeBase, telegramTransport } from '../bot/transport.mjs';
import { BotStore } from '../bot/store.mjs';
const state = {
  testMode: true,
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
  let nextMessageId = 90;
  const telegram = async (method, body) => {
    calls.push({ method, body });
    return {
      message_id: method === 'sendMessage' ? ++nextMessageId : body.message_id,
    };
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
function command(id, text = '/start') {
  return {
    update_id: id,
    message: {
      message_id: id,
      from: { id: 123 },
      chat: { id: 123, type: 'private' },
      text,
    },
  };
}
void test('Legacy test-mode screens stay HTML-safe and bounded; arbitrary API methods are denied', () => {
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
    () => telegramTransport('fake')('transferGift', {}),
    /not enabled/,
  );
});
void test('Bridge credentials only travel over HTTPS or actual loopback', () => {
  assert.equal(safeBase('http://localhost:3000'), 'http://localhost:3000');
  assert.throws(() => safeBase('http://example.com'));
  assert.throws(() => safeBase('https://user:pass@example.com'));
  assert.throws(() => safeBase('https://example.com/?secret=x'));
});
void test('Callback navigation edits one panel and always answers the callback', async () => {
  const f = fixture(async () => state);
  try {
    await f.bot.handle(command(0));
    await f.bot.handle(event(1, 'home'));
    await f.bot.handle(event(2, 'history'));
    assert.equal(f.calls.filter((x) => x.method === 'sendMessage').length, 1);
    assert.equal(
      f.calls.filter((x) => x.method === 'editMessageText').length,
      2,
    );
    assert.equal(
      f.calls.filter((x) => x.method === 'answerCallbackQuery').length,
      2,
    );
  } finally {
    f.store.close();
  }
});
void test('Private identity cannot be replaced by a group, forward or mismatched sender', async () => {
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
void test('Link proof is stable across retries and only issued to a private Telegram chat', async () => {
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
void test('Lost reply after credit retries the same order without making another quote', async () => {
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
      if (method === 'sendMessage' || method === 'editMessageText')
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
void test('Backend outages stay retryable; business rejections become readable screens', async () => {
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
void test('Preference toggles survive replay without inverting twice', async () => {
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

void test('Repeated /start and /balance send visible fresh panels after linking', async () => {
  const f = fixture(async () => state);
  try {
    f.store.set('chat:123', { messageId: 2 });
    await f.bot.handle(command(100));
    await f.bot.handle(command(101));
    await f.bot.handle(command(102, '/balance'));
    const sent = f.calls.filter((x) => x.method === 'sendMessage');
    assert.equal(sent.length, 3);
    assert.ok(
      sent.every(
        (x) => x.body.text.includes('noct stars') && x.body.text.includes('11'),
      ),
    );
    assert.equal(
      f.calls.filter((x) => x.method === 'editMessageText').length,
      0,
    );
    // Replaying a successfully sent command after a restart edits its saved reply.
    await f.bot.handle(command(102, '/balance'));
    assert.equal(f.calls.filter((x) => x.method === 'sendMessage').length, 3);
    assert.equal(f.calls.at(-1).body.message_id, 93);
  } finally {
    f.store.close();
  }
});

void test('An older menu edits the clicked panel without hijacking the latest command reply', async () => {
  const f = fixture(async () => state);
  try {
    await f.bot.handle(command(200));
    const older = event(201, 'history');
    older.callback_query.message.message_id = 2;
    await f.bot.handle(older);
    assert.equal(f.calls.at(-1).body.message_id, 2);
    assert.match(f.calls.at(-1).body.text, /история пополнений/);
    await f.bot.handle(command(200));
    assert.equal(f.calls.at(-1).body.message_id, 91);
  } finally {
    f.store.close();
  }
});

void test('An unchanged callback and an unavailable old panel are handled separately', async () => {
  const f = fixture(async () => state);
  try {
    const real = f.bot.telegram;
    f.bot.telegram = async (method, body) => {
      if (method === 'editMessageText')
        throw new RemoteError(
          'telegram',
          400,
          'Bad Request: message is not modified',
        );
      return real(method, body);
    };
    await f.bot.handle(event(300, 'home'));
    assert.equal(
      f.calls.some((x) => x.method === 'sendMessage'),
      false,
    );
    f.bot.telegram = async (method, body) => {
      if (method === 'editMessageText')
        throw new RemoteError(
          'telegram',
          400,
          'Bad Request: message to edit not found',
        );
      return real(method, body);
    };
    await f.bot.handle(event(301, 'home'));
    assert.equal(f.calls.filter((x) => x.method === 'sendMessage').length, 1);
  } finally {
    f.store.close();
  }
});

void test('Premium emoji are on by default, respect opting out and use the requested packs', async () => {
  const f = fixture(async () => state);
  try {
    f.bot.emojiAvailable = true;
    await f.bot.handle(command(400));
    const first = f.calls.at(-1).body;
    assert.match(first.text, /<tg-emoji emoji-id="[0-9]+">/);
    assert.equal(
      first.reply_markup.inline_keyboard[0][0].icon_custom_emoji_id,
      icons.stars.id,
    );
    assert.deepEqual(
      new Set(Object.values(icons).map((x) => x.pack)),
      new Set(['RestrictedEmoji', 'CreepyEmoji', 'NewsEmoji']),
    );
    await f.bot.handle(event(401, 'toggle:customEmoji'));
    assert.equal(f.store.get('chat:123').customEmoji, false);
    assert.ok(!f.calls.at(-1).body.text.includes('<tg-emoji'));
    await f.bot.handle(command(402));
    assert.ok(!f.calls.at(-1).body.text.includes('<tg-emoji'));
    assert.equal(
      f.calls.at(-1).body.reply_markup.inline_keyboard[0][0]
        .icon_custom_emoji_id,
      undefined,
    );
  } finally {
    f.store.close();
  }
});

void test('Denied custom emoji fall back to readable replies instead of swallowing /start', async () => {
  const f = fixture(async () => state);
  try {
    f.bot.emojiAvailable = true;
    const real = f.bot.telegram;
    let denied = 0;
    f.bot.telegram = async (method, body) => {
      if (body.text?.includes('<tg-emoji')) {
        denied++;
        throw new RemoteError('telegram', 400, 'Custom emoji are not allowed');
      }
      return real(method, body);
    };
    await f.bot.handle(command(500));
    assert.equal(denied, 1);
    assert.equal(f.calls.filter((x) => x.method === 'sendMessage').length, 1);
    assert.ok(!f.calls.at(-1).body.text.includes('<tg-emoji'));
  } finally {
    f.store.close();
  }
});

void test('Error screens also fall back when Telegram denies Premium emoji', async () => {
  let requests = 0;
  const f = fixture(async () => {
    requests++;
    throw new RemoteError('site', 409, 'Ссылка истекла');
  });
  try {
    f.bot.emojiAvailable = true;
    const real = f.bot.telegram;
    f.bot.telegram = async (method, body) => {
      if (body.text?.includes('<tg-emoji'))
        throw new RemoteError('telegram', 400, 'Custom emoji are not allowed');
      return real(method, body);
    };
    await f.bot.handle(command(600));
    assert.equal(
      requests,
      1,
      'Emoji fallback must not replay backend operations',
    );
    assert.equal(f.calls.filter((x) => x.method === 'sendMessage').length, 1);
    assert.match(f.calls.at(-1).body.text, /ссылка истекла/);
  } finally {
    f.store.close();
  }
});

void test('Enabling emoji still refreshes settings when Telegram rejects the icons', async () => {
  const f = fixture(async () => state);
  try {
    f.bot.emojiAvailable = true;
    f.store.set('chat:123', { customEmoji: false, messageId: 2 });
    const real = f.bot.telegram;
    f.bot.telegram = async (method, body) => {
      if (body.text?.includes('<tg-emoji'))
        throw new RemoteError('telegram', 400, 'Custom emoji are not allowed');
      return real(method, body);
    };
    await f.bot.handle(event(700, 'toggle:customEmoji'));
    assert.equal(f.calls.at(-1).method, 'editMessageText');
    assert.match(f.calls.at(-1).body.text, /оформление/);
    assert.ok(!f.calls.at(-1).body.text.includes('<tg-emoji'));
  } finally {
    f.store.close();
  }
});
