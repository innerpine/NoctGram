import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
const journal = JSON.parse(
  await readFile(root + '/drizzle/meta/_journal.json', 'utf8'),
);
for (const e of journal.entries)
  sqlite.exec(await readFile(root + '/drizzle/' + e.tag + '.sql', 'utf8'));
if (
  !sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE name='gift_upgrades'")
    .get()
)
  sqlite.exec(await readFile(root + '/drizzle/0039_gift_upgrades.sql', 'utf8'));
sqlite.exec(
  "INSERT INTO users(id,name,onboardingComplete,created) VALUES('alice','Alice',1,1),('bob','Bob',1,1),('carol','Carol',1,1)",
);
let failThird = false,
  beforeBatch = null,
  batchTail = Promise.resolve();
function prepare(sql) {
  let args = [];
  return {
    bind(...a) {
      args = a;
      return this;
    },
    async first() {
      return sqlite.prepare(sql).get(...args) || null;
    },
    async run() {
      if (failThird && sql.startsWith('INSERT INTO gift_upgrades')) {
        failThird = false;
        throw Error('injected');
      }
      return { meta: sqlite.prepare(sql).run(...args) };
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...args) };
    },
  };
}
globalThis.reviewDb = {
  prepare,
  batch(stmts) {
    const job = batchTail.then(async () => {
      if (beforeBatch) {
        const h = beforeBatch;
        beforeBatch = null;
        h();
      }
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    });
    batchTail = job.catch(() => {});
    return job;
  },
};
const compiled = await build({
  stdin: {
    contents:
      "export * from './lib/gift-upgrades'; export * from './lib/gifts'; export * from './lib/star-wallet'; export * from './lib/gift-catalog'; export * from './lib/rate-limit';",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'review',
      setup(b) {
        b.onResolve({ filter: /^\.\/(storage|server)$/ }, () => ({
          path: 'storage',
          namespace: 'review',
        }));
        b.onResolve({ filter: /^\.\/auth-session$/ }, () => ({
          path: 'auth',
          namespace: 'review',
        }));
        b.onLoad({ filter: /.*/, namespace: 'review' }, ({ path }) => ({
          contents:
            path === 'auth'
              ? `export const setting=()=> '0';export const tokenHash=async s=>s;`
              : `export const db=()=>globalThis.reviewDb;export {ApiError} from './lib/api-error';export const clean=v=>v;`,
          resolveDir: root,
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
let serial = 0;
function fresh(budget = 1000) {
  sqlite.exec(
    'DELETE FROM account_restrictions;DELETE FROM auth_limits;DELETE FROM gift_upgrades;DELETE FROM gift_collection_sequences;DELETE FROM received_gifts;DELETE FROM star_transfers;',
  );
  sqlite
    .prepare(
      "INSERT INTO star_transfers(id,recipient,amount,kind,created) VALUES('review-grant','bob',?,'grant',1)",
    )
    .run(budget);
}
function receipt() {
  const id = 'review-' + ++serial;
  sqlite
    .prepare(
      "INSERT INTO star_transfers(id,sender,recipient,amount,kind,created) VALUES(?,'alice','noctgram_gifts',25,'gift',1)",
    )
    .run('purchase:' + id);
  sqlite
    .prepare(
      "INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,created) VALUES(?,?,'eternal_rose','alice','bob',1)",
    )
    .run(id, 'purchase:' + id);
  return id;
}
const body = (id) => ({ id, expectedPrice: 25, keepOriginal: true });
const count = (t) => sqlite.prepare('SELECT COUNT(*) n FROM ' + t).get().n;
fresh();
let id = receipt();
let out = await Promise.all(
  Array.from({ length: 8 }, () => api.upgradeGift('bob', body(id))),
);
assert(
  out.every(
    (v) => JSON.stringify(v.collectible) === JSON.stringify(out[0].collectible),
  ),
);
assert.equal(count('gift_upgrades'), 1);
assert.equal(await api.balance('bob'), 975);
assert.equal(
  sqlite.prepare('SELECT lastNumber FROM gift_collection_sequences').get()
    .lastNumber,
  1,
);
console.log('same-receipt concurrency: PASS');
await assert.rejects(
  api.upgradeGift('carol', body(id)),
  (e) => e.status === 404,
);
const again = await api.upgradeGift('bob', {
  id,
  expectedPrice: -1,
  keepOriginal: false,
  model: 'forged',
});
assert.deepEqual(again.collectible, out[0].collectible);
console.log('ownership + immutable retry: PASS');
fresh(25);
const ids = [receipt(), receipt()];
out = await Promise.allSettled(
  ids.map((id) => api.upgradeGift('bob', body(id))),
);
assert.equal(out.filter((v) => v.status === 'fulfilled').length, 1);
assert.equal(count('gift_upgrades'), 1);
assert.equal(await api.balance('bob'), 0);
assert.equal(
  sqlite.prepare('SELECT lastNumber FROM gift_collection_sequences').get()
    .lastNumber,
  1,
);
console.log('competing receipts / insufficient shared balance: PASS');
fresh();
id = receipt();
failThird = true;
await assert.rejects(api.upgradeGift('bob', body(id)), /injected/);
assert.equal(count('gift_upgrades'), 0);
assert.equal(count('gift_collection_sequences'), 0);
assert.equal(await api.balance('bob'), 1000);
await api.upgradeGift('bob', body(id));
assert.equal(await api.balance('bob'), 975);
console.log('third-statement rollback + retry: PASS');
fresh();
id = receipt();
beforeBatch = () => {
  sqlite
    .prepare(
      "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('review-event','bob','alice','read_only','test',1)",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('bob','review-event','read_only','test',1)",
    )
    .run();
};
await assert.rejects(api.upgradeGift('bob', body(id)), (e) => e.status === 403);
assert.equal(count('gift_upgrades'), 0);
assert.equal(await api.balance('bob'), 1000);
console.log('read-only imposed immediately before batch: PASS');
fresh();
id = receipt();
beforeBatch = () =>
  sqlite
    .prepare("UPDATE received_gifts SET recipient='carol' WHERE id=?")
    .run(id);
await assert.rejects(api.upgradeGift('bob', body(id)), (e) => e.status === 403);
assert.equal(count('gift_upgrades'), 0);
assert.equal(await api.balance('bob'), 1000);
console.log('ownership moved immediately before batch: PASS');
fresh();
const many = Array.from({ length: 13 }, receipt);
out = await Promise.allSettled(
  many.map((id) => api.upgradeGift('bob', body(id))),
);
assert.equal(out.filter((v) => v.status === 'fulfilled').length, 12);
assert.equal(
  out.filter((v) => v.status === 'rejected' && v.reason.status === 429).length,
  1,
);
const numbers = sqlite
  .prepare('SELECT number FROM gift_upgrades ORDER BY number')
  .all()
  .map((r) => r.number);
assert.deepEqual(
  numbers,
  Array.from({ length: 12 }, (_, i) => i + 1),
);
assert.equal(await api.balance('bob'), 700);
console.log('rate limit + distinct concurrent numbering: PASS');

fresh();
id = receipt();
await assert.rejects(
  api.upgradeGift('bob', { ...body(id), expectedPrice: 1 }),
  (e) => e.status === 409,
);
await assert.rejects(
  api.upgradeGift('bob', { ...body(id), keepOriginal: 'yes' }),
  (e) => e.status === 400,
);
const unique = await api.upgradeGift('bob', {
  ...body(id),
  keepOriginal: false,
});
const catalog = JSON.parse(
  await readFile(root + '/lib/gift-upgrade-data.json', 'utf8'),
).find((c) => c.id === 'eternal_rose');
for (const [key, rows] of [
  ['model', catalog.models],
  ['backdrop', catalog.backdrops],
  ['symbol', catalog.symbols],
])
  assert.deepEqual(
    rows.find((a) => a.id === unique.collectible[key].id),
    unique.collectible[key],
  );
assert.throws(
  () =>
    sqlite
      .prepare('UPDATE gift_upgrades SET number=99 WHERE receiptId=?')
      .run(id),
  /GIFT_UPGRADE_IMMUTABLE/,
);
let publicPage = await api.listGifts('carol', 'bob');
const publicId = 'collectible:eternal_rose:1';
assert.equal(publicPage.gifts[0].id, publicId);
assert.equal(publicPage.gifts[0].sender, '');
assert.equal(publicPage.gifts[0].message, '');
assert(!('transferId' in publicPage.gifts[0]));
assert.equal(
  (await api.listGifts('carol', 'bob', '', publicId)).gifts.length,
  1,
);
assert.equal((await api.listGifts('bob', 'bob')).gifts[0].id, id);
sqlite.prepare("UPDATE users SET deletedAt=1 WHERE id='alice'").run();
assert.equal((await api.listGifts('bob', 'bob')).gifts.length, 1);
assert.equal((await api.listGifts('carol', 'bob')).gifts.length, 1);
sqlite.prepare("UPDATE users SET deletedAt=0 WHERE id='alice'").run();
sqlite
  .prepare(
    "INSERT INTO user_blocks(blocker,blocked,created) VALUES('carol','alice',1)",
  )
  .run();
assert.equal((await api.listGifts('carol', 'bob')).gifts.length, 1);
sqlite.exec('DELETE FROM user_blocks');
await api.giftVisibility('bob', { id, hidden: true });
assert.equal((await api.listGifts('carol', 'bob')).gifts.length, 0);
assert.equal((await api.listGifts('bob', 'bob')).gifts.length, 1);
console.log(
  'real attribute snapshots, ownership, hidden originals, sender deletion and visibility: PASS',
);
fresh(5000);
for (let i = 0; i < 26; i++) {
  sqlite.exec('DELETE FROM auth_limits');
  await api.upgradeGift('bob', { ...body(receipt()), keepOriginal: false });
}
publicPage = await api.listGifts('carol', 'bob');
assert.equal(publicPage.gifts.length, 24);
assert.match(publicPage.next, /^collectible:eternal_rose:/);
const second = await api.listGifts('carol', 'bob', publicPage.next);
assert.equal(second.gifts.length, 2);
assert.equal(
  new Set([...publicPage.gifts, ...second.gifts].map((g) => g.id)).size,
  26,
);
assert.equal(JSON.stringify(publicPage).includes('purchase:'), false);
fresh();
id = receipt();
sqlite
  .prepare("UPDATE received_gifts SET giftId='chill_flame' WHERE id=?")
  .run(id);
await assert.rejects(api.upgradeGift('bob', body(id)), (e) => e.status === 400);
assert.equal(await api.balance('bob'), 1000);
assert.equal(count('gift_upgrades'), 0);
// Self-gifts spend normal Stars, remain upgradeable, and never create a self-chat.
fresh();
sqlite.exec(
  "INSERT INTO user_privacy(userId,messagePolicy) VALUES('bob','nobody')",
);
for (let i = 0; i < 30; i++) await api.socialRateLimit('bob', 'message');
const selfBody = {
  recipient: 'bob',
  giftId: 'eternal_rose',
  key: 'self-gift-request-0001',
  message: 'Для себя',
};
const price = api.availableGiftDefinition(selfBody.giftId).price;
const selfResults = await Promise.all(
  Array.from({ length: 3 }, () => api.sendGift('bob', selfBody)),
);
assert(selfResults.every((r) => r.id === selfResults[0].id));
assert.equal(await api.balance('bob'), 1000 - price);
assert.equal(count('received_gifts'), 1);
assert.equal(count('messages'), 0);
assert.equal(count('notifications'), 0);
await assert.rejects(
  api.sendGift('bob', { ...selfBody, recipient: 'alice' }),
  (e) => e.status === 409,
);
const selfGift = (await api.listGifts('bob', 'bob')).gifts[0];
assert.equal(selfGift.sender, 'bob');
assert.equal(selfGift.recipient, 'bob');
assert.equal(selfGift.message, 'Для себя');
await api.upgradeGift('bob', { ...body(selfGift.id), keepOriginal: false });
assert.equal(await api.balance('bob'), 1000 - price - 25);
assert((await api.listGifts('bob', 'bob')).gifts[0].collectible);
await api.giftVisibility('bob', { id: selfGift.id, hidden: true });
assert.equal((await api.listGifts('carol', 'bob')).gifts.length, 0);
assert.equal((await api.listGifts('bob', 'bob')).gifts.length, 1);
sqlite.exec(
  "UPDATE user_privacy SET messagePolicy='following' WHERE userId='bob'",
);
await api.sendGift('bob', { ...selfBody, key: 'self-gift-request-0002' });
assert.equal(count('messages'), 0);
assert.equal(count('notifications'), 0);
sqlite.exec(
  "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('self-gift-readonly','bob','alice','read_only','test',1); INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('bob','self-gift-readonly','read_only','test',1)",
);
const beforeDenied = await api.balance('bob');
await assert.rejects(
  api.sendGift('bob', { ...selfBody, key: 'self-gift-request-0003' }),
  (e) => e.status === 403,
);
assert.equal(await api.balance('bob'), beforeDenied);
fresh(0);
await assert.rejects(api.sendGift('bob', selfBody), (e) => e.status === 409);
assert.equal(count('received_gifts'), 0);
assert.equal(count('messages'), 0);
assert.equal(count('notifications'), 0);
assert.equal(await api.balance('bob'), 0);
assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
console.log(
  'self-gifts: one debit, private-message settings/limits independent, no self-chat, restrictions, visibility and upgrade: PASS',
);
sqlite.close();
console.log('public collectible pagination and unavailable family: PASS');
