import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const sqlite = new DatabaseSync(':memory:');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
const scoreMigration = journal.entries.findIndex(
  (entry) => entry.tag === '0031_repeat_music_listens',
);
for (const entry of journal.entries.slice(0, scoreMigration))
  sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
sqlite.exec(
  "INSERT INTO users(id,name,created,onboardingComplete) VALUES('alice','Alice',1,1),('bob','Bob',1,1); INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bobby','bob',1)",
);
const song = {
  id: 'song',
  url: 'https://soundcloud.com/test/song',
  kind: 'track',
  provider: 'soundcloud',
  title: 'Song',
  artist: 'Artist',
  artwork: '',
  authorUrl: '',
  created: 1,
};
sqlite
  .prepare(
    'INSERT INTO music_tracks(id,url,kind,provider,title,artist,artwork,authorUrl,created) VALUES(?,?,?,?,?,?,?,?,?)',
  )
  .run(...Object.values(song));
sqlite.exec(
  "INSERT INTO music_listens(userId,trackId,day,created) VALUES('bob','song',1,86400000)",
);
sqlite.exec(await readFile('drizzle/0031_repeat_music_listens.sql', 'utf8'));
assert.equal(
  sqlite.prepare('SELECT plays FROM music_listens').get().plays,
  1,
  'Migration preserves each existing listen',
);
sqlite.exec('DELETE FROM music_listens');
let failBatch = false,
  tail = Promise.resolve();
globalThis.__scoreDb = {
  prepare(sql) {
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
        if (failBatch && sql.startsWith('UPDATE music_sessions SET counted')) {
          failBatch = false;
          throw Error('Commit failed');
        }
        return {
          meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
        };
      },
    };
  },
  batch(statements) {
    const next = tail.then(async () => {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sqlite.exec('COMMIT');
        return result;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    });
    tail = next.catch(() => {});
    return next;
  },
};
globalThis.__scoreSong = song;
const bundle = await build({
  entryPoints: ['app/api/music/route.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'score-fixtures',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(?:@\/lib\/(server|upload-storage|music-track-resolver|account-access|privacy|premium-access|rate-limit)|\.\/(storage|account-access))$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: path.endsWith('/server')
            ? `export const db=()=>globalThis.__scoreDb,viewer=async()=> 'alice',bucket=()=>({});export class ApiError extends Error{constructor(status,message){super(message);this.status=status}}export const failure=e=>Response.json({error:e.message},{status:e.status||500});`
            : path.endsWith('/storage')
              ? 'export const db=()=>globalThis.__scoreDb;'
              : path.endsWith('/account-access')
                ? `export const assertReadable=async()=>{},assertWritable=async()=>{},visibleAccount=a=>a+'.deletedAt=0 AND '+a+'.onboardingComplete=1';`
                : path.endsWith('/privacy')
                  ? "export const personalVisibility=()=> '(? IS NOT NULL)';"
                  : path.endsWith('/premium-access')
                    ? "export const appearanceColumns=()=> '0 AS premium';"
                    : path.endsWith('/music-track-resolver')
                      ? 'export const resolveTrack=async()=>globalThis.__scoreSong;'
                      : path.endsWith('/rate-limit')
                        ? 'export const rateLimit=async()=>{};'
                        : 'export const queueStorageDeletion=async()=>{};',
        }));
      },
    },
  ],
});
const { GET, POST } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
const post = async (body) => {
  const r = await POST(
    new Request('http://localhost/api/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: r.status, ...(await r.json()) };
};
const plays = () =>
  sqlite
    .prepare('SELECT COALESCE(SUM(plays),0) AS total FROM music_listens')
    .get().total;
try {
  const first = await post({ action: 'start', url: song.url });
  assert.equal(first.status, 200);
  assert.ok(first.session);
  assert.equal(
    (await post({ action: 'progress', session: first.session, totalMs: 30000 }))
      .status,
    409,
  );
  assert.equal(plays(), 0);
  now += 30000;
  const retries = await Promise.all(
    Array.from({ length: 8 }, () =>
      post({ action: 'progress', session: first.session, totalMs: 30000 }),
    ),
  );
  assert.ok(retries.every((r) => r.counted));
  assert.equal(plays(), 1, 'Retries cannot multiply a listen');
  for (let i = 0; i < 40; i++) {
    const next = await post({ action: 'start', url: song.url });
    assert.ok(next.session, 'Same track may start again today');
    now += 30000;
    assert.equal(
      (
        await post({
          action: 'progress',
          session: next.session,
          totalMs: 30000,
        })
      ).counted,
      true,
    );
  }
  assert.equal(plays(), 41);
  const interrupted = await post({ action: 'start', url: song.url });
  now += 30000;
  failBatch = true;
  assert.equal(
    (
      await post({
        action: 'progress',
        session: interrupted.session,
        totalMs: 30000,
      })
    ).status,
    500,
  );
  assert.equal(plays(), 41, 'Failed acknowledgement rolls back the score');
  assert.equal(
    (
      await post({
        action: 'progress',
        session: interrupted.session,
        totalMs: 30000,
      })
    ).counted,
    true,
  );
  assert.equal(plays(), 42);
  const other = await post({ action: 'start', url: song.url });
  assert.equal(
    (
      await post({
        action: 'progress',
        session: interrupted.session,
        totalMs: 30000,
      })
    ).status,
    409,
    'Superseded sessions cannot count',
  );
  now += 30000;
  sqlite.exec(
    "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('fixture','alice','bob','read_only','fixture',1); INSERT INTO account_restrictions(userId,eventId,mode,reason,created,expiresAt) VALUES('alice','fixture','read_only','fixture',1,NULL)",
  );
  assert.notEqual(
    (await post({ action: 'progress', session: other.session, totalMs: 30000 }))
      .counted,
    true,
  );
  assert.equal(plays(), 42);
  sqlite.exec("DELETE FROM account_restrictions WHERE userId='alice'");
  const chart = await GET(
    new Request('http://localhost/api/music?action=home&period=7'),
  );
  assert.equal(chart.status, 200);
  const data = await chart.json();
  assert.equal(data.tracks[0].plays, 42);
  assert.equal(data.listeners[0].plays, 42);
  assert.equal(data.mine.plays, 42);
  assert.equal(data.mine.tracks, 1);
  assert.equal(data.artists, undefined);
  console.log(
    'Music scores: repeated listens, 30-second threshold, retry/concurrency idempotency, rollback, stale sessions, restrictions, and charts passed.',
  );
} finally {
  Date.now = originalNow;
  sqlite.close();
}
