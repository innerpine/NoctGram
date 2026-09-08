import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { checkMusicRoom } from './music-room-harness.mjs';

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
      if (
        sql.includes('WITH original AS MATERIALIZED') &&
        globalThis.__beforeReorder
      ) {
        const before = globalThis.__beforeReorder;
        delete globalThis.__beforeReorder;
        before();
      }
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
  entryPoints: ['lib/music-playlists.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'sqlite-runtime',
      setup(build) {
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
sqlite.exec(
  "INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bob','bob',1),('carol','carol',1)",
);
for (const [id, provider, url, duration] of [
  ['first', 'soundcloud', 'https://soundcloud.com/test/first', 120000],
  ['second', 'soundcloud', 'https://soundcloud.com/test/second', 140000],
  ['youtube', 'youtube', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', 120000],
  [
    'spotify',
    'spotify',
    'https://open.spotify.com/track/1234567890123456789012',
    180000,
  ],
])
  sqlite
    .prepare(
      "INSERT INTO music_tracks(id,url,provider,kind,title,artist,artwork,authorUrl,durationMs,created) VALUES(?,?,?,'track',?,'Artist','','',?,?)",
    )
    .run(id, url, provider, id, duration, now);
const p = await api.changePlaylist(
  'alice',
  { action: 'create', name: 'Our songs' },
  now,
);
const id = p.id;
assert.equal(p.members.length, 1);
assert.equal(p.ownerId, 'alice');
assert.equal((await api.listPlaylists('alice')).playlists.length, 1);
await assert.rejects(api.readPlaylist('bob', id, now), (e) => e.status === 404);
await api.changePlaylist(
  'alice',
  { action: 'invite', id, handle: '@Bob' },
  now,
);
assert.equal((await api.listPlaylists('bob')).invitations.length, 1);
await assert.rejects(
  api.readPlaylist('bob', id, now),
  (e) => e.status === 404,
  'Pending invitations cannot read songs',
);
await assert.rejects(
  api.changePlaylist(
    'bob',
    { action: 'add', id, url: 'https://soundcloud.com/test/first' },
    now,
  ),
);
await api.changePlaylist('bob', { action: 'accept', id }, now);
assert.equal((await api.readPlaylist('bob', id, now)).members.length, 2);
await assert.rejects(
  api.changePlaylist('bob', { action: 'rename', id, name: 'stolen' }, now),
  (e) => e.status === 403,
);
await api.changePlaylist(
  'alice',
  { action: 'add', id, url: 'https://soundcloud.com/test/first' },
  now,
);
await api.changePlaylist(
  'bob',
  { action: 'add', id, url: 'https://soundcloud.com/test/second' },
  now + 1,
);
await api.changePlaylist(
  'bob',
  { action: 'add', id, url: 'https://soundcloud.com/test/second' },
  now + 2,
);
let detail = await api.readPlaylist('bob', id, now + 2);
assert.deepEqual(
  detail.tracks.map((t) => t.id),
  ['first', 'second'],
  'Both collaborators add songs and duplicate adds are idempotent',
);
assert.ok(
  detail.tracks.every((t) => !('audioUrl' in t)),
  'Private audio is never shared',
);
const a = 'room-alice-123456789',
  b = 'room-bob-123456789';
await api.changePlaylist(
  'alice',
  { action: 'join', id, session: a },
  now + 1000,
);
detail = await api.changePlaylist(
  'bob',
  { action: 'join', id, session: b },
  now + 1000,
);
assert.equal(detail.members.filter((m) => m.listening).length, 2);
assert.equal(
  detail.listenSession,
  b,
  'Only the requesting viewer receives their session',
);
assert.ok(detail.members.every((m) => !('listenSession' in m)));
const command = (
  user,
  session,
  command,
  revision,
  extra = {},
  at = now + 2000,
) =>
  api.changePlaylist(
    user,
    { action: 'control', id, session, command, revision, ...extra },
    at,
  );
detail = await command('alice', a, 'play', 0, { trackId: 'first' });
assert.equal(detail.playback.revision, 1);
assert.equal(
  (await api.readPlaylist('bob', id, now + 3000)).playback.trackId,
  'first',
);
await assert.rejects(
  command('bob', b, 'play', 0, { trackId: 'second' }),
  (e) => e.status === 409,
  'Simultaneous stale commands cannot overwrite the winner',
);
detail = await command('bob', b, 'pause', 1, {}, now + 12000);
assert.equal(detail.playback.playing, 0);
assert.equal(
  detail.playback.positionMs,
  10000,
  'Pause uses the server playback clock',
);
detail = await command(
  'alice',
  a,
  'seek',
  2,
  { positionMs: 42000 },
  now + 13000,
);
assert.equal(detail.playback.positionMs, 42000);
assert.equal(detail.playback.playing, 0);
detail = await command('bob', b, 'resume', 3, {}, now + 14000);
assert.equal(detail.playback.playing, 1);
await assert.rejects(
  command('alice', a, 'advance', 4, {}, now + 15000),
  (e) => e.status === 409,
  'End cannot skip a playing song early',
);
await api.changePlaylist(
  'alice',
  { action: 'heartbeat', id, session: a },
  now + 70000,
);
await api.changePlaylist(
  'bob',
  { action: 'heartbeat', id, session: b },
  now + 70000,
);
detail = await command('alice', a, 'advance', 4, {}, now + 92000);
assert.equal(detail.playback.trackId, 'second');
await assert.rejects(
  command('bob', b, 'advance', 4, {}, now + 92001),
  (e) => e.status === 409,
  'Only one end event advances the queue',
);
await assert.rejects(
  command('alice', a, 'seek', 5, { positionMs: -1 }, now + 92001),
  (e) => e.status === 400,
);
await api.changePlaylist(
  'bob',
  { action: 'join', id, session: 'replacement-bob-123456' },
  now + 93000,
);
await api.changePlaylist(
  'bob',
  { action: 'detach', id, session: b },
  now + 94000,
);
assert.equal(
  (await api.readPlaylist('bob', id, now + 94001)).listenSession,
  'replacement-bob-123456',
);
await assert.rejects(
  command('bob', b, 'pause', 5, {}, now + 94002),
  (e) => e.status === 409,
  'Old tabs cannot control or detach the replacement',
);
await api.changePlaylist(
  'alice',
  { action: 'kick', id, userId: 'bob' },
  now + 95000,
);
await assert.rejects(
  api.readPlaylist('bob', id, now + 95001),
  (e) => e.status === 404,
);
await assert.rejects(
  command('bob', 'replacement-bob-123456', 'pause', 5, {}, now + 95002),
  (e) => e.status === 404,
);
detail = await api.changePlaylist(
  'alice',
  { action: 'remove', id, trackId: 'second' },
  now + 96000,
);
assert.equal(detail.playback.trackId, null);
assert.equal(detail.playback.playing, 0);
assert.deepEqual(
  detail.tracks.map((t) => t.id),
  ['first'],
);
sqlite.exec(
  "INSERT INTO user_blocks(blocker,blocked,created) VALUES('carol','alice',1)",
);
await assert.rejects(
  api.changePlaylist(
    'alice',
    { action: 'invite', id, handle: 'carol' },
    now + 97000,
  ),
);
sqlite.exec('DELETE FROM user_blocks');
sqlite.exec(
  "INSERT INTO user_privacy(userId,messagePolicy) VALUES('carol','nobody')",
);
await assert.rejects(
  api.changePlaylist(
    'alice',
    { action: 'invite', id, handle: 'carol' },
    now + 97000,
  ),
  'Invitations respect privacy',
);
sqlite.exec(
  "UPDATE user_privacy SET messagePolicy='everyone' WHERE userId='carol'",
);
await api.changePlaylist(
  'alice',
  { action: 'invite', id, handle: 'carol' },
  now + 98000,
);
await api.changePlaylist('carol', { action: 'decline', id }, now + 98001);
assert.equal((await api.listPlaylists('carol')).invitations.length, 0);
await api.changePlaylist('alice', { action: 'delete', id }, now + 99000);
assert.equal(
  sqlite.prepare('SELECT COUNT(*) n FROM music_playlist_members').get().n,
  0,
);
assert.equal(
  sqlite.prepare('SELECT COUNT(*) n FROM music_playlist_tracks').get().n,
  0,
);
assert.equal(
  sqlite.prepare('SELECT COUNT(*) n FROM music_tracks').get().n,
  4,
  'Deleting a playlist preserves songs',
);
// The creation dialog saves its complete draft atomically, never a partial list.
sqlite
  .prepare('INSERT INTO music_library(userId,trackId,created) VALUES(?,?,?)')
  .run('alice', 'first', now);
sqlite
  .prepare('INSERT INTO music_library(userId,trackId,created) VALUES(?,?,?)')
  .run('alice', 'second', now);
const createdDraft = await api.changePlaylist(
  'alice',
  {
    action: 'create',
    name: 'From dialog',
    trackIds: ['second', 'first'],
    friendHandle: '@Bob',
  },
  now + 100000,
);
assert.deepEqual(
  createdDraft.tracks.map((t) => t.id),
  ['second', 'first'],
  'The selected song order is preserved',
);
assert.equal(
  createdDraft.members.find((m) => m.userId === 'bob').status,
  'invited',
);
const count = () =>
  sqlite.prepare('SELECT COUNT(*) n FROM music_playlists').get().n;
const beforeInvalid = count();
await assert.rejects(
  api.changePlaylist(
    'alice',
    {
      action: 'create',
      name: 'Invalid friend',
      trackIds: ['first'],
      friendHandle: 'missing-user',
    },
    now + 100001,
  ),
);
await assert.rejects(
  api.changePlaylist(
    'alice',
    { action: 'create', name: 'Not in library', trackIds: ['spotify'] },
    now + 100001,
  ),
);
await assert.rejects(
  api.changePlaylist(
    'alice',
    { action: 'create', name: 'Invalid songs', trackIds: 'first' },
    now + 100001,
  ),
);
assert.equal(
  count(),
  beforeInvalid,
  'Invalid draft settings never leave an empty playlist behind',
);
await api.changePlaylist(
  'alice',
  { action: 'delete', id: createdDraft.id },
  now + 100002,
);
// SoundCloud may only report the duration after the widget starts playing.
sqlite.prepare("UPDATE music_tracks SET durationMs=0 WHERE id='first'").run();
await checkMusicRoom(api, now + 200000);
const videoPlaylist = await api.changePlaylist(
  'alice',
  { action: 'create', name: 'Videos together' },
  now + 300000,
);
const videoId = videoPlaylist.id;
await api.changePlaylist(
  'alice',
  {
    action: 'add',
    id: videoId,
    url: 'https://music.youtube.com/watch?v=M7lc1UVf-VE&si=tracking',
  },
  now + 300001,
);
const videoSession = 'youtube-room-session-123';
await api.changePlaylist(
  'alice',
  { action: 'join', id: videoId, session: videoSession },
  now + 300002,
);
let videoDetail = await api.changePlaylist(
  'alice',
  {
    action: 'control',
    id: videoId,
    session: videoSession,
    command: 'play',
    trackId: 'youtube',
    revision: 0,
  },
  now + 300003,
);
assert.equal(videoDetail.tracks[0].provider, 'youtube');
assert.equal(
  videoDetail.tracks[0].url,
  'https://www.youtube.com/watch?v=M7lc1UVf-VE',
);
videoDetail = await api.changePlaylist(
  'alice',
  {
    action: 'control',
    id: videoId,
    session: videoSession,
    command: 'seek',
    positionMs: 16000,
    revision: videoDetail.playback.revision,
  },
  now + 300004,
);
assert.equal(videoDetail.playback.positionMs, 16000);
assert.equal(videoDetail.playback.playing, 1);
await api.changePlaylist(
  'alice',
  { action: 'delete', id: videoId },
  now + 300005,
);
// Durable ordering, simultaneous edits and the heart's per-playlist membership.
sqlite
  .prepare(
    "INSERT INTO music_tracks(id,url,provider,kind,title,artist,artwork,authorUrl,durationMs,created) VALUES('fifth','https://soundcloud.com/test/fifth','soundcloud','track','Fifth','Artist','','',120000,?)",
  )
  .run(now);
const orderedList = await api.changePlaylist(
  'alice',
  { action: 'create', name: 'Ordered favorites' },
  now + 400000,
);
const orderedId = orderedList.id;
const trackIds = ['first', 'second', 'youtube', 'spotify', 'fifth'];
for (const [index, trackId] of trackIds.entries()) {
  const url = sqlite
    .prepare('SELECT url FROM music_tracks WHERE id=?')
    .get(trackId).url;
  await api.changePlaylist(
    'alice',
    { action: 'add', id: orderedId, url },
    now + 400001 + index,
  );
}
let ordered = await api.changePlaylist(
  'alice',
  { action: 'reorder', id: orderedId, trackId: 'fifth', targetId: 'youtube' },
  now + 400010,
);
assert.deepEqual(
  ordered.tracks.map((t) => t.id),
  ['first', 'second', 'fifth', 'youtube', 'spotify'],
);
assert.deepEqual(
  (await api.readPlaylist('alice', orderedId)).tracks.map((t) => t.id),
  ordered.tracks.map((t) => t.id),
  'Order survives reading the playlist again',
);
await assert.rejects(
  api.changePlaylist('carol', {
    action: 'reorder',
    id: orderedId,
    trackId: 'first',
    targetId: 'fifth',
  }),
  (e) => e.status === 404,
);
await assert.rejects(
  api.changePlaylist('alice', {
    action: 'reorder',
    id: orderedId,
    trackId: 'missing',
    targetId: 'fifth',
  }),
  (e) => e.status === 409,
);
globalThis.__beforeReorder = () =>
  sqlite
    .prepare(
      'UPDATE music_playlist_tracks SET sortOrder=200-sortOrder WHERE playlistId=?',
    )
    .run(orderedId);
await assert.rejects(
  api.changePlaylist('alice', {
    action: 'reorder',
    id: orderedId,
    trackId: 'first',
    targetId: 'fifth',
  }),
  (e) => e.status === 409,
  'An edit during the request is not overwritten',
);
assert.deepEqual(
  (await api.readPlaylist('alice', orderedId)).tracks.map((t) => t.id),
  ['spotify', 'youtube', 'fifth', 'second', 'first'],
);
await api.changePlaylist(
  'alice',
  { action: 'invite', id: orderedId, handle: '@bob' },
  now + 400020,
);
await api.changePlaylist(
  'bob',
  { action: 'accept', id: orderedId },
  now + 400021,
);
ordered = await api.changePlaylist(
  'bob',
  { action: 'reorder', id: orderedId, trackId: 'first', targetId: 'spotify' },
  now + 400022,
);
assert.equal(
  ordered.tracks[0].id,
  'first',
  'Accepted collaborators can reorder',
);
const favorites = await api.trackPlaylists(
  'alice',
  'https://soundcloud.com/test/fifth',
);
assert.equal(
  favorites.playlists.find((p) => p.id === orderedId).savedTrackId,
  'fifth',
);
assert.equal(
  (
    await api.trackPlaylists('bob', 'https://soundcloud.com/test/fifth')
  ).playlists.some((p) => p.id === orderedId),
  false,
  'Heart choices only include your own playlists',
);
await api.changePlaylist(
  'alice',
  { action: 'remove', id: orderedId, trackId: 'fifth' },
  now + 400023,
);
assert.equal(
  (
    await api.trackPlaylists('alice', 'https://soundcloud.com/test/fifth')
  ).playlists.find((p) => p.id === orderedId).savedTrackId,
  null,
);
await api.changePlaylist(
  'alice',
  { action: 'add', id: orderedId, url: 'https://soundcloud.com/test/fifth' },
  now + 400024,
);
assert.equal(
  (await api.readPlaylist('alice', orderedId)).tracks.at(-1).id,
  'fifth',
  'A newly added song goes after the reordered songs',
);
await assert.rejects(
  api.trackPlaylists('alice', 'https://example.com/private'),
  (e) => e.status === 400,
);
await api.changePlaylist(
  'alice',
  { action: 'delete', id: orderedId },
  now + 400025,
);
sqlite.close();
delete globalThis.__activityDb;
console.log(
  'Shared playlists: invitations, permissions, collaboration, server clock, concurrent controls, pause/seek/resume, end-of-track, session replacement, privacy and deletion passed.',
);
