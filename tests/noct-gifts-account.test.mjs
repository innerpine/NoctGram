// Isolated SQLite and synthetic Telegram signatures; no external requests or live data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const token = '111111:' + 'a'.repeat(35);
globalThis.__noctGiftsSettings = {
  NOCT_GIFTS_BOT_TOKEN: token,
  NOCT_BOT_USERNAME: 'noct_test_bot',
  NOCT_BOT_SECRET: 's'.repeat(40),
  NOCT_STARS_TEST_MODE: '1',
};
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for (const { tag } of JSON.parse(
  await readFile(
    new URL('../drizzle/meta/_journal.json', import.meta.url),
    'utf8',
  ),
).entries)
  sqlite.exec(
    await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8'),
  );
let afterRead = () => {};
const avatarObjects = new Map();
const avatarReads = [];
let afterAvatarRead = () => {};
globalThis.__noctGiftsBucket = {async get(key) {
  avatarReads.push(key);afterAvatarRead();
  const body=avatarObjects.get(key);
  return body ? {body, size:body.length} : null;
}};
let databaseQueue = Promise.resolve();
globalThis.__noctGiftsDb = {
  prepare(query) {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      async first() {
        const row = sqlite.prepare(query).get(...args) || null;
        afterRead(query);
        return row;
      },
      async all() {
        const results = sqlite.prepare(query).all(...args);
        afterRead(query);
        return { results };
      },
      async run() {
        return {
          meta: { changes: Number(sqlite.prepare(query).run(...args).changes) },
        };
      },
    };
  },
  async batch(statements) {
    const operation = databaseQueue.then(async () => {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const s of statements) results.push(await s.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
    });
    databaseQueue = operation.catch(() => {});
    return operation;
  },
};
const built = await build({
  stdin: {
    contents:
      "export * from './lib/noct-gifts-auth'; export * from './lib/noct-gifts-account'; export * from './lib/noct-gifts-games'; export { POST as avatarPost } from './app/api/noct-gifts/avatar/route'; export { previewGiftUpgrade, upgradeGift } from './lib/gift-upgrades'; export { previewGiftConversion } from './lib/gift-conversions'; export { POST as casePost } from './app/api/noct-gifts/case/route'; export { POST as upgradePost } from './app/api/noct-gifts/upgrade/route'; export { POST as accountPost } from './app/api/noct-gifts/account/route'; export { POST as topupPost } from './app/api/noct-gifts/topup/route';",
    resolveDir: root,
  },
  platform: 'node',
  format: 'esm',
  bundle: true,
  write: false,
  plugins: [
    {
      name: 'noct-gifts-fixture',
      setup(b) {
        b.onResolve({ filter: /^\.\/auth-session$/ }, () => ({
          path: 'auth-session',
          namespace: 'gifts-auth-fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'gifts-auth-fixture' }, () => ({
          contents:
            "export const setting=name=>globalThis.__noctGiftsSettings[name]||''; export async function tokenHash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('') }",
        }));
        b.onResolve({ filter: /^\.\/(storage|server)$/ }, (a) => ({
          path: a.path,
          namespace: 'gifts-db-fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'gifts-db-fixture' }, () => ({
          contents:
            "export const db=()=>globalThis.__noctGiftsDb; export const bucket=()=>globalThis.__noctGiftsBucket; export { ApiError } from './lib/api-error'; export const clean=value=>value;",
          resolveDir: root,
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(built.outputFiles[0].text).toString('base64')
);
const signed = (id = 111, patch = {}, signingToken = token) => {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Telegram name' }),
    query_id: 'AA-test',
    ...patch,
  });
  p.sort();
  const check = Array.from(p, ([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData')
    .update(signingToken)
    .digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
};
function reset() {
  afterRead = () => {};
  afterAvatarRead = () => {};
  avatarObjects.clear();avatarReads.length=0;
  for (const table of [
    'payment_receipts',
    'payment_orders',
    'gift_upgrades',
    'gift_conversions',
    'gift_consumptions',
    'received_gifts',
    'star_transfers',
    'telegram_links',
    'account_restrictions',
    'auth_limits',
  ])
    sqlite.exec(`DELETE FROM ${table}`);
  sqlite.exec(
    "INSERT OR IGNORE INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('giver','Giver',1)",
  );
  sqlite.exec(
    "UPDATE users SET avatar='',deletedAt=0,onboardingComplete=1,kind='person',sessionsRevokedAt=0 WHERE id IN ('alice','bob','giver')",
  );
  sqlite.exec(
    "INSERT OR IGNORE INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('event','alice','giver','blocked','test',1)",
  );
  sqlite.exec(
    "INSERT INTO telegram_links(id,userId,telegramId,telegramName,telegramUsername,created) VALUES('link-a','alice','111','Alice TG','alice_tg',1),('link-b','bob','222','Bob TG','bob_tg',1)",
  );
  sqlite.exec(
    "INSERT INTO star_transfers(id,recipient,amount,kind,created) VALUES('alice-credit','alice',500,'purchase',1),('bob-credit','bob',900,'purchase',2)",
  );
  globalThis.__noctGiftsSettings.NOCT_GIFTS_BOT_TOKEN = token;
}
function gift(id, owner, hidden = 0, family = 'toy_bear') {
  sqlite
    .prepare(
      "INSERT INTO star_transfers(id,sender,recipient,amount,kind,created) VALUES(?, 'giver', 'noctgram_gifts',25,'gift',?)",
    )
    .run('transfer-' + id, 10 + id);
  sqlite
    .prepare(
      'INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,hidden,created) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      'gift-' + id,
      'transfer-' + id,
      family,
      'giver',
      owner,
      hidden,
      10 + id,
    );
}
const account = (id = 111, extra = {}) =>
  api.noctGiftsAccount({ initData: signed(id), ...extra }, 'https://noct.test');

const play = (kind, extra = {}, telegramId = 111) => api.noctGiftsGame(kind, {
  initData:signed(telegramId),version:'2026-09-15-1',key:'test-game-request-0001',
  ...(kind==='case'?{caseId:'eclipse'}:{receiptId:'gift-1',targetGiftId:'swiss_watch'}),...extra,
}, 'https://noct.test');
const count = table => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

function profileImage(owner='alice') {
  const id='avatar-'+owner;
  sqlite.prepare("INSERT OR REPLACE INTO uploads(id,userId,type,name,created,state) VALUES(?,?,'image/png','avatar.png',1,'ready')").run(id,owner);
  sqlite.prepare("UPDATE users SET avatar=? WHERE id=?").run('/api/media/'+id,owner);
  avatarObjects.set(id,Buffer.from('original-'+owner));
  return id;
}
const avatarRequest = (body={initData:signed()},headers={}) => api.avatarPost(request('/api/noct-gifts/avatar',body,headers));
void test('Telegram avatar returns the current NoctGram thumbnail privately without website cookies',async()=>{
  reset();const id=profileImage();avatarObjects.set('avatars/v1/'+id+'/384.webp',Buffer.from('thumbnail'));
  const result=await avatarRequest();assert.equal(result.status,200);
  assert.equal(result.headers.get('content-type'),'image/webp');
  assert.equal(result.headers.get('cache-control'),'private, no-store');
  assert.equal(result.headers.get('x-content-type-options'),'nosniff');
  assert.equal(await result.text(),'thumbnail');
  assert.deepEqual(avatarReads,['avatars/v1/'+id+'/384.webp']);
  assert.equal((await account()).balance,500);
});
void test('legacy avatars fall back to their original image; missing files are not served',async()=>{
  reset();profileImage();let result=await avatarRequest();
  assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/png');
  assert.equal(await result.text(),'original-alice');
  avatarObjects.clear();result=await avatarRequest();assert.equal(result.status,404);
});
void test('avatar requires signed Telegram identity and rejects arbitrary media and foreign origins',async()=>{
  reset();profileImage();
  for(const [body,headers,status] of [
    [{initData:''},{},401],
    [{initData:signed(333)},{},409],
    [{initData:signed(),id:'avatar-bob'},{},400],
    [{initData:signed()},{Origin:'https://foreign.test'},403],
  ]){
    const result=await avatarRequest(body,headers);assert.equal(result.status,status);
    assert.equal(result.headers.get('cache-control'),'private, no-store');
  }
  assert.deepEqual(avatarReads,[]);
});
void test('avatar cannot expose another owner image, unready upload or non-image',async()=>{
  reset();profileImage('bob');sqlite.exec("UPDATE users SET avatar='/api/media/avatar-bob' WHERE id='alice'");
  assert.equal((await avatarRequest()).status,404);
  profileImage();sqlite.exec("UPDATE uploads SET state='pending' WHERE id='avatar-alice'");
  assert.equal((await avatarRequest()).status,404);
  sqlite.exec("UPDATE uploads SET state='ready',type='text/html' WHERE id='avatar-alice'");
  assert.equal((await avatarRequest()).status,404);
  assert.deepEqual(avatarReads,[]);
});
void test('avatar is withheld if the Telegram link is removed during the storage read',async()=>{
  reset();profileImage();afterAvatarRead=()=>sqlite.exec("DELETE FROM telegram_links WHERE userId='alice'");
  const result=await avatarRequest();assert.equal(result.status,401);
  assert.equal((await result.json()).code,'TELEGRAM_LINK_CHANGED');
});

void test('case debit and canonical receipt are immediate, idempotent and visible in the NoctGram profile', async t => {
  reset(); t.mock.method(globalThis.crypto,'getRandomValues', bytes=>{bytes.fill(0);return bytes;});
  const first=await play('case');
  assert.equal(first.balance,180);
  assert.equal(first.gift.giftId,'crystal_ball');
  assert.equal(first.gift.collectible,null);
  assert.equal(first.gift.available,true);
  assert.ok((await account()).gifts.some(g=>g.id===first.gift.id));
  const replay=await play('case');
  assert.deepEqual(replay,first);
  assert.equal(count('received_gifts'),1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM star_transfers WHERE kind='case_open'").get().n,1);
  assert.equal((await api.previewGiftConversion('alice',first.gift.id)).available,false);
  await assert.rejects(play('case',{caseId:'moon'}),e=>e.code==='GAME_KEY_CONFLICT');
  await assert.rejects(play('upgrade'),e=>e.code==='GAME_KEY_CONFLICT');
});

void test('case rejects insufficient funds, changed catalog, bad identity and readonly accounts without minting', async () => {
  reset();
  await assert.rejects(play('case',{version:'wrong'}),e=>e.code==='GAME_CATALOG_CHANGED');
  await assert.rejects(play('case',{initData:signed().replace('111','999')}),e=>e.status===401);
  await assert.rejects(play('case',{},333),e=>e.code==='TELEGRAM_NOT_LINKED');
  sqlite.exec("UPDATE star_transfers SET amount=1 WHERE id='alice-credit'");
  await assert.rejects(play('case'),e=>e.code==='INSUFFICIENT_STARS');
  assert.equal(count('received_gifts'),0);
  reset();
  sqlite.exec("INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('alice','event','readonly','test',1)");
  await assert.rejects(play('case'),e=>e.code==='GAME_NOT_AVAILABLE');
  assert.equal(count('received_gifts'),0);
});

void test('write-time link check rejects an unlink between authentication and debit', async () => {
  reset();
  afterRead=query=>{if(query.includes("SELECT postText FROM star_transfers")){sqlite.exec("DELETE FROM telegram_links WHERE userId='alice'");afterRead=()=>{};}};
  await assert.rejects(play('case'),e=>e.code==='GAME_NOT_AVAILABLE');
  assert.equal(count('received_gifts'),0);
  assert.equal(sqlite.prepare("SELECT amount FROM star_transfers WHERE id='alice-credit'").get().amount,500);
});

void test('case receipt failure rolls the debit back and same-key retry can complete safely', async () => {
  reset();
  sqlite.exec("CREATE TEMP TRIGGER fail_game_receipt BEFORE INSERT ON received_gifts BEGIN SELECT RAISE(ABORT,'simulated failure'); END");
  try { await assert.rejects(play('case')); } finally {sqlite.exec('DROP TRIGGER fail_game_receipt');}
  assert.equal(count('star_transfers'),2);
  assert.equal(count('received_gifts'),0);
  assert.equal((await play('case')).balance,180);
});

for(const [ticket,success] of [[0,true],[9999,false]]) void test(`risk upgrade ${success?'success':'failure'} consumes the source once and preserves authoritative result`, async t=>{
  reset(); gift(1,'alice');
  t.mock.method(globalThis.crypto,'getRandomValues',bytes=>{bytes.fill(ticket);return bytes;});
  const result=await play('upgrade');
  assert.equal(result.operation.success,success);
  // Current catalog: a 75-Star bear toward a 450-Star watch.
  assert.equal(result.operation.chance,15);
  assert.equal(result.operation.price,158);
  assert.equal(result.balance,342);
  assert.equal(count('gift_consumptions'),1);
  assert.equal(count('received_gifts'),success?2:1);
  assert.deepEqual((await play('upgrade')).operation,result.operation);
  await assert.rejects(play('upgrade',{key:'other-game-request-0002'}),e=>e.code==='GIFT_NOT_AVAILABLE');
  await assert.rejects(api.previewGiftUpgrade('alice','gift-1'),e=>e.status===404);
  await assert.rejects(api.previewGiftConversion('alice','gift-1'),e=>e.status===404);
  const profile=await account();
  assert.equal(profile.gifts.some(g=>g.id==='gift-1'),false);
  assert.equal(profile.gifts.length,success?1:0);
});

void test('upgrade cannot spend another user gift, a converted gift or a collectible', async t=>{
  reset();gift(1,'bob');
  await assert.rejects(play('upgrade'),e=>e.code==='GIFT_NOT_AVAILABLE');
  assert.equal(count('gift_consumptions'),0);
  assert.equal(count('star_transfers'),3);
  reset();gift(1,'alice');
  sqlite.exec(`INSERT INTO star_transfers(id,sender,recipient,amount,kind,postText,created) VALUES('gift-conversion:gift-1','noctgram_gifts','alice',21,'gift_conversion','{"receiptId":"gift-1"}',100)`);
  sqlite.exec("INSERT INTO gift_conversions VALUES('gift-1','gift-conversion:gift-1',21,100)");
  await assert.rejects(play('upgrade'),e=>e.code==='GIFT_NOT_AVAILABLE');

  reset(); gift(1,'alice');
  const previousTestMode = globalThis.__noctGiftsSettings.NOCT_STARS_TEST_MODE;
  globalThis.__noctGiftsSettings.NOCT_STARS_TEST_MODE = '0';
  t.after(() => { globalThis.__noctGiftsSettings.NOCT_STARS_TEST_MODE = previousTestMode; });
  const upgraded = await api.upgradeGift('alice', {
    id:'gift-1', expectedPrice:25, keepOriginal:true,
  });
  assert.ok(upgraded.collectible);
  const transfersBeforeAttempt = count('star_transfers');
  await assert.rejects(play('upgrade'),e=>e.code==='GIFT_NOT_AVAILABLE');
  assert.equal(count('star_transfers'),transfersBeforeAttempt);
  assert.equal(count('gift_consumptions'),0);
  assert.equal(count('received_gifts'),1);
  const retained = (await account()).gifts.find(g=>g.id==='gift-1');
  assert.deepEqual(retained.collectible,upgraded.collectible);
  assert.equal((await account()).balance,475);
});

void test('case replay preserves a subsequent collectible upgrade and its canonical model artwork', async t=>{
  reset();
  t.mock.method(globalThis.crypto,'getRandomValues',bytes=>{bytes.fill(0);return bytes;});
  const previousTestMode = globalThis.__noctGiftsSettings.NOCT_STARS_TEST_MODE;
  globalThis.__noctGiftsSettings.NOCT_STARS_TEST_MODE = '0';
  t.after(() => { globalThis.__noctGiftsSettings.NOCT_STARS_TEST_MODE = previousTestMode; });
  const first = await play('case',{caseId:'moon'});
  assert.equal(first.gift.giftId,'ion_gem');
  assert.equal(first.gift.collectible,null);
  const upgraded = await api.upgradeGift('alice', {
    id:first.gift.id, expectedPrice:25, keepOriginal:true,
  });
  assert.ok(upgraded.collectible);
  const replay = await play('case',{caseId:'moon'});
  const profileGift = (await account()).gifts.find(g=>g.id===first.gift.id);
  assert.deepEqual(replay.operation,first.operation);
  assert.equal(replay.gift.id,first.gift.id);
  assert.equal(replay.gift.available,true);
  assert.deepEqual(replay.gift.collectible,upgraded.collectible);
  assert.deepEqual(replay.gift.collectible,profileGift.collectible);
  assert.match(upgraded.collectible.model.asset,/^collectible-ion_gem-[a-f0-9]{12}$/);
  assert.equal(replay.gift.imageUrl,`https://noct.test/assets/gifts/${upgraded.collectible.model.asset}.webp`);
  assert.equal(replay.gift.animationUrl,`https://noct.test/assets/gifts/${upgraded.collectible.model.asset}.tgs`);
  assert.equal(replay.gift.imageUrl,profileGift.imageUrl);
  assert.equal(replay.gift.animationUrl,profileGift.animationUrl);
  assert.notEqual(replay.gift.imageUrl,first.gift.imageUrl);
  assert.equal(replay.balance,400);
  assert.equal(count('received_gifts'),1);
  assert.equal(count('gift_upgrades'),1);
  assert.equal(count('gift_consumptions'),0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM star_transfers WHERE kind='case_open'").get().n,1);
});

void test('replaying an earlier case after its gift is used never restores the consumed gift',async t=>{
  reset();t.mock.method(globalThis.crypto,'getRandomValues',bytes=>{bytes.fill(0);return bytes;});
  const first=await play('case',{caseId:'moon'});
  await play('upgrade',{key:'upgrade-request-0002',receiptId:first.gift.id,targetGiftId:'plush_pepe'});
  const replay=await play('case',{caseId:'moon'});
  assert.deepEqual(replay.operation,first.operation);
  assert.equal(replay.gift.available,false);
  assert.equal((await account()).gifts.some(g=>g.id===first.gift.id),false);
});

void test('game routes reject client-selected price and cross-origin writes',async()=>{
  reset();
  const body={initData:signed(),version:'2026-09-15-1',key:'case-request-0001',caseId:'moon'};
  assert.equal((await api.casePost(request('/api/noct-gifts/case',{...body,price:1}))).status,400);
  assert.equal((await api.casePost(request('/api/noct-gifts/case',body,{Origin:'https://evil.test'}))).status,403);
  assert.equal(count('received_gifts'),0);
});
const request = (path, body, headers = {}) =>
  new Request('https://noct.test' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

void test('parallel duplicate case requests share one persisted outcome; different requests cannot overdraw',async()=>{
  reset();
  const same=await Promise.all([play('case'),play('case')]);
  assert.deepEqual(same[0].operation,same[1].operation);
  assert.equal(count('received_gifts'),1);
  reset();
  const different=await Promise.allSettled([play('case'),play('case',{key:'another-case-key-0002'})]);
  assert.equal(different.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(count('received_gifts'),1);
  assert.equal((await account()).balance,180);
});

void test('parallel upgrades cannot consume the same source twice',async()=>{
  reset();gift(1,'alice');
  const outcomes=await Promise.allSettled([play('upgrade'),play('upgrade',{key:'another-upgrade-0002'})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(count('gift_consumptions'),1);
  assert.equal((await account()).balance,342);
});

void test('auth accepts Telegram HMAC with signature field and ignores unsigned display names for identity', async () => {
  const got = await api.verifyNoctGiftsInitData(
    signed(111, { signature: 'telegram-signature', start_param: 'hello' }),
    token,
  );
  assert.equal(got.telegramId, '111');
  assert.equal(got.authExpiresAt - got.authenticatedAt, 3600000);
});
void test('auth rejects tampered user, another bot token, duplicates, malformed escaping and invalid users', async () => {
  for (const raw of [
    signed().replace('%3A111%2C', '%3A222%2C'),
    signed(111, {}, '999999:' + 'b'.repeat(35)),
    signed() + '&user=%7B%22id%22%3A222%7D',
    signed() + '&hash=' + 'a'.repeat(64),
    signed() + '&bad=%E0%A4%A',
    signed(111, { user: '{"id":"111"}' }),
    signed(111, { user: '{"id":-111}' }),
    signed(111, { user: '{"id":111,"is_bot":true}' }),
  ])
    await assert.rejects(
      api.verifyNoctGiftsInitData(raw, token),
      (e) => e.status === 401,
    );
});
void test('auth fails closed for missing token, stale/future auth dates and absent initData', async () => {
  await assert.rejects(
    api.verifyNoctGiftsInitData(signed(), ''),
    (e) => e.status === 503,
  );
  for (const raw of [
    '',
    undefined,
    signed(111, { auth_date: String(Math.floor(Date.now() / 1000) - 3601) }),
    signed(111, { auth_date: String(Math.floor(Date.now() / 1000) + 120) }),
  ])
    await assert.rejects(
      api.verifyNoctGiftsInitData(raw, token),
      (e) => e.status === 401,
    );
});
void test('shared account uses canonical wallet and all catalog gifts, without grants or copying demo inventory', async () => {
  reset();
  gift(1, 'alice', 1);
  gift(2, 'bob');
  const before = sqlite
    .prepare('SELECT COUNT(*) n FROM star_transfers')
    .get().n;
  const got = await account();
  assert.equal(got.status, 'linked');
  assert.equal(got.user.name, 'Alice');
  assert.equal(got.balance, 500);
  assert.deepEqual(
    got.gifts.map((g) => g.id),
    ['gift-1'],
  );
  assert.equal(got.gifts[0].giftId, 'toy_bear');
  assert.equal(got.gifts[0].hidden, true);
  assert.equal(
    got.gifts[0].imageUrl,
    'https://noct.test/assets/gifts/toy_bear.webp',
  );
  assert.equal('sender' in got.gifts[0], false);
  assert.equal('message' in got.gifts[0], false);
  assert.equal(got.catalog.products.length, 11);
  assert.equal(got.catalog.products.find((p) => p.id === 'stars1000').xtr, 139);
  assert.equal(got.capabilities.caseOpening, true);
  assert.equal(got.capabilities.upgrading, true);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) n FROM star_transfers').get().n,
    before,
  );
});
void test('canonical pagination stays with owner and converted gifts disappear', async () => {
  reset();
  for (let i = 1; i <= 27; i++) gift(i, 'alice');
  gift(99, 'bob');
  sqlite
    .prepare(
      "INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created) VALUES('gift-conversion:gift-27','noctgram_gifts','alice',?,21,'gift_conversion',100)",
    )
    .run(JSON.stringify({ receiptId: 'gift-27' }));
  sqlite.exec(
    "INSERT INTO gift_conversions(receiptId,transferId,amount,created) VALUES('gift-27','gift-conversion:gift-27',21,100)",
  );
  const first = await account();
  const second = await account(111, { before: first.next });
  assert.equal(first.gifts.length, 24);
  assert.equal(second.gifts.length, 2);
  assert.equal(second.next, null);
  assert.equal(
    new Set([...first.gifts, ...second.gifts].map((g) => g.id)).size,
    26,
  );
  assert.ok(
    [...first.gifts, ...second.gifts].every(
      (g) => !['gift-27', 'gift-99'].includes(g.id),
    ),
  );
  assert.deepEqual((await account(111, { before: 'gift-99' })).gifts, []);
});
void test('collectibles preserve canonical instance id, unique number and selected model artwork', async () => {
  reset();
  gift(1, 'alice', 0, 'plush_pepe');
  const attributes = {
    model: {
      id: 'black',
      name: 'Black',
      asset: 'collectible-plush_pepe-123456abcdef',
      rarityPermille: 10,
    },
    backdrop: {
      id: 'night',
      name: 'Night',
      centerColor: '#222222',
      edgeColor: '#000000',
      patternColor: '#333333',
      textColor: '#ffffff',
      rarityPermille: 20,
    },
    symbol: { id: 'moon', name: 'Moon', asset: 'symbol', rarityPermille: 30 },
  };
  sqlite
    .prepare(
      "INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created) VALUES('upgrade-1','alice','noctgram_gifts',?,25,'gift_upgrade',100)",
    )
    .run(JSON.stringify({ receiptId: 'gift-1' }));
  sqlite
    .prepare(
      'INSERT INTO gift_upgrades(receiptId,transferId,family,number,attributes,keepOriginal,created) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      'gift-1',
      'upgrade-1',
      'plush_pepe',
      7,
      JSON.stringify(attributes),
      1,
      100,
    );
  const [g] = (await account()).gifts;
  assert.equal(g.id, 'gift-1');
  assert.equal(g.collectible.number, 7);
  assert.equal(g.collectible.model.name, 'Black');
  assert.equal(
    g.imageUrl,
    'https://noct.test/assets/gifts/collectible-plush_pepe-123456abcdef.webp',
  );
  assert.ok(g.animationUrl.endsWith('.tgs'));
});
void test('unlinked identity cannot inherit browser user/cookie or create account', async () => {
  reset();
  const total = sqlite.prepare('SELECT COUNT(*) n FROM users').get().n;
  const got = await account(333);
  assert.equal(got.status, 'unlinked');
  assert.equal('balance' in got, false);
  assert.equal('gifts' in got, false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM users').get().n, total);
  const response = await api.accountPost(
    request(
      '/api/noct-gifts/account',
      { initData: signed(111), userId: 'bob' },
      { cookie: 'noct_session=bob' },
    ),
  );
  assert.equal(response.status, 400);
});
void test('unlink and restrictions revoke shared access, including unlink during reads', async () => {
  reset();
  sqlite.exec("DELETE FROM telegram_links WHERE userId='alice'");
  assert.equal((await account()).status, 'unlinked');
  reset();
  sqlite.exec("UPDATE users SET deletedAt=1 WHERE id='alice'");
  await assert.rejects(account(), (e) => e.status === 403);
  reset();
  sqlite.exec(
    "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('alice','event','blocked','test',1)",
  );
  await assert.rejects(account(), (e) => e.status === 403);
  reset();
  sqlite
    .prepare("UPDATE users SET sessionsRevokedAt=? WHERE id='alice'")
    .run(Date.now() + 1000);
  await assert.rejects(account(), (e) => e.status === 401);
  reset();
  afterRead = (q) => {
    if (q.includes('AS balance FROM star_transfers'))
      sqlite.exec("DELETE FROM telegram_links WHERE userId='alice'");
  };
  await assert.rejects(account(), (e) => e.status === 401);
  afterRead = () => {};
});
void test('topup uses existing payment bot, exact catalog and idempotent order without crediting wallet', async () => {
  reset();
  const b = {
    initData: signed(),
    sku: 'stars500',
    key: 'drop-request-1234',
    acceptedTerms: true,
  };
  const one = await api.noctGiftsTopup(b);
  const two = await api.noctGiftsTopup(b);
  assert.equal(one.id, two.id);
  assert.equal(one.amountMinor, 75);
  assert.equal(one.units, 500);
  assert.equal(one.currency, 'XTR');
  assert.ok(
    one.checkoutUrl.startsWith('https://t.me/noct_test_bot?start=pay_'),
  );
  assert.equal((await account()).balance, 500);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) n FROM payment_orders').get().n,
    1,
  );
  await assert.rejects(
    api.noctGiftsTopup({ ...b, sku: 'stars1000' }),
    (e) => e.status === 409,
  );
  await assert.rejects(
    api.noctGiftsTopup({ ...b, key: 'no-consent', acceptedTerms: false }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    api.noctGiftsTopup({ ...b, key: 'premium-request', sku: 'premium30' }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    api.noctGiftsTopup({ ...b, initData: signed(333) }),
    (e) => e.status === 409,
  );
});
void test('topup rejects stale link retry and readonly account', async () => {
  reset();
  const b = {
    initData: signed(),
    sku: 'stars100',
    key: 'link-retry-123',
    acceptedTerms: true,
  };
  await api.noctGiftsTopup(b);
  sqlite.exec("UPDATE telegram_links SET id='new-link-a' WHERE userId='alice'");
  await assert.rejects(
    api.noctGiftsTopup(b),
    (e) => e.code === 'TELEGRAM_LINK_CHANGED',
  );
  reset();
  sqlite.exec(
    "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('alice','event','read_only','test',1)",
  );
  assert.equal((await account()).status, 'linked');
  await assert.rejects(api.noctGiftsTopup(b), (e) => e.status === 403);
});
void test('preview payment disable flag hides checkout and rejects orders without database side effects', async () => {
  reset();
  globalThis.__noctGiftsSettings.NOCT_GIFTS_PAYMENTS_DISABLED = '1';
  try {
    const shared = await account();
    assert.equal(shared.catalog.telegram, false);
    assert.equal(shared.balance, 500);
    assert.equal(shared.catalog.products.length, 11);
    const snapshot = () =>
      JSON.stringify(
        [
          'payment_orders',
          'payment_receipts',
          'star_transfers',
          'received_gifts',
          'auth_limits',
        ].map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all()),
      );
    const before = snapshot();
    const response = await api.topupPost(
      request('/api/noct-gifts/topup', {
        initData: signed(),
        sku: 'stars500',
        key: 'disabled-preview-order',
        acceptedTerms: true,
      }),
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'NOCT_GIFTS_PAYMENTS_DISABLED');
    assert.equal(snapshot(), before);
  } finally {
    delete globalThis.__noctGiftsSettings.NOCT_GIFTS_PAYMENTS_DISABLED;
  }
  assert.equal((await account()).catalog.telegram, true);
});
void test('routes reject cross-origin, excessive body and client-selected identity/provider; errors are not cached', async () => {
  reset();
  const calls = [
    [
      api.accountPost,
      request(
        '/api/noct-gifts/account',
        { initData: signed() },
        { origin: 'https://attacker.test' },
      ),
      403,
    ],
    [
      api.accountPost,
      request('/api/noct-gifts/account', { initData: 'x'.repeat(17000) }),
      413,
    ],
    [
      api.accountPost,
      request('/api/noct-gifts/account', {
        initData: signed(111, {}, '999999:' + 'z'.repeat(35)),
      }),
      401,
    ],
    [
      api.topupPost,
      request('/api/noct-gifts/topup', {
        initData: signed(),
        sku: 'stars100',
        key: 'request-12345',
        acceptedTerms: true,
        provider: 'crypto',
      }),
      400,
    ],
  ];
  for (const [fn, req, status] of calls) {
    const response = await fn(req);
    assert.equal(response.status, status);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
  const response = await api.accountPost(
    request('/api/noct-gifts/account', { initData: signed() }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});
test.after(() => sqlite.close());
