import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliverDropUpdates,
  DropRetryError,
  dropRetryDelayMs,
} from '../bot/drop-service.mjs';

const url = 'https://gifts.example.test/';
const command = (id, chat = id) => ({
  update_id: id,
  message: { chat: { id: chat, type: 'private' }, text: '/start' },
});

void test('a blocked user or invalid chat does not prevent delivery to the next user', async () => {
  for (const status of [400, 403]) {
    const delivered = [];
    const telegram = async (method, body) => {
      assert.equal(method, 'sendMessage');
      if (body.chat_id === 1)
        throw Object.assign(new Error('Permanent failure'), { status });
      delivered.push(body);
    };
    const offset = await deliverDropUpdates({
      updates: [command(1), command(2)],
      telegram,
      url,
    });
    assert.equal(offset, 3);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].chat_id, 2);
    assert.equal(
      delivered[0].reply_markup.inline_keyboard[0][0].web_app.url,
      url,
    );
    assert.equal(
      delivered[0].reply_markup.inline_keyboard[1][0].url,
      'https://noctgram.com',
    );
  }
});

void test('a transient failure retries its update without dropping later updates or replaying earlier replies', async () => {
  const updates = [command(10), command(11), command(12)],
    delivered = [];
  let outage = true,
    retry;
  const telegram = async (_method, body) => {
    if (body.chat_id === 11 && outage)
      throw Object.assign(new Error('Temporary failure'), { status: 503 });
    delivered.push(body.chat_id);
  };
  await assert.rejects(
    deliverDropUpdates({ updates, telegram, url, offset: 10 }),
    (error) => {
      retry = error;
      return error instanceof DropRetryError;
    },
  );
  assert.equal(retry.offset, 11);
  assert.equal(dropRetryDelayMs(retry), 3000);
  assert.deepEqual(delivered, [10]);
  outage = false;
  const offset = await deliverDropUpdates({
    updates,
    telegram,
    url,
    offset: retry.offset,
  });
  assert.equal(offset, 13);
  assert.deepEqual(delivered, [10, 11, 12]);
});

void test('Telegram rate limits keep the update pending and preserve the requested retry delay', async () => {
  let retry;
  await assert.rejects(
    deliverDropUpdates({
      updates: [command(20)],
      url,
      offset: 20,
      telegram: async () => {
        throw Object.assign(new Error('Too many requests'), {
          status: 429,
          retryAfter: 17,
        });
      },
    }),
    (error) => {
      retry = error;
      return error instanceof DropRetryError;
    },
  );
  assert.equal(retry.offset, 20);
  assert.equal(dropRetryDelayMs(retry), 17000);
  // Polling errors use the same delay helper, including getUpdates 429 replies.
  assert.equal(dropRetryDelayMs({ retryAfter: 23 }), 23000);
  assert.equal(dropRetryDelayMs({ retryAfter: NaN }), 3000);
});

void test('unrelated messages are acknowledged, while shutdown leaves unprocessed updates pending', async () => {
  const group = command(30);
  group.message.chat.type = 'group';
  const unrelated = command(31);
  unrelated.message.text = 'hello';
  let deliveries = 0;
  const telegram = async () => {
    deliveries++;
  };
  assert.equal(
    await deliverDropUpdates({
      updates: [group, unrelated],
      telegram,
      url,
      offset: 30,
    }),
    32,
  );
  assert.equal(deliveries, 0);
  assert.equal(
    await deliverDropUpdates({
      updates: [command(32)],
      telegram,
      url,
      offset: 32,
      stopped: () => true,
    }),
    32,
  );
  assert.equal(deliveries, 0);
});
