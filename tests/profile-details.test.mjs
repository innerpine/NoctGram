import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const sql = new DatabaseSync(':memory:');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const { tag } of journal.entries)
  sql.exec(await readFile('drizzle/' + tag + '.sql', 'utf8'));
const now = Date.now();
sql.exec(`INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',2),('carol','Carol',3);
 INSERT INTO users(id,name,created,kind,ownerId) VALUES('ch1','Night notes',10,'channel','alice'),('ch2','Second',11,'channel','alice'),('ch3','Third',12,'channel','alice'),('ch4','Fourth',13,'channel','alice'),('gone','Gone',14,'channel','alice'),('bobch','Bob channel',15,'channel','bob');
 UPDATE users SET deletedAt=1 WHERE id='gone';
 INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bob','bob',1),('carol','carol',1),('nightnotes','ch1',1),('second','ch2',1),('third','ch3',1),('fourth','ch4',1),('bobchannel','bobch',1);
 INSERT INTO follows(follower,following) VALUES('bob','ch1'),('carol','ch1');
 INSERT INTO uploads(id,userId,type,name,created) VALUES('m1','alice','image/png','a.png',1);
 INSERT INTO posts(id,userId,text,media,created) VALUES('old','ch1','Older','[]',100),('latest','ch1','${'x'.repeat(196)}:noct_smile: tail','[{"id":"m1","type":"image/png","name":"a.png"}]',200);
 INSERT INTO posts(id,userId,text,created,publishAt) VALUES('scheduled','ch1','Later',300,${now + 3600000});
 INSERT INTO posts(id,userId,text,created,cancelledAt) VALUES('cancelled','ch1','Cancelled',400,1);
 INSERT INTO posts(id,userId,text,poll,code,created) VALUES('poll','ch2','Poll?','["a","b"]','x',50);`);
const database = {
  prepare(query) {
    return {
      query,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        return sql.prepare(query).get(...this.args) || null;
      },
      async all() {
        return { results: sql.prepare(query).all(...this.args) };
      },
      async run() {
        return {
          meta: {
            changes: Number(sql.prepare(query).run(...this.args).changes),
          },
        };
      },
    };
  },
  async batch(statements) {
    sql.exec('BEGIN');
    try {
      const results = [];
      for (const s of statements) {
        const q = sql.prepare(s.query);
        const rows = q.columns().length
          ? q.all(...s.args)
          : (q.run(...s.args), []);
        results.push({
          results: rows,
          meta: { changes: Number(sql.prepare('SELECT changes() n').get().n) },
        });
      }
      sql.exec('COMMIT');
      return results;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
globalThis.__detailsDB = database;
globalThis.__detailsHeaders = new Headers();
const { outputFiles } = await build({
  stdin: {
    contents:
      "export { GET, POST } from './app/api/social/route.ts'; export { deleteAccount } from './lib/account-removal.ts';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'details-fixture',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(cloudflare:workers|next\/headers|next\/server|next\/navigation|(\.\/|@\/lib\/)storage)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'cloudflare:workers'
              ? 'export const env={NOCT_AUTH_MODE:"hybrid"};'
              : path === 'next/server'
                ? 'export const after=()=>{};'
                : path === 'next/headers'
                  ? 'export const headers=async()=>globalThis.__detailsHeaders; export const cookies=async()=>({get:()=>undefined,set:()=>{}});'
                  : path === 'next/navigation'
                    ? 'export const redirect=()=>{throw new Error("Unexpected redirect")};'
                    : 'export const db=()=>globalThis.__detailsDB; export const bucket=()=>({});',
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
async function call(viewer, action, body, extra = '') {
  globalThis.__detailsHeaders = new Headers({
    'oai-authenticated-user-id': viewer,
    'oai-authenticated-user-email': viewer + '@example.test',
  });
  const req = new Request(
    'http://localhost/api/social?action=' + action + extra,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...body }),
        }
      : {},
  );
  const response = await api[body ? 'POST' : 'GET'](req);
  return { status: response.status, data: await response.json() };
}
async function ok(viewer, action, body, extra) {
  const result = await call(viewer, action, body, extra);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
const base = { name: 'Alice', bio: 'Bio', avatar: '', cover: '' };
const save = (body, viewer = 'alice') =>
  call(viewer, 'profile', { ...base, ...body });
const alice = () => ok('alice', 'profile');
const asBob = () => ok('bob', 'profile', undefined, '&id=alice');

let me = await alice();
assert.deepEqual(
  [me.location, me.website, me.birthday, me.showBirthYear, me.personalChannels],
  ['', '', '', true, []],
  'Empty details without a row',
);
const saved = await ok('alice', 'profile', {
  ...base,
  location: '  Москва,\n\t Россия ',
  website: 'Example.com/about?x=1',
  instagram: 'https://www.instagram.com/alice.art/?hl=ru',
  tiktok: 'www.tiktok.com/@alice_tt',
  youtube: '@Alice-Tube',
  birthday: '1995-04-12',
  showBirthYear: false,
  personalChannels: ['ch2', 'ch1'],
});
assert.equal(saved.location, 'Москва, Россия');
assert.equal(saved.website, 'https://Example.com/about?x=1', 'Kept as typed');
assert.equal(saved.instagram, 'alice.art');
assert.equal(saved.tiktok, 'alice_tt');
assert.equal(saved.youtube, 'Alice-Tube');
assert.equal(saved.birthday, '1995-04-12', 'The owner sees the full date');
assert.equal(saved.showBirthYear, false);
assert.deepEqual(
  saved.personalChannels.map((c) => c.id),
  ['ch2', 'ch1'],
  'Cards keep the chosen order',
);
const card = saved.personalChannels[1];
assert.equal(card.name, 'Night notes');
assert.equal(card.handle, 'nightnotes');
assert.equal(card.followers, 2);
assert.equal(card.kind, 'channel');
assert.equal(
  card.post.id,
  'latest',
  'Scheduled and cancelled posts never become the preview',
);
assert.equal(card.post.media, 'photo');
assert.equal(card.post.poll, false);
assert.equal(
  card.post.text,
  'x'.repeat(196),
  'The preview stops before a premium emoji token it would cut',
);
assert.deepEqual(
  { ...saved.personalChannels[0].post },
  { id: 'poll', text: 'Poll?', media: '', poll: true, code: true, created: 50 },
);

const visitor = await asBob();
assert.equal(visitor.birthday, '04-12', 'Others do not see a hidden year');
assert.equal('showBirthYear' in visitor, false, 'The switch is owner-only');
assert.equal(visitor.instagram, 'alice.art');
assert.equal(visitor.personalChannels.length, 2);

for (const [body, message] of [
  [{ website: 'javascript:alert(1)' }, 'Проверь ссылку на сайт'],
  [{ website: 'https://user:pass@example.com' }, 'Проверь ссылку на сайт'],
  [{ website: 'ftp://example.com' }, 'Проверь ссылку на сайт'],
  [{ website: 'localhost:3000' }, 'Проверь ссылку на сайт'],
  [{ website: 'exa mple.com' }, 'Проверь ссылку на сайт'],
  [{ website: 'example.com/' + 'a'.repeat(100) }, 'Проверь ссылку на сайт'],
  [{ instagram: 'bad name' }, 'Проверь имя в Instagram'],
  [{ instagram: 'https://evil.test/alice' }, 'Проверь имя в Instagram'],
  [{ tiktok: 'a' }, 'Проверь имя в TikTok'],
  [{ youtube: 'youtube.com/watch?v=1' }, 'Проверь имя на YouTube'],
  [{ birthday: '2999-01-01' }, 'Проверь дату рождения'],
  [{ birthday: '1995-02-30' }, 'Проверь дату рождения'],
  [{ birthday: '1899-12-31' }, 'Проверь дату рождения'],
  [{ showBirthYear: 'no' }, 'Проверь дату рождения'],
  [{ location: 'x'.repeat(31) }, 'Местоположение — не длиннее 30 символов'],
  [{ location: 'Nowhere\u0000' }, 'Проверь местоположение'],
  [{ location: 5 }, 'Проверь местоположение'],
  [{ personalChannels: ['bobch'] }, 'Можно показать до трёх своих каналов'],
  [{ personalChannels: ['gone'] }, 'Можно показать до трёх своих каналов'],
  [{ personalChannels: ['bob'] }, 'Можно показать до трёх своих каналов'],
  [
    { personalChannels: ['ch1', 'ch2', 'ch3', 'ch4'] },
    'Можно показать до трёх своих каналов',
  ],
  [
    { personalChannels: ['ch1', 'ch1'] },
    'Можно показать до трёх своих каналов',
  ],
  [{ personalChannels: 'ch1' }, 'Можно показать до трёх своих каналов'],
]) {
  const result = await save(body);
  assert.equal(result.status, 400, JSON.stringify(body));
  assert.ok(result.data.error.startsWith(message), result.data.error);
}
me = await alice();
assert.equal(
  me.website,
  'https://Example.com/about?x=1',
  'Rejections change nothing',
);
assert.equal(me.personalChannels.length, 2);

// Android and older web builds send only the basic fields.
await ok('alice', 'profile', { ...base, name: 'Alice 2' });
me = await alice();
assert.equal(me.name, 'Alice 2');
assert.deepEqual(
  [me.location, me.instagram, me.birthday, me.showBirthYear],
  ['Москва, Россия', 'alice.art', '1995-04-12', false],
  'Old clients keep the details',
);
assert.equal(me.personalChannels.length, 2);

await ok('alice', 'profile', {
  ...base,
  showBirthYear: true,
  location: '',
  website: 'http://example.org',
  youtube: 'https://m.youtube.com/@night.tube/',
  personalChannels: ['ch3', 'ch1', 'ch2'],
});
const shown = await asBob();
assert.equal(shown.birthday, '1995-04-12', 'A shown year reaches visitors');
assert.equal(shown.location, '');
assert.equal(shown.website, 'http://example.org');
assert.equal(shown.youtube, 'night.tube');
assert.deepEqual(
  shown.personalChannels.map((c) => c.id),
  ['ch3', 'ch1', 'ch2'],
);
assert.equal(shown.personalChannels[0].post, null, 'A channel without posts');

// A viewer who blocked a channel does not see its card.
sql.exec(
  "INSERT INTO user_blocks(blocker,blocked,created) VALUES('carol','ch3',1)",
);
assert.deepEqual(
  (await ok('carol', 'profile', undefined, '&id=alice')).personalChannels.map(
    (c) => c.id,
  ),
  ['ch1', 'ch2'],
);
// A moderation-blocked channel is hidden from visitors, but its owner still
// sees the card, so a save seeded from the owner's own profile keeps it.
sql.exec(
  "PRAGMA foreign_keys=OFF; INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('ch2','e-ch2','blocked','x',1); PRAGMA foreign_keys=ON;",
);
assert.deepEqual(
  (await asBob()).personalChannels.map((c) => c.id),
  ['ch3', 'ch1'],
  'A blocked channel card is hidden from visitors',
);
const owned = (await alice()).personalChannels.map((c) => c.id);
assert.deepEqual(owned, ['ch3', 'ch1', 'ch2']);
await ok('alice', 'profile', {
  ...base,
  bio: 'Only bio',
  personalChannels: owned,
});
sql.exec("DELETE FROM account_restrictions WHERE userId='ch2'");
assert.deepEqual(
  (await asBob()).personalChannels.map((c) => c.id),
  ['ch3', 'ch1', 'ch2'],
  'The card is back once the block ends',
);
await ok('alice', 'profile', { ...base, website: 'кто.рф/о-нас' });
assert.equal((await asBob()).website, 'https://кто.рф/о-нас', 'No punycode');
await ok('alice', 'profile', { ...base, personalChannels: [] });
assert.deepEqual((await alice()).personalChannels, [], '[] clears the cards');

// Channel profiles ignore person details.
const channel = await ok('alice', 'profile', {
  id: 'ch1',
  name: 'Night notes',
  bio: '',
  avatar: '',
  cover: '',
  location: 'Somewhere',
  website: 'javascript:alert(1)',
  personalChannels: ['ch2'],
});
assert.equal(channel.location, undefined);
assert.equal(channel.personalChannels, undefined);
assert.equal(
  sql.prepare("SELECT COUNT(*) n FROM profile_details WHERE userId='ch1'").get()
    .n,
  0,
);
assert.equal(
  sql
    .prepare("SELECT COUNT(*) n FROM profile_channels WHERE userId='ch1'")
    .get().n,
  0,
);
assert.equal(
  (await save({ id: 'alice', location: 'Mars' }, 'bob')).status,
  403,
  'Nobody edits another person',
);

// Spam domains in the new fields are refused like names and bios.
assert.equal(
  (await save({ website: 'unixgram.com' })).data.code,
  'SPAM_IDENTITY',
);

sql.exec(
  "INSERT INTO profile_details(userId,website,updated) VALUES('bob','https://unixgram.com/',1)",
);
const held = await call('bob', 'post', { text: 'Hello' });
assert.equal(held.status, 202, 'Stored details are re-checked on posting');
assert.equal(held.data.queued, true);

const mine = await ok('alice', 'myChannels');
assert.deepEqual(
  mine.channels.map((c) => [c.id, c.handle]),
  [
    ['ch1', 'nightnotes'],
    ['ch2', 'second'],
    ['ch3', 'third'],
    ['ch4', 'fourth'],
  ],
  'Only own, non-deleted channels in creation order',
);
assert.deepEqual(
  (await ok('bob', 'myChannels')).channels.map((c) => c.id),
  ['bobch'],
);

// Account deletion removes the details and the cards.
await ok('alice', 'profile', {
  ...base,
  location: 'Home',
  personalChannels: ['ch1'],
});
sql
  .prepare(
    'INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) VALUES(?,?,?,?,?)',
  )
  .run('session', 'alice', now, now + 3600000, Date.now());
await api.deleteAccount('alice', 'session', true);
for (const table of ['profile_details', 'profile_channels'])
  assert.equal(
    sql.prepare(`SELECT COUNT(*) n FROM ${table} WHERE userId='alice'`).get().n,
    0,
    table + ' is cleared',
  );
console.log(
  'Profile details: save, normalization, validation, old clients, birth year privacy, channel cards, myChannels and deletion passed',
);
sql.close();
