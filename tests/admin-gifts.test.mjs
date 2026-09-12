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
  journal.entries.map((e) =>
    readFile(root + '/drizzle/' + e.tag + '.sql', 'utf8'),
  ),
);
assert(
  migrations.some(
    (s) => s.includes('gift_admin') && s.includes('CREATE TRIGGER'),
  ),
  '0040 migration is not complete yet',
);
let sqlite,
  beforeBatch = null,
  failUpgradeAt = 0,
  upgradeStatements = 0,
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
      if (
        sql.startsWith('INSERT INTO gift_upgrades') &&
        ++upgradeStatements === failUpgradeAt
      )
        throw Error('injected mid-batch failure');
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
        const hook = beforeBatch;
        beforeBatch = null;
        hook();
      }
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const s of stmts) results.push(await s.run());
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
      "export * from './lib/admin-gifts';export * from './lib/gift-upgrades';export * from './lib/gifts';export * from './lib/star-wallet';export * from './lib/gift-upgrade-catalog';",
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
              ? `export const setting=()=> '1';export const tokenHash=async s=>s;`
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
const family = 'plush_pepe';
const collection = api.upgradeCollection(family);
assert(collection);
function fresh() {
  if (sqlite) sqlite.close();
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const sql of migrations) sqlite.exec(sql);
  sqlite.exec(
    "INSERT INTO users(id,name,kind,onboardingComplete,created) VALUES('adminA','Admin A','person',1,1),('adminB','Admin B','person',1,1),('bob','Bob','person',1,1),('carol','Carol','person',1,1),('mod','Moderator','person',1,1),('channel','Channel','channel',1,1);INSERT INTO administrators(userId,created) VALUES('adminA',1),('adminB',1);INSERT INTO moderators(userId,created) VALUES('mod',1);",
  );
  for (const [who, amount] of [
    ['bob', 1000],
    ['adminA', 333],
    ['adminB', 444],
    ['carol', 222],
  ])
    sqlite
      .prepare(
        "INSERT INTO star_transfers(id,recipient,amount,kind,created) VALUES(?,?,?,'grant',1)",
      )
      .run('seed:' + who, who, amount);
  beforeBatch = null;
  failUpgradeAt = 0;
  upgradeStatements = 0;
  batchTail = Promise.resolve();
}
const body = (extra = {}) => ({
  target: 'bob',
  giftId: family,
  modelId: collection.models[0].id,
  backdropId: collection.backdrops[0].id,
  symbolId: collection.symbols[0].id,
  requestId: crypto.randomUUID(),
  reason: 'Independent review',
  message: 'Review fixture',
  count: 6,
  startNumber: 1,
  keepOriginal: false,
  ...extra,
});
const count = (t) => sqlite.prepare('SELECT COUNT(*) n FROM ' + t).get().n;
const numbers = () =>
  sqlite
    .prepare('SELECT number FROM gift_upgrades WHERE family=? ORDER BY number')
    .all(family)
    .map((r) => r.number);
const sequence = () =>
  sqlite
    .prepare('SELECT lastNumber FROM gift_collection_sequences WHERE family=?')
    .get(family)?.lastNumber || 0;
const snapshot = () =>
  Object.fromEntries(
    [
      'admin_events',
      'star_transfers',
      'received_gifts',
      'gift_upgrades',
      'notifications',
    ]
      .map((t) => [t, count(t)])
      .concat([['sequence', sequence()]]),
  );
const balances = async () =>
  Promise.all(
    ['adminA', 'adminB', 'bob', 'carol', 'noctgram_gifts'].map((u) =>
      api.balance(u),
    ),
  );
const bad = (status) => (e) => e.status === status;
function restriction(who, mode = 'read_only') {
  const id = 'restriction:' + who;
  sqlite
    .prepare(
      "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,'adminB',?,'Review',1)",
    )
    .run(id, who, mode);
  sqlite
    .prepare(
      "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,?,'Review',1)",
    )
    .run(who, id, mode);
}
function ordinaryReceipt() {
  const id = 'ordinary:' + crypto.randomUUID();
  sqlite
    .prepare(
      "INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created) VALUES(?,'carol','noctgram_gifts','{}',25,'gift',1)",
    )
    .run(id);
  sqlite
    .prepare(
      "INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,created) VALUES(?,?,?,'carol','bob',1)",
    )
    .run(id, id, family);
  return id;
}
let passed = 0;
async function probe(label, fn) {
  fresh();
  await fn();
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  passed++;
  console.log('PASS ' + label);
}
await probe(
  'ordinary users and moderators cannot grant or read admin catalog',
  async () => {
    const before = snapshot();
    for (const who of ['bob', 'mod']) {
      await assert.rejects(api.grantCollectibleGifts(who, body()), bad(403));
      await assert.rejects(api.adminGiftCatalog(who, family), bad(403));
    }
    assert.deepEqual(snapshot(), before);
  },
);
await probe(
  'exact six gift grant + real catalog attributes + unchanged balances even test mode',
  async () => {
    const before = await balances();
    const input = body();
    const out = await api.grantCollectibleGifts('adminA', input);
    assert.deepEqual([out.firstNumber, out.lastNumber, out.count], [1, 6, 6]);
    assert.deepEqual(numbers(), [1, 2, 3, 4, 5, 6]);
    assert.equal(sequence(), 6);
    assert.equal(count('admin_events'), 1);
    assert.equal(count('received_gifts'), 6);
    assert.equal(count('messages'), 0);
    assert.equal(count('notifications'), 6);
    assert.deepEqual(await balances(), before);
    for (const row of sqlite
      .prepare('SELECT attributes FROM gift_upgrades')
      .all()) {
      const a = JSON.parse(row.attributes);
      assert.deepEqual(a.model, collection.models[0]);
      assert.deepEqual(a.backdrop, collection.backdrops[0]);
      assert.deepEqual(a.symbol, collection.symbols[0]);
      assert.equal(a.issuance, 'admin');
    }
    const rows = sqlite
      .prepare("SELECT * FROM star_transfers WHERE kind='gift_admin'")
      .all();
    assert.equal(rows.length, 6);
    assert(
      rows.every(
        (t) =>
          t.amount === 0 &&
          t.sender === null &&
          t.recipient === 'noctgram_gifts',
      ),
    );
    const own = await api.listGifts('bob', 'bob');
    assert.equal(own.gifts.length, 6);
    assert(own.gifts.every((g) => g.collectible.issuance === 'admin'));
  },
);
await probe(
  'same request replay + changed payload cannot issue again',
  async () => {
    const input = body({ startNumber: null });
    const a = await api.grantCollectibleGifts('adminA', input);
    const before = snapshot();
    assert.equal(
      (await api.grantCollectibleGifts('adminA', input)).firstNumber,
      a.firstNumber,
    );
    assert.deepEqual(snapshot(), before);
    for (const change of [
      { target: 'carol' },
      { startNumber: 10 },
      { count: 2 },
      { modelId: collection.models[1].id },
      { message: 'changed' },
      { keepOriginal: true },
    ])
      await assert.rejects(
        api.grantCollectibleGifts('adminA', { ...input, ...change }),
        bad(409),
      );
    assert.deepEqual(snapshot(), before);
  },
);
await probe(
  'concurrent identical auto request creates one fixed batch',
  async () => {
    const input = body({ startNumber: null });
    const outs = await Promise.all(
      Array.from({ length: 5 }, () =>
        api.grantCollectibleGifts('adminA', input),
      ),
    );
    assert(outs.every((o) => o.firstNumber === 1 && o.lastNumber === 6));
    assert.deepEqual(numbers(), [1, 2, 3, 4, 5, 6]);
    assert.equal(count('admin_events'), 1);
    assert.equal(count('notifications'), 6);
  },
);
await probe(
  'conflicting concurrent bodies with one request ID cannot issue either changed payload',
  async () => {
    const a = body({ count: 2, startNumber: 1 });
    const b = { ...a, target: 'carol', startNumber: 20 };
    const outs = await Promise.allSettled([
      api.grantCollectibleGifts('adminA', a),
      api.grantCollectibleGifts('adminA', b),
    ]);
    assert.equal(outs.filter((o) => o.status === 'fulfilled').length, 1);
    assert.equal(
      outs.filter((o) => o.status === 'rejected' && o.reason.status === 409)
        .length,
      1,
    );
    assert.equal(count('gift_upgrades'), 2);
    assert.equal(count('admin_events'), 1);
    assert.equal(count('notifications'), 2);
  },
);
await probe('occupied last number aborts entire six-item batch', async () => {
  await api.grantCollectibleGifts('adminA', body({ count: 1, startNumber: 6 }));
  const before = snapshot();
  const balance = await balances();
  await assert.rejects(api.grantCollectibleGifts('adminA', body()), bad(409));
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(await balances(), balance);
  assert.deepEqual(numbers(), [6]);
});
await probe(
  'two admins overlapping ranges serialize without partial issue',
  async () => {
    const outs = await Promise.allSettled([
      api.grantCollectibleGifts('adminA', body()),
      api.grantCollectibleGifts('adminB', body({ startNumber: 4 })),
    ]);
    assert.equal(outs.filter((o) => o.status === 'fulfilled').length, 1);
    assert.equal(
      outs.filter((o) => o.status === 'rejected' && o.reason.status === 409)
        .length,
      1,
    );
    assert.equal(count('admin_events'), 1);
    assert.equal(count('gift_upgrades'), 6);
    assert.equal(count('notifications'), 6);
  },
);
await probe(
  'distinct auto batches and ordinary upgrade share unique sequence',
  async () => {
    const id = ordinaryReceipt();
    const outs = await Promise.all([
      api.grantCollectibleGifts(
        'adminA',
        body({ count: 2, startNumber: null }),
      ),
      api.grantCollectibleGifts(
        'adminB',
        body({ count: 3, startNumber: null }),
      ),
      api.upgradeGift('bob', {
        id,
        expectedPrice: collection.price,
        keepOriginal: true,
      }),
    ]);
    assert.equal(outs.length, 3);
    assert.deepEqual(numbers(), [1, 2, 3, 4, 5, 6]);
    assert.equal(sequence(), 6);
  },
);
await probe(
  'explicit high number advances random allocation; low free hole never decreases it',
  async () => {
    await api.grantCollectibleGifts(
      'adminA',
      body({ count: 1, startNumber: 100 }),
    );
    await api.grantCollectibleGifts(
      'adminA',
      body({ count: 1, startNumber: 5 }),
    );
    assert.equal(sequence(), 100);
    const id = ordinaryReceipt();
    const out = await api.upgradeGift('bob', {
      id,
      expectedPrice: collection.price,
      keepOriginal: true,
    });
    assert.equal(out.collectible.number, 101);
    assert.equal(sequence(), 101);
  },
);
await probe(
  'mid-batch failure rolls back everything then retry succeeds',
  async () => {
    const input = body();
    const before = snapshot();
    failUpgradeAt = 3;
    await assert.rejects(
      api.grantCollectibleGifts('adminA', input),
      /injected/,
    );
    assert.deepEqual(snapshot(), before);
    failUpgradeAt = 0;
    await api.grantCollectibleGifts('adminA', input);
    assert.equal(count('gift_upgrades'), 6);
    assert.equal(sequence(), 6);
  },
);
await probe(
  'admin privilege revoked immediately before commit produces no writes',
  async () => {
    const before = snapshot();
    beforeBatch = () =>
      sqlite.exec("DELETE FROM administrators WHERE userId='adminA'");
    await assert.rejects(api.grantCollectibleGifts('adminA', body()), bad(409));
    assert.deepEqual(snapshot(), before);
  },
);
await probe(
  'read-only restriction imposed immediately before commit produces no writes',
  async () => {
    const before = snapshot();
    beforeBatch = () => restriction('adminA');
    await assert.rejects(api.grantCollectibleGifts('adminA', body()), bad(409));
    assert.deepEqual(snapshot(), before);
  },
);
await probe(
  'recipient deleted immediately before commit produces no writes',
  async () => {
    const before = snapshot();
    beforeBatch = () =>
      sqlite.exec(
        "UPDATE users SET deletedAt=1,onboardingComplete=0 WHERE id='bob'",
      );
    await assert.rejects(api.grantCollectibleGifts('adminA', body()), bad(409));
    assert.deepEqual(snapshot(), before);
  },
);
await probe(
  'channel recipient and out-of-family attributes rejected',
  async () => {
    const before = snapshot();
    await assert.rejects(
      api.grantCollectibleGifts('adminA', body({ target: 'channel' })),
      bad(404),
    );
    await assert.rejects(
      api.grantCollectibleGifts(
        'adminA',
        body({ modelId: 'nonexistent-model' }),
      ),
      bad(400),
    );
    await assert.rejects(
      api.grantCollectibleGifts('adminA', body({ giftId: 'durovs_figurine' })),
      bad(400),
    );
    assert.deepEqual(snapshot(), before);
  },
);
await probe(
  'integer bounds reject invalid ranges without mutation',
  async () => {
    const before = snapshot();
    for (const change of [
      { count: 0 },
      { count: 11 },
      { count: 1.5 },
      { count: '6' },
      { startNumber: 0 },
      { startNumber: -1 },
      { startNumber: 1.5 },
      { startNumber: '1' },
      { startNumber: 999999996 },
      { startNumber: Number.MAX_SAFE_INTEGER },
    ])
      await assert.rejects(
        api.grantCollectibleGifts('adminA', body(change)),
        bad(400),
      );
    assert.deepEqual(snapshot(), before);
  },
);
await probe(
  'database guard rejects altered provenance and event snapshot',
  async () => {
    const cases = [
      [
        'nonzero free provenance',
        () =>
          sqlite.exec(
            "UPDATE star_transfers SET amount=1 WHERE kind='gift_admin'",
          ),
      ],
      [
        'free provenance attributed to user',
        () =>
          sqlite.exec(
            "UPDATE star_transfers SET sender='adminA' WHERE kind='gift_admin'",
          ),
      ],
      [
        'wrong provenance recipient',
        () =>
          sqlite.exec(
            "UPDATE star_transfers SET recipient='bob' WHERE kind='gift_admin'",
          ),
      ],
      [
        'receipt linked to unrelated ledger row',
        () => sqlite.exec("UPDATE received_gifts SET transferId='seed:bob'"),
      ],
      [
        'wrong event action',
        () => sqlite.exec("UPDATE admin_events SET action='stars'"),
      ],
      [
        'wrong event target',
        () => sqlite.exec("UPDATE admin_events SET targetId='carol'"),
      ],
      [
        'non-integer item index',
        () =>
          sqlite.exec(
            "UPDATE star_transfers SET postText=json_set(postText,'$.index',0.5) WHERE kind='gift_admin'",
          ),
      ],
      [
        'wrong model snapshot',
        (row) => {
          const attrs = JSON.parse(row.attributes);
          attrs.model.name = 'Forged';
          row.attributes = JSON.stringify(attrs);
        },
      ],
      ['number outside event range', (row) => (row.number = 7)],
    ];
    for (const [label, tamper] of cases) {
      fresh();
      await api.grantCollectibleGifts('adminA', body({ count: 1 }));
      const row = { ...sqlite.prepare('SELECT * FROM gift_upgrades').get() };
      sqlite.exec('DELETE FROM gift_upgrades');
      tamper(row);
      assert.throws(
        () =>
          sqlite
            .prepare(
              'INSERT INTO gift_upgrades(receiptId,transferId,family,number,attributes,keepOriginal,created) VALUES(?,?,?,?,?,?,?)',
            )
            .run(
              row.receiptId,
              row.transferId,
              row.family,
              row.number,
              row.attributes,
              row.keepOriginal,
              row.created,
            ),
        /INVALID_GIFT_UPGRADE_PAYMENT/,
        label,
      );
      assert.equal(count('gift_upgrades'), 0);
    }
  },
);
await probe(
  'overflowing automatic range aborts without partial issuance',
  async () => {
    sqlite.exec(
      "INSERT INTO gift_collection_sequences(family,lastNumber) VALUES('plush_pepe',9007199254740991)",
    );
    const before = snapshot();
    await assert.rejects(
      api.grantCollectibleGifts(
        'adminA',
        body({ count: 1, startNumber: null }),
      ),
    );
    assert.deepEqual(snapshot(), before);
  },
);
await probe(
  'free grants to administrator self create no notification or chat',
  async () => {
    const before = await balances();
    await api.grantCollectibleGifts(
      'adminA',
      body({ target: 'adminA', count: 1 }),
    );
    assert.equal(count('notifications'), 0);
    assert.equal(count('messages'), 0);
    assert.equal(count('received_gifts'), 1);
    assert.deepEqual(await balances(), before);
  },
);
await probe(
  'same global request ID cannot be replayed by another administrator',
  async () => {
    const input = body({ count: 2, startNumber: null });
    const original = await api.grantCollectibleGifts('adminA', input);
    assert.equal(original.firstNumber, 1);
    const before = snapshot();
    await assert.rejects(api.grantCollectibleGifts('adminB', input), bad(409));
    assert.deepEqual(snapshot(), before);
    assert.equal(
      sqlite.prepare('SELECT actorId FROM admin_events').get().actorId,
      'adminA',
    );
  },
);
await probe(
  'two administrators racing same global request ID produce one issuance and one rejection',
  async () => {
    const input = body({ count: 2, startNumber: null });
    const outs = await Promise.allSettled([
      api.grantCollectibleGifts('adminA', input),
      api.grantCollectibleGifts('adminB', input),
    ]);
    assert.equal(outs.filter((o) => o.status === 'fulfilled').length, 1);
    assert.equal(
      outs.filter((o) => o.status === 'rejected' && o.reason.status === 409)
        .length,
      1,
    );
    assert.deepEqual(numbers(), [1, 2]);
    assert.equal(count('admin_events'), 1);
    assert.equal(count('notifications'), 2);
    assert.equal(sequence(), 2);
  },
);
console.log(`All ${passed} independent admin gift probes passed`);
