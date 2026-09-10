import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const sqlite = new DatabaseSync(':memory:');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const entry of journal.entries)
  sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
sqlite.exec(
  "INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1)",
);
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
      return {
        meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
      };
    },
  };
}
globalThis.__activityDb = {
  prepare: statement,
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const result = [];
      for (const item of statements) result.push(await item.run());
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};
const result = await build({
  entryPoints: ['lib/music-activity.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'sqlite-runtime',
      setup(build) {
        build.onResolve({ filter: /^\.\/auth-session$/ }, () => ({
          path: 'auth',
          namespace: 'fixture-settings',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture-settings' }, () => ({
          contents: "export const setting=()=> '1';",
        }));
        build.onResolve({ filter: /^\.\/(storage|server)$/ }, (args) => ({
          path: args.path,
          namespace: 'fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
      export const db = () => globalThis.__activityDb;
      export { ApiError } from './lib/api-error';
      export const clean = value => value;
    `,
          resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64')
);
const now = Date.now();
const sample = {
  sessionId: 'session-a-123456789',
  sequence: 1,
  playing: true,
  claim: true,
  url: 'https://soundcloud.com/artist/fixture',
  title: 'Fixture track',
  artist: 'Fixture artist',
  artwork: 'https://i1.sndcdn.com/art-large.jpg',
  positionMs: 12000,
  durationMs: 142000,
};
assert.equal(await api.musicActivityEnabled('alice'), true);
await api.publishMusicActivity('alice', sample, now);
const activity = await api.readMusicActivity('bob', 'alice', now + 500);
assert.equal(activity.title, sample.title);
assert.equal(activity.state, 'playing');
assert.equal(activity.positionMs, 12000);
assert.equal(activity.updatedAt, now);
assert.equal(activity.expiresAt, now + api.ACTIVITY_TTL);
assert.deepEqual(activity.listeningWith, [], 'Solo playback has no companions');
assert.ok(
  !('sessionId' in activity) && !('sequence' in activity),
  'Internal lease identifiers are private',
);
assert.equal(
  await api.readMusicActivity('bob', 'alice', now + api.ACTIVITY_TTL),
  null,
);

// Seeking updates the position; out-of-order heartbeats cannot move it back.
await api.publishMusicActivity(
  'alice',
  { ...sample, sequence: 3, positionMs: 80000 },
  now + 1000,
);
await api.publishMusicActivity(
  'alice',
  { ...sample, sequence: 2, positionMs: 14000 },
  now + 2000,
);
assert.equal(
  (await api.readMusicActivity('bob', 'alice', now + 2001)).positionMs,
  80000,
);
await api.publishMusicActivity(
  'alice',
  { ...sample, sequence: 4, playing: false },
  now + 3000,
);
assert.equal(await api.readMusicActivity('bob', 'alice', now + 3001), null);
await api.publishMusicActivity('alice', { ...sample, sequence: 3 }, now + 4000);
assert.equal(await api.readMusicActivity('bob', 'alice', now + 4001), null);

// A stop arriving before the very first publish still prevents resurrection.
await api.publishMusicActivity(
  'carol',
  { ...sample, sequence: 2, playing: false },
  now,
);
await api.publishMusicActivity('carol', sample, now + 10);
assert.equal(await api.readMusicActivity('bob', 'carol', now + 20), null);

// Pause is a visible lease with a fixed position, including after long breaks.
const paused = {
  ...sample,
  state: 'paused',
  sequence: 3,
  positionMs: 42000,
};
await api.publishMusicActivity('carol', paused, now + 1000);
await api.publishMusicActivity('carol', { ...sample, sequence: 2 }, now + 2000);
const pausedActivity = await api.readMusicActivity('bob', 'carol', now + 30000);
assert.equal(
  pausedActivity.state,
  'paused',
  'Late playing updates cannot undo pause',
);
assert.equal(pausedActivity.positionMs, 42000);
await api.publishMusicActivity(
  'carol',
  { ...paused, sequence: 4, claim: false },
  now + 60000,
);
assert.equal(
  (await api.readMusicActivity('bob', 'carol', now + 90000)).positionMs,
  42000,
  'Paused heartbeats retain the song beyond the original lease',
);
assert.equal(
  await api.readMusicActivity('bob', 'carol', now + 60000 + api.ACTIVITY_TTL),
  null,
  'A disconnected paused player eventually expires',
);
await api.publishMusicActivity(
  'carol',
  { ...paused, sequence: 5, positionMs: 58000 },
  now + 61000,
);
assert.equal(
  (await api.readMusicActivity('bob', 'carol', now + 61001)).positionMs,
  58000,
  'Seeking while paused updates the fixed position',
);
await api.publishMusicActivity(
  'carol',
  { ...paused, state: 'playing', sequence: 6, positionMs: 58000 },
  now + 62000,
);
assert.equal(
  (await api.readMusicActivity('bob', 'carol', now + 62001)).state,
  'playing',
);
await api.publishMusicActivity(
  'carol',
  { sessionId: sample.sessionId, sequence: 7, state: 'stopped' },
  now + 63000,
);
await api.publishMusicActivity(
  'carol',
  { ...paused, sequence: 6 },
  now + 64000,
);
assert.equal(await api.readMusicActivity('bob', 'carol', now + 64001), null);

// Another tab claims playback; the previous tab cannot clear or overwrite it.
await api.publishMusicActivity('alice', { ...sample, sequence: 5 }, now + 5000);
const other = {
  ...sample,
  sessionId: 'session-b-123456789',
  title: 'Other tab',
};
await api.publishMusicActivity('alice', other, now + 6000);
await api.publishMusicActivity(
  'alice',
  { ...sample, sequence: 6, playing: false },
  now + 7000,
);
await api.publishMusicActivity(
  'alice',
  { ...sample, sequence: 7, claim: false },
  now + 8000,
);
await api.publishMusicActivity(
  'alice',
  { ...paused, sequence: 8, claim: true },
  now + 8000,
);
assert.equal(
  (await api.readMusicActivity('bob', 'alice', now + 8001)).title,
  'Other tab',
);

sqlite.exec(
  "INSERT INTO user_privacy(userId,hideAdult,messagePolicy) VALUES('alice',1,'nobody')",
);
await api.setMusicActivityEnabled('alice', false);
assert.equal(await api.musicActivityEnabled('alice'), false);
await api.publishMusicActivity('alice', { ...other, sequence: 2 }, now + 9000);
await api.publishMusicActivity(
  'alice',
  { ...other, state: 'paused', sequence: 3 },
  now + 9000,
);
assert.equal(await api.readMusicActivity('bob', 'alice', now + 9001), null);
assert.deepEqual(
  {
    ...sqlite
      .prepare(
        "SELECT hideAdult,messagePolicy FROM user_privacy WHERE userId='alice'",
      )
      .get(),
  },
  { hideAdult: 1, messagePolicy: 'nobody' },
);
await api.setMusicActivityEnabled('alice', true);
assert.equal(
  await api.readMusicActivity('bob', 'alice', now + 10000),
  null,
  'Enabling sharing does not reveal a stale song',
);
await api.publishMusicActivity('alice', { ...other, sequence: 3 }, now + 11000);
for (const [blocker, blocked] of [
  ['bob', 'alice'],
  ['alice', 'bob'],
]) {
  sqlite
    .prepare('INSERT INTO user_blocks(blocker,blocked,created) VALUES(?,?,?)')
    .run(blocker, blocked, now);
  assert.equal(
    await api.readMusicActivity('bob', 'alice', now + 11001),
    null,
    'Blocks work in both directions',
  );
  sqlite.exec('DELETE FROM user_blocks');
}
sqlite.exec("UPDATE users SET onboardingComplete=0 WHERE id='alice'");
assert.equal(await api.readMusicActivity('bob', 'alice', now + 11001), null);
sqlite.exec("UPDATE users SET onboardingComplete=1 WHERE id='alice'");
sqlite
  .prepare(
    "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('activity_block','alice','bob','blocked','Fixture',?)",
  )
  .run(now);
sqlite
  .prepare(
    "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('alice','activity_block','blocked','Fixture',?)",
  )
  .run(now);
assert.equal(
  await api.readMusicActivity('bob', 'alice', now + 11001),
  null,
  'Restricted profiles never publish activity',
);
sqlite.exec("DELETE FROM account_restrictions WHERE userId='alice'");
// Validation is independent from account visibility and never accepts private audio URLs.
for (const invalid of [
  { url: 'https://example.com/private.mp3' },
  { url: 'https://soundcloud.com/artist/sets/playlist' },
  { durationMs: Infinity },
  { positionMs: -1 },
  { positionMs: 200000 },
  { title: '' },
  { sequence: -1 },
  { state: 'invalid' },
])
  await assert.rejects(
    api.publishMusicActivity(
      'alice',
      { ...other, sequence: 4, ...invalid },
      now + 12000,
    ),
  );
// A public status derives companions from current room membership AND playback.
sqlite.exec(`
  INSERT INTO users(id,name,avatar,created) VALUES
    ('dave','Dave','',1),('eva','Eva','/media/eva.jpg',1),
    ('fay','Fay','',1),('gina','Gina','',1);
  INSERT INTO handles(handle,userId,main) VALUES('eva_music','eva',1);
`);
sqlite
  .prepare(`INSERT INTO music_tracks
  (id,url,provider,kind,title,artist,artwork,authorUrl,durationMs,created)
  VALUES('together-track',?,'soundcloud','track','Fixture track','Fixture artist','','',142000,?)`)
  .run(sample.url, now);
for (const room of ['together', 'elsewhere']) {
  sqlite
    .prepare(`INSERT INTO music_playlists
    (id,ownerId,name,created,updatedAt,trackId,playing,durationMs,playbackAt)
    VALUES(?,'dave',?,?,?,'together-track',1,142000,?)`)
    .run(room, room, now, now, now);
}
for (const [user, room, status] of [
  ['dave', 'together', 'accepted'],
  ['eva', 'together', 'accepted'],
  ['fay', 'together', 'invited'],
  ['gina', 'elsewhere', 'accepted'],
]) {
  sqlite
    .prepare(`INSERT INTO music_playlist_members
    (playlistId,userId,status,created,listenSession,listenUntil) VALUES(?,?,?,?,?,?)`)
    .run(room, user, status, now, 'room-session-123456789', now + 50000);
  await api.publishMusicActivity(user, sample, now);
}
const groupActivity = await api.readMusicActivity('bob', 'dave', now + 1);
assert.deepEqual(
  groupActivity.listeningWith.map((person) => ({ ...person })),
  [
    {
      userId: 'eva',
      name: 'Eva',
      avatar: '/media/eva.jpg',
      handle: 'eva_music',
      expiresAt: now + 50000,
    },
  ],
  'Only actual listeners in the same room are visible; no room/session details leak',
);
assert.deepEqual(
  (await api.readMusicActivity('bob', 'eva', now + 1)).listeningWith.map(
    (person) => person.userId,
  ),
  ['dave'],
  'Both participants see their companion, never themselves',
);

// Membership without playback, or playback without membership, is not listening together.
/** @type {Array<[string, number[], string]>} */
const companionCases = [
  [
    "UPDATE music_playlist_members SET listenSession='',listenUntil=0 WHERE userId='eva'",
    [],
    'Explicit detach',
  ],
  [
    "UPDATE music_playlist_members SET listenUntil=? WHERE userId='eva'",
    [now],
    'Disconnected guest lease expires',
  ],
  [
    "UPDATE music_playlist_members SET listenUntil=? WHERE userId='dave'",
    [now],
    'Subject is no longer listening in the room',
  ],
  [
    "UPDATE music_playlist_members SET status='invited' WHERE userId='eva'",
    [],
    'An invitation is not a listener',
  ],
  [
    "UPDATE music_playlist_members SET status='invited' WHERE userId='dave'",
    [],
    'Subject must be an accepted member',
  ],
  [
    "DELETE FROM music_playlist_members WHERE userId='eva'",
    [],
    'Removed guest',
  ],
  ["DELETE FROM music_playlists WHERE id='together'", [], 'Deleted room'],
  [
    "UPDATE music_playlists SET trackId=NULL WHERE id='together'",
    [],
    'Room has no active song',
  ],
  [
    "UPDATE music_playlists SET playing=0 WHERE id='together'",
    [],
    'Room state must match actual playback',
  ],
  [
    "UPDATE music_activity SET trackUrl='https://soundcloud.com/artist/other' WHERE userId='eva'",
    [],
    'Guest chose another song',
  ],
  [
    "UPDATE music_activity SET state='paused' WHERE userId='eva'",
    [],
    'Guest has not started playback',
  ],
  [
    "UPDATE music_activity SET expiresAt=? WHERE userId='eva'",
    [now],
    'Guest playback heartbeat expired',
  ],
  [
    "DELETE FROM music_activity WHERE userId='eva'",
    [],
    'Autoplay was never started',
  ],
  [
    "INSERT INTO user_privacy(userId,showMusicActivity) VALUES('eva',0)",
    [],
    'Hidden music activity',
  ],
  [
    "UPDATE users SET onboardingComplete=0 WHERE id='eva'",
    [],
    'Incomplete profile',
  ],
  [
    "UPDATE users SET kind='channel' WHERE id='eva'",
    [],
    'Only personal accounts',
  ],
];
for (const [sql, values, reason] of companionCases) {
  sqlite.exec('SAVEPOINT companion_case');
  sqlite.prepare(sql).run(...values);
  const value = await api.readMusicActivity('bob', 'dave', now + 1);
  assert.deepEqual(value.listeningWith, [], reason);
  sqlite.exec('ROLLBACK TO companion_case; RELEASE companion_case');
}
for (const [blocker, blocked] of [
  ['bob', 'eva'],
  ['eva', 'bob'],
  ['dave', 'eva'],
  ['eva', 'dave'],
]) {
  sqlite
    .prepare('INSERT INTO user_blocks(blocker,blocked,created) VALUES(?,?,?)')
    .run(blocker, blocked, now);
  assert.deepEqual(
    (await api.readMusicActivity('bob', 'dave', now + 1)).listeningWith,
    [],
    'Companions respect both the viewer and subject blocks in either direction',
  );
  sqlite.exec('DELETE FROM user_blocks');
}
sqlite.exec('SAVEPOINT companion_restriction');
sqlite
  .prepare(`INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created)
  VALUES('companion_block','eva','bob','blocked','Fixture',?)`)
  .run(now);
sqlite
  .prepare(`INSERT INTO account_restrictions(userId,eventId,mode,reason,created)
  VALUES('eva','companion_block','blocked','Fixture',?)`)
  .run(now);
assert.deepEqual(
  (await api.readMusicActivity('bob', 'dave', now + 1)).listeningWith,
  [],
  'Restricted companions are hidden',
);
sqlite.exec('ROLLBACK TO companion_restriction; RELEASE companion_restriction');

// Pausing together preserves the group; a new listener appears without republishing the subject.
sqlite.exec("UPDATE music_playlists SET playing=0 WHERE id='together'");
for (const user of ['dave', 'eva', 'fay'])
  await api.publishMusicActivity(
    user,
    { ...sample, state: 'paused', sequence: 2 },
    now + 100,
  );
sqlite.exec(
  "UPDATE music_playlist_members SET status='accepted' WHERE userId='fay'",
);
const pausedGroup = await api.readMusicActivity('bob', 'dave', now + 101);
assert.equal(pausedGroup.state, 'paused');
assert.deepEqual(
  pausedGroup.listeningWith.map((person) => person.userId),
  ['eva', 'fay'],
);
await api.setMusicActivityEnabled('eva', false);
assert.deepEqual(
  (await api.readMusicActivity('bob', 'dave', now + 102)).listeningWith.map(
    (person) => person.userId,
  ),
  ['fay'],
  'Turning off activity immediately hides the listener in other profiles',
);
await api.setMusicActivityEnabled('dave', false);
assert.equal(
  await api.readMusicActivity('bob', 'dave', now + 103),
  null,
  'Turning off activity hides both the song and the group',
);
sqlite.close();
delete globalThis.__activityDb;
console.log(
  'Music activity: SQLite leases, seek/pause, expiry, stale writes, multiple tabs, live companions, privacy and input validation passed.',
);
