/**
 * Noct Market regression probes. The real lib/market.ts, lib/gifts.ts and the
 * journal migrations run against node:sqlite; only storage and auth-session
 * are replaced. Batches are serialized and atomic, like D1.
 *
 *   node tests/market.test.mjs
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
  batchTail = Promise.resolve();
function prepare(sql) {
  let args = [];
  return {
    sql,
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
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          const mutating = /^\s*(INSERT|UPDATE|DELETE)/i.test(statement.sql);
          results.push(
            mutating ? await statement.run() : await statement.all(),
          );
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
      "export * from './lib/market';export * from './lib/market-policy';export * from './lib/gifts';export * from './lib/star-wallet';",
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
      compiled.outputFiles[0].text + '\n//# sourceURL=market-test-bundle.mjs',
    ).toString('base64')
);

const now = Date.UTC(2026, 8, 21, 12);
let serial = 0;
function fresh() {
  if (sqlite) sqlite.close();
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const sql of migrations) sqlite.exec(sql);
  sqlite.exec(
    "INSERT INTO users(id,name,kind,onboardingComplete,created) VALUES('root','Root','person',1,1),('alice','Alice','person',1,1),('bob','Bob','person',1,1),('carol','Carol','person',1,1)",
  );
  sqlite.exec("INSERT INTO administrators(userId,created) VALUES('root',1)");
  for (const user of ['root', 'alice', 'bob', 'carol']) {
    sqlite
      .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
      .run(user + '_main', user);
    sqlite
      .prepare(
        "INSERT INTO star_transfers(id,recipient,amount,kind,created) VALUES(?,?,1000,'grant',1)",
      )
      .run('seed:' + user, user);
  }
  batchTail = Promise.resolve();
}
const model = {
    id: 'black',
    name: 'Black',
    asset: 'collectible-plush_pepe-123456abcdef',
    rarityPermille: 10,
  },
  backdrop = {
    id: 'onyx',
    name: 'Onyx',
    rarityPermille: 20,
    centerColor: '#111111',
    edgeColor: '#000000',
    patternColor: '#333333',
    textColor: '#ffffff',
  },
  symbol = {
    id: 'star',
    name: 'Star',
    asset: 'gift-pattern-123456abcdef',
    rarityPermille: 5,
  };
// A gift Carol sent to `owner`, optionally upgraded to a collectible.
function gift(owner = 'alice', { ordinary = false, hidden = 0 } = {}) {
  const id = 'gift:carol:' + ++serial;
  sqlite
    .prepare(
      "INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created) VALUES(?,'carol','noctgram_gifts',?,250,'gift',1)",
    )
    .run('purchase:' + id, JSON.stringify({ recipient: owner }));
  sqlite
    .prepare(
      "INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,message,hidden,created) VALUES(?,?,'plush_pepe','carol',?,'private message',?,1)",
    )
    .run(id, 'purchase:' + id, owner, hidden);
  if (!ordinary) {
    sqlite
      .prepare(
        "INSERT INTO star_transfers(id,sender,recipient,amount,kind,created,postText) VALUES(?,?,'noctgram_gifts',25,'gift_upgrade',1,?)",
      )
      .run('upgrade:' + id, owner, JSON.stringify({ receiptId: id }));
    sqlite
      .prepare(
        "INSERT INTO gift_upgrades(receiptId,transferId,family,number,attributes,keepOriginal,created) VALUES(?,?,'plush_pepe',?,?,1,1)",
      )
      .run(
        id,
        'upgrade:' + id,
        serial,
        JSON.stringify({ model, backdrop, symbol }),
      );
  }
  return { id, key: 'plush_pepe:' + serial };
}
function restrict(user, mode = 'read_only') {
  const id = 'restriction:' + ++serial;
  sqlite
    .prepare(
      "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,'root',?,'Test',1)",
    )
    .run(id, user, mode);
  sqlite
    .prepare(
      "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,?,'Test',1)",
    )
    .run(user, id, mode);
}
const count = (table, where = '1') =>
  sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n;
const row = (sql, ...args) => sqlite.prepare(sql).get(...args);
const issue = (kind, lots, actor = 'root', requestId = randomUUID()) =>
  api.issueLots(actor, { kind, lots, reason: 'Test issue', requestId }, now);
const listingOf = (kind, assetId) =>
  row(
    "SELECT * FROM market_listings WHERE kind=? AND assetId=? AND status='active'",
    kind,
    assetId,
  );
const buy = (user, listing, price = listing.price) =>
  api.buyLot(user, { listingId: listing.id, expectedPrice: price }, now);
const rejects = (promise, status, code) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.status, status, error.message);
    if (code) assert.equal(error.code, code);
    return true;
  });
let passed = 0;
async function probe(label, run) {
  fresh();
  await run();
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  passed++;
  console.log('PASS ' + label);
}

await probe('policy: 5% whole-Star fee and the +888 format', () => {
  assert.equal(api.MARKET_FEE_PERCENT, 5);
  for (const [price, fee] of [
    [1, 0],
    [19, 0],
    [20, 1],
    [99, 4],
    [100, 5],
    [10_000_000, 500_000],
  ])
    assert.equal(api.marketFee(price), fee);
  for (const bad of [0, -5, 1.5, NaN, '100'])
    assert.equal(api.marketFee(bad), 0);
  assert.equal(api.formatMarketNumber('12345678'), '+888 1234 5678');
});

await probe(
  'admin issues numbers; a buyer pays the treasury in full',
  async () => {
    const requestId = randomUUID();
    const issued = await issue(
      'number',
      '+888 1234 5678 500\n77777777 400',
      'root',
      requestId,
    );
    assert.deepEqual(issued.created.sort(), ['12345678', '77777777']);
    assert.deepEqual(issued.skipped, []);
    // The same request is a replay; a different body under the same id is refused.
    assert.deepEqual(
      (
        await issue(
          'number',
          '+888 1234 5678 500\n77777777 400',
          'root',
          requestId,
        )
      ).created.length,
      2,
    );
    await rejects(issue('number', '11111111 5', 'root', requestId), 409);
    assert.equal(count('market_listings'), 2);
    assert.equal(count('admin_events', "action='marketIssue'"), 1);
    await rejects(issue('number', '22222222 5', 'alice'), 403);

    const lot = listingOf('number', '12345678');
    await rejects(buy('alice', lot, 499), 409);
    const result = await buy('alice', lot);
    assert.equal(result.balance, 500);
    assert.deepEqual(
      {
        ...row(
          'SELECT sender,recipient,amount,kind,postText FROM star_transfers WHERE id=?',
          'market:' + lot.id,
        ),
      },
      {
        sender: 'alice',
        recipient: 'noctgram_gifts',
        amount: 500,
        kind: 'market_sale',
        postText: '+888 1234 5678',
      },
    );
    assert.equal(count('star_transfers', "kind='market_fee'"), 0);
    // A system lot has no seller to notify.
    assert.equal(count('notifications', "kind='market'"), 0);
    assert.deepEqual(
      {
        ...row(
          "SELECT ownerId,displayed FROM market_numbers WHERE number='12345678'",
        ),
      },
      { ownerId: 'alice', displayed: 1 },
    );
    const sold = row(
      'SELECT status,buyerId,fee,closed FROM market_listings WHERE id=?',
      lot.id,
    );
    assert.deepEqual(
      { ...sold },
      { status: 'sold', buyerId: 'alice', fee: 0, closed: now },
    );
    // A retry of a committed purchase charges nothing.
    assert.equal((await buy('alice', lot)).balance, 500);
    assert.equal(count('star_transfers', "kind='market_sale'"), 1);
    // Only the first number is shown in the profile automatically.
    await buy('alice', listingOf('number', '77777777'));
    assert.equal(
      row("SELECT displayed FROM market_numbers WHERE number='77777777'")
        .displayed,
      0,
    );
    await api.displayNumber('alice', { number: '77777777' });
    assert.equal(count('market_numbers', "ownerId='alice' AND displayed=1"), 1);
    assert.equal(
      row("SELECT displayed FROM market_numbers WHERE number='77777777'")
        .displayed,
      1,
    );
    await rejects(api.displayNumber('bob', { number: '77777777' }), 404);
    await api.displayNumber('alice', { number: null });
    assert.equal(count('market_numbers', 'displayed=1'), 0);
  },
);

await probe('issue validation: formats, duplicates, taken names', async () => {
  for (const lots of [
    '1234567 5',
    'abc 5',
    'noctgram 5',
    'lunar',
    'lunar 0',
    'a\n'.repeat(60),
  ])
    await rejects(
      issue(lots.startsWith('1') ? 'number' : 'username', lots),
      400,
    );
  await rejects(issue('username', 'lunar 5\n@LUNAR 6'), 400);
  await rejects(issue('gift', 'lunar 5'), 400);
  const issued = await issue('username', 'lunar 300\nalice_main 5');
  assert.deepEqual(issued.created, ['lunar']);
  assert.deepEqual(issued.skipped, ['alice_main']);
  assert.equal(count('admin_events'), 1);
  assert.equal(count('market_listings'), 1);
});

await probe(
  're-issuing a system lot sets its price; owned numbers are untouched',
  async () => {
    await issue('number', '12345678 500\n22222222 100');
    await buy('alice', listingOf('number', '22222222'));
    const stale = listingOf('number', '12345678');
    const result = await issue('number', '12345678 700\n22222222 50');
    assert.deepEqual(result.created, []);
    assert.deepEqual(result.repriced, ['12345678']);
    assert.deepEqual(result.skipped, ['22222222']);
    assert.equal(count('market_listings', "status='active'"), 1);
    assert.equal(listingOf('number', '12345678').id, stale.id);
    assert.equal(listingOf('number', '12345678').price, 700);
    assert.equal(
      row("SELECT ownerId FROM market_numbers WHERE number='22222222'").ownerId,
      'alice',
    );
    // Whoever still sees the old price is refused; the new price sells.
    await rejects(buy('bob', stale), 409);
    await buy('bob', listingOf('number', '12345678'));
    assert.equal(await api.balance('bob'), 300);
    const same = await issue('number', '12345678 700');
    assert.deepEqual(
      [same.created, same.repriced, same.skipped],
      [[], [], ['12345678']],
    );
    await rejects(issue('number', '12345678 1', 'alice'), 403);
  },
);

await probe('insufficient Stars: a coded refusal and no rows', async () => {
  await issue('number', '12345678 5000');
  const lot = listingOf('number', '12345678');
  await rejects(buy('bob', lot), 409, 'INSUFFICIENT_STARS');
  assert.equal(count('star_transfers', "kind LIKE 'market%'"), 0);
  assert.equal(listingOf('number', '12345678').id, lot.id);
  assert.equal(
    row("SELECT ownerId FROM market_numbers WHERE number='12345678'").ownerId,
    null,
  );
});

await probe('two simultaneous buyers: exactly one purchase', async () => {
  await issue('number', '12345678 600');
  const lot = listingOf('number', '12345678');
  const results = await Promise.allSettled([
    buy('alice', lot),
    buy('bob', lot),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [
    'fulfilled',
    'rejected',
  ]);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
  assert.equal(count('star_transfers', "kind='market_sale'"), 1);
  const winner = row(
    'SELECT buyerId FROM market_listings WHERE id=?',
    lot.id,
  ).buyerId;
  assert.equal(
    row("SELECT ownerId FROM market_numbers WHERE number='12345678'").ownerId,
    winner,
  );
  assert.equal(await api.balance(winner), 400);
  assert.equal(await api.balance(winner === 'alice' ? 'bob' : 'alice'), 1000);
});

await probe(
  'gift resale: 95% to the seller, 5% to the treasury, provenance stays private',
  async () => {
    const owned = gift('alice');
    const before = await api.balance('alice');
    const { listingId } = await api.listAsset(
      'alice',
      { kind: 'gift', key: owned.key, price: 200 },
      now,
    );
    await rejects(
      api.listAsset('alice', { kind: 'gift', key: owned.key, price: 300 }, now),
      409,
    );
    await rejects(
      api.buyLot('alice', { listingId, expectedPrice: 200 }, now),
      400,
    );
    await buy('bob', { id: listingId, price: 200 });
    assert.equal(await api.balance('alice'), before + 190);
    assert.equal(await api.balance('bob'), 800);
    assert.deepEqual(
      {
        ...row(
          'SELECT sender,recipient,amount FROM star_transfers WHERE id=?',
          'market-fee:' + listingId,
        ),
      },
      { sender: 'bob', recipient: 'noctgram_gifts', amount: 10 },
    );
    assert.deepEqual(
      {
        ...row(
          'SELECT recipient,sender,message,hidden FROM received_gifts WHERE id=?',
          owned.id,
        ),
      },
      {
        recipient: 'bob',
        sender: 'bob',
        message: 'Куплен в Маркете',
        hidden: 0,
      },
    );
    assert.equal(
      row('SELECT fee FROM market_listings WHERE id=?', listingId).fee,
      10,
    );
    // The seller is told who bought the lot.
    assert.deepEqual(
      {
        ...row(
          "SELECT userId,actorId,targetId FROM notifications WHERE kind='market'",
        ),
      },
      { userId: 'alice', actorId: 'bob', targetId: listingId },
    );
    // Known limit: the owner-only receipt id still embeds the first sender's id.
    const [shown] = (await api.listGifts('bob', 'bob')).gifts;
    assert.deepEqual(
      [shown.sender, shown.senderName, shown.senderHandle, shown.message],
      ['bob', 'Bob', 'bob_main', 'Куплен в Маркете'],
    );
    assert.equal((await api.listGifts('alice', 'alice')).gifts.length, 0);
    // The public lot never exposes the receipt id, which embeds the original sender.
    const lot = await api.lot(
      'carol',
      new URLSearchParams({ kind: 'gift', key: owned.key }),
    );
    assert(!JSON.stringify(lot).includes(owned.id));
    assert.equal(lot.owner.id, 'bob');
    assert.equal(lot.history.length, 1);
    assert.equal(lot.history[0].seller.id, 'alice');
  },
);

await probe('only the owner can list, and only sellable assets', async () => {
  await issue('number', '12345678 10');
  await buy('alice', listingOf('number', '12345678'));
  const plain = gift('alice', { ordinary: true });
  const mine = gift('alice');
  for (const [user, body] of [
    ['bob', { kind: 'number', key: '12345678', price: 5 }],
    ['alice', { kind: 'username', key: 'alice_main', price: 5 }],
    ['bob', { kind: 'gift', key: mine.key, price: 5 }],
    ['alice', { kind: 'gift', key: 'plush_pepe:999', price: 5 }],
  ])
    await rejects(api.listAsset(user, body, now), 409);
  assert.equal(
    count('gift_upgrades', 'receiptId=?'.replace('?', `'${plain.id}'`)),
    0,
  );
  for (const price of [0, -1, 1.5, '5', 10_000_001])
    await rejects(
      api.listAsset('alice', { kind: 'gift', key: mine.key, price }, now),
      400,
    );
  assert.equal(count('market_listings', "status='active'"), 0);
  // Cancelling is the seller's (or, for system lots, an administrator's) right.
  const { listingId } = await api.listAsset(
    'alice',
    { kind: 'number', key: '12345678', price: 50 },
    now,
  );
  await rejects(api.cancelLot('bob', { listingId }, now), 409);
  await api.cancelLot('alice', { listingId }, now);
  await rejects(buy('bob', { id: listingId, price: 50 }), 409);
  await issue('number', '22222222 10');
  const system = listingOf('number', '22222222');
  await rejects(api.cancelLot('alice', { listingId: system.id }, now), 409);
  await api.cancelLot('root', { listingId: system.id }, now);
  // A withdrawn system number can be issued again.
  assert.deepEqual((await issue('number', '22222222 20')).created, [
    '22222222',
  ]);
});

await probe('a restricted account can neither list nor buy', async () => {
  await issue('number', '12345678 10\n22222222 10');
  await buy('alice', listingOf('number', '12345678'));
  restrict('alice');
  await rejects(
    api.listAsset('alice', { kind: 'number', key: '12345678', price: 5 }, now),
    409,
  );
  const before = count('star_transfers');
  await rejects(buy('alice', listingOf('number', '22222222')), 403);
  assert.equal(count('star_transfers'), before);
  assert(listingOf('number', '22222222'));
});

await probe(
  'username resale follows the handle; a stale listing cannot be bought',
  async () => {
    sqlite.exec(
      "INSERT INTO handles(handle,userId,main) VALUES('alice_two','alice',0),('alice_three','alice',0)",
    );
    const first = await api.listAsset(
      'alice',
      { kind: 'username', key: 'alice_two', price: 100 },
      now,
    );
    await buy('bob', { id: first.listingId, price: 100 });
    assert.deepEqual(
      { ...row("SELECT userId,main FROM handles WHERE handle='alice_two'") },
      { userId: 'bob', main: 0 },
    );
    // The seller promotes a listed name to main: the listing must die, not sell.
    const second = await api.listAsset(
      'alice',
      { kind: 'username', key: 'alice_three', price: 100 },
      now,
    );
    sqlite.exec(
      "UPDATE handles SET main=CASE WHEN handle='alice_three' THEN 1 ELSE 0 END WHERE userId='alice'",
    );
    const hidden = await api.catalog(
      new URLSearchParams({ kind: 'username', status: 'sale' }),
    );
    assert.equal(hidden.rows.length, 0);
    const before = await api.balance('bob');
    await rejects(buy('bob', { id: second.listingId, price: 100 }), 403);
    assert.equal(await api.balance('bob'), before);
    assert.equal(
      row('SELECT status FROM market_listings WHERE id=?', second.listingId)
        .status,
      'cancelled',
    );
  },
);

await probe(
  'a system username is reserved for its buyer and respects the five-name cap',
  async () => {
    await issue('username', 'lunar 300\nsolar 100');
    assert.throws(
      () =>
        sqlite.exec(
          "INSERT INTO handles(handle,userId,main) VALUES('lunar','bob',0)",
        ),
      /HANDLE_RESERVED/,
    );
    const lot = listingOf('username', 'lunar');
    await buy('bob', lot);
    assert.equal(
      row("SELECT userId FROM handles WHERE handle='lunar'").userId,
      'bob',
    );
    // Replaying the purchase after the owner dropped the name must not re-create it.
    sqlite.exec("DELETE FROM handles WHERE handle='lunar'");
    await buy('bob', lot);
    assert.equal(count('handles', "handle='lunar'"), 0);
    for (const name of ['c_two', 'c_three', 'c_four', 'c_five'])
      sqlite
        .prepare("INSERT INTO handles(handle,userId,main) VALUES(?,'carol',0)")
        .run(name);
    const before = await api.balance('carol');
    await rejects(buy('carol', listingOf('username', 'solar')), 409);
    assert.equal(await api.balance('carol'), before);
    assert(listingOf('username', 'solar'));
  },
);

await probe(
  'reads: showcase, privacy of hidden assets, my assets',
  async () => {
    const open = gift('alice'),
      secret = gift('alice', { hidden: 1 });
    gift('bob', { ordinary: true });
    await issue('number', '12345678 10');
    let shop = await api.catalog(new URLSearchParams({ kind: 'gift' }));
    assert.deepEqual(
      shop.rows.map((r) => [r.key, r.status]),
      [[open.key, 'idle']],
    );
    assert.deepEqual(shop.families, [
      { id: 'plush_pepe', name: shop.families[0].name, count: 1 },
    ]);
    await rejects(
      api.lot('bob', new URLSearchParams({ kind: 'gift', key: secret.key })),
      404,
    );
    assert.equal(
      (
        await api.lot(
          'alice',
          new URLSearchParams({ kind: 'gift', key: secret.key }),
        )
      ).mine,
      true,
    );
    await api.listAsset(
      'alice',
      { kind: 'gift', key: secret.key, price: 70 },
      now,
    );
    shop = await api.catalog(
      new URLSearchParams({
        kind: 'gift',
        status: 'sale',
        family: 'plush_pepe',
        model: 'black',
        sort: 'priceAsc',
      }),
    );
    assert.deepEqual(
      shop.rows.map((r) => [r.key, r.price]),
      [[secret.key, 70]],
    );
    assert.deepEqual(shop.attributes.model, [
      { id: 'black', name: 'Black', rarityPermille: 10, count: 1 },
    ]);
    assert.deepEqual(shop.counts, { number: 1, username: 0, gift: 1 });
    assert.equal(
      (
        await api.catalog(
          new URLSearchParams({
            kind: 'gift',
            model: 'missing',
            family: 'plush_pepe',
          }),
        )
      ).rows.length,
      0,
    );
    const numbers = await api.catalog(
      new URLSearchParams({ kind: 'number', q: '+888 1234' }),
    );
    assert.deepEqual(
      numbers.rows.map((r) => [r.title, r.status, r.price]),
      [['+888 1234 5678', 'sale', 10]],
    );
    // An undisplayed number does not reveal its owner.
    await buy('bob', listingOf('number', '12345678'));
    await api.displayNumber('bob', { number: null });
    assert.equal(
      (
        await api.lot(
          'carol',
          new URLSearchParams({ kind: 'number', key: '12345678' }),
        )
      ).owner,
      null,
    );
    const mine = await api.assets('alice');
    assert.deepEqual(
      mine.assets.map((a) => [
        a.kind,
        a.key,
        a.main ?? null,
        a.listing?.price ?? null,
      ]),
      [
        ['username', 'alice_main', true, null],
        ['gift', open.key, null, null],
        ['gift', secret.key, null, 70],
      ],
    );
  },
);

sqlite.close();
console.log(`All ${passed} Noct Market probes passed`);
