import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const journal = JSON.parse(
  await readFile(root + '/drizzle/meta/_journal.json', 'utf8'),
);
const migrations = await Promise.all(
  journal.entries.map((entry) =>
    readFile(root + '/drizzle/' + entry.tag + '.sql', 'utf8'),
  ),
);
let sqlite,
  beforeBatch = null,
  failBatchAt = 0,
  batchTail = Promise.resolve();
function prepare(sql) {
  let args = [];
  return {
    bind(...values) {
      args = values;
      return this;
    },
    async first() {
      return sqlite.prepare(sql).get(...args) || null;
    },
    async run() {
      return { meta: sqlite.prepare(sql).run(...args) };
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...args) };
    },
  };
}
globalThis.reviewDb = {
  prepare,
  batch(statements) {
    const job = batchTail.then(async () => {
      if (beforeBatch) {
        const hook = beforeBatch;
        beforeBatch = null;
        hook();
      }
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (let index = 0; index < statements.length; index++) {
          if (failBatchAt === index + 1) {
            failBatchAt = 0;
            throw Error('injected conversion batch failure');
          }
          results.push(await statements[index].run());
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    });
    batchTail = job.catch(() => {});
    return job;
  },
};
const compiled = await build({
  stdin: {
    contents:
      "export * from './lib/gift-conversions';export * from './lib/gift-conversion-policy';export * from './lib/gift-upgrades';export * from './lib/gifts';export * from './lib/star-wallet';export * from './lib/gift-catalog';export * from './lib/chat-messages';",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'review',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/(storage|server)$/ }, () => ({
          path: 'storage',
          namespace: 'review',
        }));
        builder.onResolve({ filter: /^\.\/auth-session$/ }, () => ({
          path: 'auth',
          namespace: 'review',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'review' }, ({ path }) => ({
          contents:
            path === 'auth'
              ? "export const setting=()=> '0';export const tokenHash=async value=>value;"
              : "export const db=()=>globalThis.reviewDb;export {ApiError} from './lib/api-error';export const clean=value=>value;",
          resolveDir: root,
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      compiled.outputFiles[0].text +
        '\n//# sourceURL=gift-conversion-test-bundle.mjs',
    ).toString('base64')
);
const now = Date.UTC(2026, 8, 12, 12);
const day = 24 * 60 * 60 * 1000;
let serial = 0;
function fresh() {
  if (sqlite) sqlite.close();
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const sql of migrations) sqlite.exec(sql);
  assert(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE name='gift_conversions'")
      .get(),
    'The migration journal must create gift_conversions',
  );
  sqlite.exec(
    "INSERT INTO users(id,name,kind,onboardingComplete,created) VALUES('alice','Alice','person',1,1),('bob','Bob','person',1,1),('carol','Carol','person',1,1),('channel','Channel','channel',1,1)",
  );
  for (const user of ['alice', 'bob', 'carol'])
    sqlite
      .prepare(
        "INSERT INTO star_transfers(id,recipient,amount,kind,created) VALUES(?,?,1000,'grant',1)",
      )
      .run('seed:' + user, user);
  beforeBatch = null;
  failBatchAt = 0;
  batchTail = Promise.resolve();
}
function receipt({
  price = 101,
  sender = 'alice',
  recipient = 'bob',
  created = now - 1000,
  kind = 'gift',
  paymentSender = sender,
  paymentRecipient = 'noctgram_gifts',
  giftId = 'eternal_rose',
} = {}) {
  const id = 'conversion-receipt:' + ++serial;
  sqlite
    .prepare(
      'INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      'purchase:' + id,
      paymentSender,
      paymentRecipient,
      JSON.stringify({ recipient, giftId, message: 'Original message' }),
      price,
      kind,
      created,
    );
  sqlite
    .prepare(
      'INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,message,created) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      id,
      'purchase:' + id,
      giftId,
      sender,
      recipient,
      'Original message',
      created,
    );
  return id;
}
const input = (id, expectedAmount = 85) => ({ id, expectedAmount });
const upgradeInput = (id) => ({
  id,
  expectedPrice: 25,
  keepOriginal: true,
});
const count = (table) =>
  sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
const denied = (error) => error.status >= 400 && error.status < 500;
const snapshot = () =>
  Object.fromEntries(
    [
      'star_transfers',
      'received_gifts',
      'gift_conversions',
      'gift_upgrades',
      'gift_collection_sequences',
      'messages',
      'notifications',
    ].map((table) => [table, count(table)]),
  );
function restrict(user, mode = 'read_only') {
  const id = 'restriction:' + ++serial;
  sqlite
    .prepare(
      "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,'carol',?,'Test restriction',1)",
    )
    .run(id, user, mode);
  sqlite
    .prepare(
      "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,?,'Test restriction',1)",
    )
    .run(user, id, mode);
}
let passed = 0;
async function probe(label, run) {
  fresh();
  await run();
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  passed++;
  console.log('PASS ' + label);
}

await probe(
  'fixed 15% fee, whole-Star rounding, and safe integer guards',
  () => {
    assert.equal(api.GIFT_CONVERSION_FEE_PERCENT, 15);
    for (const [price, amount] of [
      [2, 1],
      [25, 21],
      [100, 85],
      [101, 85],
      [999, 849],
      [
        Number.MAX_SAFE_INTEGER,
        Number((BigInt(Number.MAX_SAFE_INTEGER) * 85n) / 100n),
      ],
    ])
      assert.equal(api.giftConversionAmount(price), amount);
    for (const value of [
      -1,
      0,
      1.5,
      '100',
      null,
      undefined,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      let result;
      try {
        result = api.giftConversionAmount(value);
      } catch {
        continue;
      }
      assert(
        result === null || result === undefined || result === 0,
        'Invalid price must not produce a payout: ' + String(value),
      );
    }
  },
);

await probe(
  'preview uses original ledger price and conversion credits once',
  async () => {
    const id = receipt();
    assert.notEqual(api.availableGiftDefinition('eternal_rose').price, 101);
    const before = snapshot();
    const original = sqlite
      .prepare('SELECT * FROM received_gifts WHERE id=?')
      .get(id);
    const preview = await api.previewGiftConversion('bob', id, now);
    assert.equal(preview.id, id);
    assert.equal(preview.available, true);
    assert.equal(preview.originalPrice, 101);
    assert.equal(preview.amount, 85);
    assert.equal(preview.fee, 16);
    assert.equal(preview.feePercent, 15);
    assert.equal(preview.convertedAt, null);
    assert.deepEqual(
      snapshot(),
      before,
      'Preview must not mutate gifts or wallet',
    );
    const result = await api.convertGift(
      'bob',
      { ...input(id), amount: 10000, price: 10000 },
      now,
    );
    assert.deepEqual(result, {
      id,
      amount: 85,
      balance: 1085,
      convertedAt: now,
    });
    assert.equal(await api.balance('alice'), 899);
    assert.equal(await api.balance('bob'), 1085);
    assert.equal(count('gift_conversions'), 1);
    assert.equal(count('star_transfers'), before.star_transfers + 1);
    assert.deepEqual(
      sqlite.prepare('SELECT * FROM received_gifts WHERE id=?').get(id),
      original,
    );
    const credit = sqlite
      .prepare(
        'SELECT t.recipient,t.amount,c.created FROM gift_conversions c JOIN star_transfers t ON t.id=c.transferId WHERE c.receiptId=?',
      )
      .get(id);
    assert.deepEqual(
      { ...credit },
      { recipient: 'bob', amount: 85, created: now },
    );
    const soldPreview = await api.previewGiftConversion('bob', id, now + 1);
    assert.equal(soldPreview.available, false);
    assert.equal(soldPreview.convertedAt, now);
  },
);

await probe(
  'same receipt concurrent requests and changed late retries give one payout',
  async () => {
    const id = receipt();
    const before = snapshot();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => api.convertGift('bob', input(id), now)),
    );
    for (const result of results) assert.deepEqual(result, results[0]);
    assert.equal(count('gift_conversions'), 1);
    assert.equal(count('star_transfers'), before.star_transfers + 1);
    assert.equal(await api.balance('bob'), 1085);
    const retry = await api.convertGift('bob', input(id, -1), now + 365 * day);
    assert.deepEqual(retry, results[0]);
    assert.equal(count('gift_conversions'), 1);
    assert.equal(await api.balance('bob'), 1085);
    await assert.rejects(api.convertGift('carol', input(id), now), denied);
    await assert.rejects(api.previewGiftConversion('carol', id, now), denied);
    assert.equal(await api.balance('carol'), 1000);
  },
);

await probe(
  'distinct receipts independently credit their actual original prices',
  async () => {
    const first = receipt({ price: 25 });
    const second = receipt({ price: 101 });
    await Promise.all([
      api.convertGift('bob', input(first, 21), now),
      api.convertGift('bob', input(second, 85), now),
    ]);
    assert.equal(count('gift_conversions'), 2);
    assert.equal(await api.balance('bob'), 1106);
  },
);

await probe(
  'gifts remain convertible immediately, after seven days, eight days, and one year',
  async () => {
    for (const age of [0, 7 * day, 8 * day, 365 * day]) {
      const created = now - age;
      const id = receipt({ created });
      assert.equal(
        (await api.previewGiftConversion('bob', id, now)).available,
        true,
      );
      await api.convertGift('bob', input(id), now);
      assert.equal(
        sqlite.prepare('SELECT created FROM received_gifts WHERE id=?').get(id)
          .created,
        created,
        'Conversion must preserve the original receipt date',
      );
    }
    assert.equal(count('gift_conversions'), 4);
    assert.equal(await api.balance('bob'), 1340);
  },
);

await probe('future timestamps cannot convert', async () => {
  for (const created of [now + 1, now + day]) {
    const id = receipt({ created });
    const before = snapshot();
    const preview = await api.previewGiftConversion('bob', id, now);
    assert.equal(preview.available, false);
    assert.equal(typeof preview.reason, 'string');
    assert(preview.reason.length > 0);
    await assert.rejects(api.convertGift('bob', input(id), now), denied);
    assert.deepEqual(snapshot(), before);
  }
  assert.equal(await api.balance('bob'), 1000);
});

await probe(
  'non-purchase, free admin, nonpositive, and mismatched payment provenance cannot convert',
  async () => {
    for (const fixture of [
      { price: 0, kind: 'gift_admin', paymentSender: null },
      { price: 100, kind: 'grant' },
      { price: 0 },
      { price: 1 },
      { price: -1 },
      { price: 100.5 },
      { paymentSender: 'carol' },
      { paymentRecipient: 'carol' },
    ]) {
      const id = receipt(fixture);
      const before = snapshot();
      assert.equal(
        (await api.previewGiftConversion('bob', id, now)).available,
        false,
      );
      await assert.rejects(api.convertGift('bob', input(id), now), denied);
      assert.deepEqual(snapshot(), before);
    }
    assert.equal(await api.balance('bob'), 1000);
  },
);

await probe(
  'expected amount mismatch and malformed IDs cannot move Stars',
  async () => {
    const id = receipt();
    const before = snapshot();
    for (const expectedAmount of [84, 86, 10000, '85', -1, undefined])
      await assert.rejects(
        api.convertGift('bob', { id, expectedAmount }, now),
        denied,
      );
    await assert.rejects(
      api.convertGift('bob', input(id, 84), now),
      (error) => error.status === 409,
    );
    for (const invalid of ['', 42, null, 'x'.repeat(221)])
      await assert.rejects(api.convertGift('bob', input(invalid), now), denied);
    await assert.rejects(
      api.convertGift('bob', input('missing-gift'), now),
      denied,
    );
    assert.deepEqual(snapshot(), before);
    assert.equal(await api.balance('bob'), 1000);
  },
);

await probe(
  'failed conversion batch rolls back credit and remains retryable',
  async () => {
    const id = receipt();
    const before = snapshot();
    failBatchAt = 2;
    await assert.rejects(
      api.convertGift('bob', input(id), now),
      /injected conversion batch failure/,
    );
    assert.deepEqual(snapshot(), before);
    assert.equal(await api.balance('bob'), 1000);
    assert.equal((await api.listGifts('bob', 'bob')).gifts.length, 1);
    const result = await api.convertGift('bob', input(id), now);
    assert.equal(result.balance, 1085);
    assert.equal(count('gift_conversions'), 1);
  },
);

for (const mode of ['read_only', 'blocked']) {
  await probe(mode + ' recipient restriction prevents conversion', async () => {
    const id = receipt();
    restrict('bob', mode);
    const before = snapshot();
    await assert.rejects(api.convertGift('bob', input(id), now), denied);
    assert.deepEqual(snapshot(), before);
    assert.equal(await api.balance('bob'), 1000);
  });
  await probe(
    mode + ' restriction imposed immediately before batch prevents credit',
    async () => {
      const id = receipt();
      const before = snapshot();
      beforeBatch = () => restrict('bob', mode);
      await assert.rejects(api.convertGift('bob', input(id), now), denied);
      assert.deepEqual(snapshot(), before);
      assert.equal(await api.balance('bob'), 1000);
    },
  );
}

for (const [label, change] of [
  [
    'ownership changed',
    (id) =>
      sqlite
        .prepare("UPDATE received_gifts SET recipient='carol' WHERE id=?")
        .run(id),
  ],
  [
    'recipient deleted',
    () => sqlite.exec("UPDATE users SET deletedAt=1 WHERE id='bob'"),
  ],
  [
    'recipient onboarding revoked',
    () => sqlite.exec("UPDATE users SET onboardingComplete=0 WHERE id='bob'"),
  ],
  [
    'recipient became a channel',
    () => sqlite.exec("UPDATE users SET kind='channel' WHERE id='bob'"),
  ],
  [
    'purchase amount changed',
    (id) =>
      sqlite
        .prepare('UPDATE star_transfers SET amount=200 WHERE id=?')
        .run('purchase:' + id),
  ],
  [
    'purchase sender changed',
    (id) =>
      sqlite
        .prepare("UPDATE star_transfers SET sender='carol' WHERE id=?")
        .run('purchase:' + id),
  ],
  [
    'receipt timestamp changed to future',
    (id) =>
      sqlite
        .prepare('UPDATE received_gifts SET created=? WHERE id=?')
        .run(now + 1, id),
  ],
])
  await probe(label + ' immediately before batch prevents credit', async () => {
    const id = receipt();
    const before = snapshot();
    beforeBatch = () => change(id);
    await assert.rejects(api.convertGift('bob', input(id), now), denied);
    assert.deepEqual(snapshot(), before);
    assert.equal(await api.balance('bob'), 1000);
  });

await probe(
  'self-gift conversion refunds 85% once without creating a self-chat',
  async () => {
    sqlite.exec(
      "INSERT INTO user_privacy(userId,messagePolicy) VALUES('bob','nobody')",
    );
    const gift = api.availableGiftDefinition('eternal_rose');
    const sent = await api.sendGift(
      'bob',
      {
        recipient: 'bob',
        giftId: gift.id,
        key: 'conversion-self-request-0001',
        message: 'For myself',
      },
      now,
    );
    const amount = Math.floor((gift.price * 85) / 100);
    const result = await api.convertGift(
      'bob',
      input(sent.id, amount),
      now + 1,
    );
    assert.equal(result.balance, 1000 - gift.price + amount);
    assert.equal(count('received_gifts'), 1);
    assert.equal(count('gift_conversions'), 1);
    assert.equal(count('messages'), 0);
    assert.equal(count('notifications'), 0);
    assert.equal((await api.listGifts('bob', 'bob')).gifts.length, 0);
  },
);

for (const [label, change] of [
  [
    'sender blocks recipient',
    () =>
      sqlite.exec(
        "INSERT INTO user_blocks(blocker,blocked,created) VALUES('alice','bob',1)",
      ),
  ],
  [
    'recipient blocks sender',
    () =>
      sqlite.exec(
        "INSERT INTO user_blocks(blocker,blocked,created) VALUES('bob','alice',1)",
      ),
  ],
  ['sender account blocked', () => restrict('alice', 'blocked')],
  [
    'sender account deleted',
    () => sqlite.exec("UPDATE users SET deletedAt=1 WHERE id='alice'"),
  ],
  [
    'sender disables messages',
    () =>
      sqlite.exec(
        "INSERT INTO user_privacy(userId,messagePolicy) VALUES('alice','nobody')",
      ),
  ],
])
  await probe('owned gift remains convertible when ' + label, async () => {
    const id = receipt();
    change();
    assert.equal(
      (await api.previewGiftConversion('bob', id, now)).available,
      true,
    );
    const result = await api.convertGift('bob', input(id), now);
    assert.equal(result.balance, 1085);
  });

await probe(
  'conversion disappears from profiles and detail lookup, and visibility cannot restore it',
  async () => {
    const sold = receipt();
    const retained = receipt();
    await api.convertGift('bob', input(sold), now);
    for (const viewer of ['bob', 'carol']) {
      assert.deepEqual(
        (await api.listGifts(viewer, 'bob')).gifts.map((gift) => gift.id),
        [retained],
      );
      assert.equal(
        (await api.listGifts(viewer, 'bob', '', sold)).gifts.length,
        0,
      );
    }
    for (const hidden of [true, false]) {
      try {
        await api.giftVisibility('bob', { id: sold, hidden });
      } catch (error) {
        assert(denied(error));
      }
      for (const viewer of ['bob', 'carol'])
        assert.equal(
          (await api.listGifts(viewer, 'bob', '', sold)).gifts.length,
          0,
        );
    }
    assert.equal(count('received_gifts'), 2);
    assert.equal(count('gift_conversions'), 1);
  },
);

await probe(
  'original gift message survives conversion and reports its sold state to both participants',
  async () => {
    const sent = await api.sendGift(
      'alice',
      {
        recipient: 'bob',
        giftId: 'eternal_rose',
        key: 'conversion-message-request-0001',
        message: 'A lasting message',
      },
      now,
    );
    const before = (await api.readConversation('bob', 'alice'))[0];
    assert.equal(Boolean(before.gift.converted), false);
    await api.convertGift(
      'bob',
      input(sent.id, Math.floor((before.gift.price * 85) / 100)),
      now + 1,
    );
    for (const [viewer, peer] of [
      ['bob', 'alice'],
      ['alice', 'bob'],
    ]) {
      const messages = await api.readConversation(viewer, peer);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].id, before.id);
      assert.equal(messages[0].text, before.text);
      assert.equal(messages[0].gift.id, sent.id);
      assert.equal(messages[0].gift.message, 'A lasting message');
      assert.equal(messages[0].gift.price, before.gift.price);
      assert.equal(messages[0].gift.converted, true);
    }
    assert.equal(count('messages'), 1);
    assert.equal(count('received_gifts'), 1);
  },
);

await probe(
  'a sold gift cannot be upgraded or charged for an upgrade',
  async () => {
    const id = receipt();
    await api.convertGift('bob', input(id), now);
    const before = snapshot();
    await assert.rejects(api.upgradeGift('bob', upgradeInput(id), now), denied);
    assert.deepEqual(snapshot(), before);
    assert.equal(await api.balance('bob'), 1085);
  },
);

await probe(
  'an upgraded gift cannot be converted even when original details are kept',
  async () => {
    const id = receipt();
    await api.upgradeGift('bob', upgradeInput(id), now);
    const before = snapshot();
    assert.equal(
      (await api.previewGiftConversion('bob', id, now)).available,
      false,
    );
    await assert.rejects(api.convertGift('bob', input(id), now), denied);
    assert.deepEqual(snapshot(), before);
    assert.equal(await api.balance('bob'), 975);
  },
);

for (const conversionFirst of [true, false])
  await probe(
    'concurrent sale and upgrade commit exactly one outcome, sale queued ' +
      (conversionFirst ? 'first' : 'last'),
    async () => {
      const id = receipt();
      const convert = () => api.convertGift('bob', input(id), now);
      const upgrade = () => api.upgradeGift('bob', upgradeInput(id), now);
      const jobs = conversionFirst ? [convert, upgrade] : [upgrade, convert];
      const results = await Promise.allSettled(jobs.map((run) => run()));
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        results.filter(
          (result) => result.status === 'rejected' && denied(result.reason),
        ).length,
        1,
      );
      assert.equal(count('gift_conversions') + count('gift_upgrades'), 1);
      assert.equal(
        count('star_transfers'),
        5,
        'Three seed grants, one purchase, and one conversion or upgrade',
      );
      if (count('gift_conversions')) {
        assert.equal(await api.balance('bob'), 1085);
        assert.equal(count('gift_collection_sequences'), 0);
      } else {
        assert.equal(await api.balance('bob'), 975);
        assert.equal(count('gift_collection_sequences'), 1);
      }
    },
  );

await probe(
  'conversion records are immutable and unique per receipt and credit',
  async () => {
    const id = receipt();
    await api.convertGift('bob', input(id), now);
    const row = sqlite
      .prepare('SELECT * FROM gift_conversions WHERE receiptId=?')
      .get(id);
    assert.throws(
      () =>
        sqlite
          .prepare(
            'UPDATE gift_conversions SET amount=amount+1 WHERE receiptId=?',
          )
          .run(id),
      /GIFT_CONVERSION_IMMUTABLE/,
    );
    assert.throws(
      () =>
        sqlite
          .prepare(
            'INSERT INTO gift_conversions(receiptId,transferId,amount,created) VALUES(?,?,?,?)',
          )
          .run(row.receiptId, row.transferId, row.amount, row.created),
      /UNIQUE constraint failed/,
    );
    const second = receipt();
    assert.throws(() =>
      sqlite
        .prepare(
          'INSERT INTO gift_conversions(receiptId,transferId,amount,created) VALUES(?,?,?,?)',
        )
        .run(second, row.transferId, row.amount, row.created),
    );
    assert.equal(count('gift_conversions'), 1);
    assert.equal(await api.balance('bob'), 1085);
  },
);

await probe(
  'database guard rejects forged conversion provenance and future receipt dates',
  async () => {
    for (const [label, tamper] of [
      [
        'original payment kind',
        (row) =>
          sqlite
            .prepare("UPDATE star_transfers SET kind='grant' WHERE id=?")
            .run('purchase:' + row.receiptId),
      ],
      [
        'original payment amount',
        (row) =>
          sqlite
            .prepare('UPDATE star_transfers SET amount=200 WHERE id=?')
            .run('purchase:' + row.receiptId),
      ],
      [
        'original payment sender',
        (row) =>
          sqlite
            .prepare("UPDATE star_transfers SET sender='carol' WHERE id=?")
            .run('purchase:' + row.receiptId),
      ],
      [
        'original payment treasury',
        (row) =>
          sqlite
            .prepare("UPDATE star_transfers SET recipient='carol' WHERE id=?")
            .run('purchase:' + row.receiptId),
      ],
      [
        'credit kind',
        (row) =>
          sqlite
            .prepare("UPDATE star_transfers SET kind='gift' WHERE id=?")
            .run(row.transferId),
      ],
      [
        'credit sender',
        (row) =>
          sqlite
            .prepare("UPDATE star_transfers SET sender='carol' WHERE id=?")
            .run(row.transferId),
      ],
      [
        'credit recipient',
        (row) =>
          sqlite
            .prepare("UPDATE star_transfers SET recipient='carol' WHERE id=?")
            .run(row.transferId),
      ],
      [
        'credit amount',
        (row) =>
          sqlite
            .prepare('UPDATE star_transfers SET amount=amount+1 WHERE id=?')
            .run(row.transferId),
      ],
      [
        'credit receipt metadata',
        (row) =>
          sqlite
            .prepare("UPDATE star_transfers SET postText='{}' WHERE id=?")
            .run(row.transferId),
      ],
      [
        'credit timestamp',
        (row) =>
          sqlite
            .prepare('UPDATE star_transfers SET created=created+1 WHERE id=?')
            .run(row.transferId),
      ],
      [
        'future gift',
        (row) =>
          sqlite
            .prepare('UPDATE received_gifts SET created=? WHERE id=?')
            .run(now + 1, row.receiptId),
      ],
    ]) {
      fresh();
      const id = receipt();
      await api.convertGift('bob', input(id), now);
      const row = sqlite
        .prepare('SELECT * FROM gift_conversions WHERE receiptId=?')
        .get(id);
      sqlite.prepare('DELETE FROM gift_conversions WHERE receiptId=?').run(id);
      tamper(row);
      assert.throws(
        () =>
          sqlite
            .prepare(
              'INSERT INTO gift_conversions(receiptId,transferId,amount,created) VALUES(?,?,?,?)',
            )
            .run(row.receiptId, row.transferId, row.amount, row.created),
        /INVALID_GIFT_CONVERSION_PAYMENT/,
        label,
      );
      assert.equal(count('gift_conversions'), 0);
    }
  },
);

await probe(
  'database guard prevents old workers from recreating an upgrade for a converted receipt',
  async () => {
    const id = receipt();
    await api.upgradeGift('bob', upgradeInput(id), now);
    const upgrade = sqlite
      .prepare('SELECT * FROM gift_upgrades WHERE receiptId=?')
      .get(id);
    // Simulate an old worker retaining a previously valid upgrade statement.
    sqlite.prepare('DELETE FROM gift_upgrades WHERE receiptId=?').run(id);
    await api.convertGift('bob', input(id), now);
    assert.throws(
      () =>
        sqlite
          .prepare(
            'INSERT INTO gift_upgrades(receiptId,transferId,family,number,attributes,keepOriginal,created) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            upgrade.receiptId,
            upgrade.transferId,
            upgrade.family,
            upgrade.number,
            upgrade.attributes,
            upgrade.keepOriginal,
            upgrade.created,
          ),
      /GIFT_ALREADY_CONVERTED/,
    );
    assert.equal(count('gift_upgrades'), 0);
    assert.equal(count('gift_conversions'), 1);
  },
);

sqlite.close();
console.log(`All ${passed} independent gift conversion probes passed`);
