import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const entry of journal.entries)
  sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
sqlite.exec(
  "INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1),('poor','Poor',1)",
);
let failNotification = false;
let failMessage = false;
function statement(sql) {
  let values = [];
  return {
    bind(...args) {
      values = args;
      return this;
    },
    async first() {
      return sqlite.prepare(sql).get(...values) || null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async run() {
      if (failMessage && sql.includes('INTO messages')) {
        failMessage = false;
        throw new Error('Simulated message storage failure');
      }
      if (failNotification && sql.includes('INTO notifications')) {
        failNotification = false;
        throw new Error('Simulated storage failure');
      }
      return {
        meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
      };
    },
  };
}
let batchTail = Promise.resolve();
globalThis.__giftDb = {
  prepare: statement,
  batch(statements) {
    const transaction = batchTail.then(async () => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    });
    batchTail = transaction.catch(() => {});
    return transaction;
  },
};
const compiled = await build({
  stdin: {
    contents:
      "export * from './lib/gifts'; export * from './lib/star-wallet'; export * from './lib/chat-messages'; export * from './lib/gift-catalog';",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'sqlite-runtime',
      setup(build) {
        build.onResolve({ filter: /^\.\/(storage|server)$/ }, (args) => ({
          path: args.path,
          namespace: 'fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            "export const db=()=>globalThis.__giftDb; export { ApiError } from './lib/api-error'; export const clean=value=>value;",
          resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const now = Date.now();
let serial = 0;
const purchase = (extra = {}) => ({
  recipient: 'bob',
  giftId: 'toy_bear',
  message: 'Спасибо тебе!',
  key: 'gift-request-' + String(++serial).padStart(8, '0'),
  ...extra,
});
const count = (table) =>
  Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
await api.ensureWallet('alice');
await api.ensureWallet('bob');
assert.equal(api.availableGiftDefinition('diamond_ring'), undefined);
assert.equal(api.giftDefinition('diamond_ring').name, 'Кольцо');
const beforeRetiredRequest = [
  'star_transfers',
  'received_gifts',
  'messages',
  'notifications',
].map(count);
await assert.rejects(
  api.sendGift('alice', purchase({ giftId: 'diamond_ring' }), now),
  (e) => e.status === 400,
);
assert.deepEqual(
  ['star_transfers', 'received_gifts', 'messages', 'notifications'].map(count),
  beforeRetiredRequest,
  'A retired gift cannot be bought through a stale client or direct API request',
);
const first = purchase({ amount: 1 });
const receipt = await api.sendGift('alice', first, now);
assert.equal(
  receipt.balance,
  9975,
  'Price comes from the server catalog, never the client',
);
assert.equal(
  await api.balance('bob'),
  10000,
  'The gift cannot also mint spendable Stars for its recipient',
);
assert.equal(count('received_gifts'), 1);
assert.equal(count('notifications'), 1);
assert.equal(
  count('messages'),
  1,
  'The gift creates a conversation and one chat event',
);
const outgoing = (await api.readConversation('alice', 'bob'))[0];
assert.deepEqual(outgoing.gift, {
  id: receipt.id,
  giftId: 'toy_bear',
  price: 25,
  message: 'Спасибо тебе!',
});
assert.equal(
  outgoing.read,
  0,
  'The sender does not mark the recipient’s gift as read',
);
assert.match(
  outgoing.text,
  /Спасибо тебе!/,
  'Gift captions remain available to recipient message reports',
);
assert.equal(
  (await api.readConversation('carol', 'bob')).length,
  0,
  'A third account cannot read another conversation’s gift',
);
const incoming = (await api.readConversation('bob', 'alice'))[0];
assert.equal(incoming.read, 1);
const writesAfterRead = sqlite.prepare('SELECT total_changes() AS n').get().n;
await api.readConversation('bob', 'alice');
assert.equal(
  sqlite.prepare('SELECT total_changes() AS n').get().n,
  writesAfterRead,
  'Polling an already-read chat does not rewrite its history',
);
assert.equal(
  sqlite
    .prepare('SELECT read FROM notifications WHERE targetId=?')
    .get(receipt.id).read,
  1,
);
assert.deepEqual(
  incoming.gift,
  outgoing.gift,
  'Both participants see the same receipt and purchase price',
);
sqlite
  .prepare(
    'INSERT INTO messages(id,sender,recipient,text,created) VALUES(?,?,?,?,?)',
  )
  .run('plain-message', 'alice', 'bob', 'обычное сообщение', now + 1);
assert.equal(
  (await api.readConversation('bob', 'alice')).find(
    (row) => row.id === 'plain-message',
  ).gift,
  undefined,
  'Normal messages stay normal',
);
assert.equal(
  (await api.listGifts('carol', 'bob')).gifts[0].message,
  'Спасибо тебе!',
);
assert.equal(
  sqlite
    .prepare('SELECT kind FROM notifications WHERE targetId=?')
    .get(receipt.id).kind,
  'gift',
);
await Promise.all(
  Array.from({ length: 8 }, () => api.sendGift('alice', first, now)),
);
assert.equal(await api.balance('alice'), 9975);
assert.equal(count('received_gifts'), 1);
assert.equal(count('notifications'), 1);
assert.equal(
  count('messages'),
  2,
  'Retries do not duplicate the gift card or disturb text messages',
);
await assert.rejects(
  api.sendGift('alice', { ...first, giftId: 'trapped_heart' }, now),
  (e) => e.status === 409,
);
await assert.rejects(
  api.sendGift('alice', { ...first, recipient: 'carol' }, now),
  (e) => e.status === 409,
);

const collided = purchase();
const outcomes = await Promise.allSettled([
  api.sendGift('alice', collided, now),
  api.sendGift('alice', { ...collided, message: 'Different request' }, now),
]);
assert.equal(
  outcomes.filter((r) => r.status === 'fulfilled').length,
  1,
  'Concurrent key reuse cannot change recipient or message',
);
assert.equal(count('received_gifts'), 2);
for (const extra of [
  { giftId: 'missing' },
  { recipient: 'alice' },
  { message: 'x'.repeat(241) },
  { key: 'short' },
])
  await assert.rejects(
    api.sendGift('alice', purchase(extra)),
    (e) => e.status === 400,
  );
for (const recipient of ['missing', 'noctgram_gifts'])
  await assert.rejects(
    api.sendGift('alice', purchase({ recipient })),
    (e) => e.status === 403,
  );
for (const [blocker, blocked] of [
  ['alice', 'bob'],
  ['bob', 'alice'],
]) {
  sqlite
    .prepare('INSERT INTO user_blocks(blocker,blocked,created) VALUES(?,?,?)')
    .run(blocker, blocked, now);
  const before = await api.balance('alice');
  await assert.rejects(
    api.sendGift('alice', purchase()),
    (e) => e.status === 403,
  );
  assert.equal(await api.balance('alice'), before);
  sqlite.exec('DELETE FROM user_blocks');
}
sqlite.exec(
  "INSERT INTO user_privacy(userId,messagePolicy) VALUES('bob','nobody')",
);
await assert.rejects(
  api.sendGift('alice', purchase()),
  (e) => e.status === 403,
);
sqlite.exec(
  "UPDATE user_privacy SET messagePolicy='following' WHERE userId='bob'",
);
await assert.rejects(
  api.sendGift('alice', purchase()),
  (e) => e.status === 403,
);
sqlite.exec("INSERT INTO follows(follower,following) VALUES('bob','alice')");
await api.sendGift('alice', purchase());
sqlite.exec(
  "UPDATE user_privacy SET messagePolicy='everyone' WHERE userId='bob'",
);
sqlite
  .prepare(
    "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('gift-ban','alice','carol','read_only','Fixture',?)",
  )
  .run(now);
sqlite
  .prepare(
    "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('alice','gift-ban','read_only','Fixture',?)",
  )
  .run(now);
await assert.rejects(
  api.sendGift('alice', purchase()),
  (e) => e.status === 403,
);
sqlite.exec("DELETE FROM account_restrictions WHERE userId='alice'");

const rollbackBalance = await api.balance('alice'),
  rollbackGifts = count('received_gifts'),
  rollbackMessages = count('messages');
failNotification = true;
await assert.rejects(api.sendGift('alice', purchase()), /Simulated/);
assert.equal(
  await api.balance('alice'),
  rollbackBalance,
  'Debit, gift and notification roll back together',
);
assert.equal(count('received_gifts'), rollbackGifts);
assert.equal(
  count('messages'),
  rollbackMessages,
  'A failed notification leaves no orphaned gift card',
);
failMessage = true;
await assert.rejects(api.sendGift('alice', purchase()), /Simulated message/);
assert.equal(
  await api.balance('alice'),
  rollbackBalance,
  'A failed chat write also rolls back the debit',
);
assert.equal(count('received_gifts'), rollbackGifts);
assert.equal(count('messages'), rollbackMessages);
sqlite.exec(
  "INSERT INTO star_transfers(id,recipient,amount,kind,created) VALUES('grant:poor','poor',25,'grant',1)",
);
const racing = await Promise.allSettled([
  api.sendGift('poor', purchase()),
  api.sendGift('poor', purchase()),
]);
assert.equal(
  racing.filter((r) => r.status === 'fulfilled').length,
  1,
  'Two simultaneous purchases cannot overspend',
);
assert.equal(await api.balance('poor'), 0);
await assert.rejects(
  api.giftVisibility('alice', { id: receipt.id, hidden: true }),
  (e) => e.status === 404,
);
await api.giftVisibility('bob', { id: receipt.id, hidden: true });
assert.ok(
  (await api.readConversation('alice', 'bob')).some(
    (row) => row.gift?.id === receipt.id,
  ),
  'Hiding a profile gift does not erase its private chat history',
);
assert.ok(
  !(await api.listGifts('carol', 'bob')).gifts.some(
    (gift) => gift.id === receipt.id,
  ),
);
assert.ok(
  (await api.listGifts('bob', 'bob')).gifts.some(
    (gift) => gift.id === receipt.id && gift.hidden === 1,
  ),
);
await api.giftVisibility('bob', { id: receipt.id, hidden: false });
for (let i = 0; i < 26; i++) await api.sendGift('alice', purchase(), now + 100);
const page1 = await api.listGifts('carol', 'bob');
const page2 = await api.listGifts('carol', 'bob', page1.next);
assert.equal(page1.gifts.length, 24);
assert.ok(page2.gifts.length > 0);
assert.ok(
  page1.gifts.every(
    (gift) => !page2.gifts.some((other) => other.id === gift.id),
  ),
  'Pagination handles equal timestamps without duplicates',
);
assert.equal(
  (await api.listGifts('carol', 'bob', '', receipt.id)).gifts.length,
  1,
);
const figurinePrice = api.availableGiftDefinition('durovs_figurine').price;
const beforeFigurine = await api.balance('alice');
const figurine = await api.sendGift(
  'alice',
  purchase({ giftId: 'durovs_figurine', price: 1 }),
  now + 200,
);
assert.equal(figurine.balance, beforeFigurine - figurinePrice);
assert.equal(
  (await api.readConversation('bob', 'alice')).find(
    (row) => row.gift?.id === figurine.id,
  ).gift.price,
  figurinePrice,
  'A newly added gift uses the catalog price and creates the same chat receipt',
);

sqlite.exec(`
  INSERT INTO star_transfers(id,sender,recipient,amount,kind,created)
  VALUES('legacy-ring-transfer','alice','noctgram_gifts',100,'gift',1);
  INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,message,created)
  VALUES('legacy-ring','legacy-ring-transfer','diamond_ring','alice','bob','Старый подарок',1);
  INSERT INTO messages(id,sender,recipient,text,created,giftReceiptId)
  VALUES('legacy-ring-message','alice','bob','Старый подарок',1,'legacy-ring');
`);
const historicalGift = (await api.listGifts('bob', 'bob', '', 'legacy-ring'))
  .gifts[0];
assert.equal(api.giftDefinition(historicalGift.giftId).name, 'Кольцо');
assert.equal(
  (await api.readConversation('bob', 'alice')).find(
    (row) => row.gift?.id === 'legacy-ring',
  ).gift.price,
  100,
  'Retiring a gift preserves the profile receipt and the original chat price',
);
sqlite.close();

// Upgrading an existing installation adds old receipts without changing money,
// notifications, or manufacturing unread messages.
const upgrade = new DatabaseSync(':memory:');
for (const entry of journal.entries.slice(
  0,
  journal.entries.findIndex((entry) => entry.tag === '0018_gift_messages'),
))
  upgrade.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
upgrade.exec(`INSERT INTO users(id,name,created) VALUES('a','A',1),('b','B',1);
  INSERT INTO star_transfers(id,sender,recipient,amount,kind,created) VALUES('old-transfer','a','noctgram_gifts',50,'gift',123);
  INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,message,created) VALUES('old-gift','old-transfer','eternal_rose','a','b','Старый подарок',123);`);
upgrade.exec(await readFile('drizzle/0018_gift_messages.sql', 'utf8'));
assert.deepEqual(
  {
    ...upgrade.prepare('SELECT giftReceiptId,read,created FROM messages').get(),
  },
  { giftReceiptId: 'old-gift', read: 1, created: 123 },
);
assert.equal(
  upgrade.prepare('SELECT COUNT(*) AS n FROM star_transfers').get().n,
  1,
);
assert.equal(
  upgrade.prepare('SELECT COUNT(*) AS n FROM notifications').get().n,
  0,
);
upgrade.close();
delete globalThis.__giftDb;
console.log(
  'Gifts: SQLite debit/receipt/chat/notification, concurrent idempotency, rollback, private conversation/read state, old-gift migration, permissions, visibility and pagination passed.',
);
