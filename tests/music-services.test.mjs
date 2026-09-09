import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';

// The real service implementation, real migrations and real encryption run against
// an isolated SQLite database. Only provider HTTP and runtime bindings are replaced.
const sqlite = new DatabaseSync(':memory:');
for (const file of (await readdir(new URL('../drizzle/', import.meta.url)))
  .filter((f) => f.endsWith('.sql'))
  .sort())
  sqlite.exec(
    await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8'),
  );
sqlite.exec(
  "INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1)",
);
function statement(sql) {
  let args = [];
  return {
    bind(...values) {
      args = values;
      return this;
    },
    async first() {
      return sqlite.prepare(sql).get(...args) || null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...args) };
    },
    async run() {
      return {
        meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) },
      };
    },
  };
}
const settings = {};
globalThis.__musicFixture = {
  settings,
  db: {
    prepare: statement,
    async batch(statements) {
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
    },
  },
};
const result = await build({
  stdin: {
    contents:
      "export * from './lib/music-services'; export * from './lib/music-token-crypto'; export * from './lib/yandex-music';",
    resolveDir: new URL('..', import.meta.url).pathname.replace(
      /^\/([A-Z]:)/,
      '$1',
    ),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'test-runtime',
      setup(builder) {
        builder.onResolve(
          { filter: /^\.\/(storage|auth-session|account-access)$/ },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === './storage'
              ? 'export function db() { return globalThis.__musicFixture.db; }'
              : args.path === './account-access'
                ? 'export async function assertWritable() {}'
                : `
    export const setting = name => globalThis.__musicFixture.settings[name] || '';
    export const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2,'0')).join('');
    export const tokenHash = async v => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))].map(b => b.toString(16).padStart(2,'0')).join('');
    export const cookieValue = (value, name) => value?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1) || '';
    export const authCookie = (req,name,value,seconds) => name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+seconds;
  `,
        }));
      },
    },
  ],
});
const service = await import(
  'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64')
);
const provider = 'soundcloud',
  url = 'http://localhost:3000/api/music/services/soundcloud/connect';
const post = new Request(url, { method: 'POST' });
assert.equal(
  (await service.musicServiceStatus('alice')).find(
    (s) => s.provider === provider,
  ).status,
  'setup_required',
);
await assert.rejects(
  service.connectMusic(post, 'alice', provider),
  (e) => e.status === 503,
);
Object.assign(settings, {
  MUSIC_TOKEN_KEY: '12'.repeat(32),
  SOUNDCLOUD_CLIENT_ID: 'test-client',
  SOUNDCLOUD_CLIENT_SECRET: 'test-secret',
  SOUNDCLOUD_REDIRECT_URI:
    'http://localhost:3000/api/music/services/soundcloud/callback',
  SPOTIFY_CLIENT_ID: 'test-spotify',
  SPOTIFY_REDIRECT_URI:
    'http://127.0.0.1:3000/api/music/services/spotify/callback',
});
const envelope = await service.sealMusicToken(
  { value: 'test secret' },
  settings.MUSIC_TOKEN_KEY,
  'alice',
);
assert.ok(!envelope.includes('test secret'));
assert.deepEqual(
  await service.openMusicToken(envelope, settings.MUSIC_TOKEN_KEY, 'alice'),
  { value: 'test secret' },
);
await assert.rejects(
  service.openMusicToken(envelope, settings.MUSIC_TOKEN_KEY, 'bob'),
);
await assert.rejects(
  service.openMusicToken(envelope, '34'.repeat(32), 'alice'),
);
assert.equal(
  await service.musicPKCE('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
);

let tokensIssued = 0,
  refreshCalls = 0,
  pauseExchange = null,
  nextHref = 'https://api.soundcloud.com/me/playlists?cursor=next&limit=20';
const realFetch = globalThis.fetch;
const scPlaylist = {
  id: 1,
  title: 'Private test playlist',
  sharing: 'private',
  permalink_url: 'https://soundcloud.com/qa-owner/sets/private',
  track_count: 3,
};
let importPageMode = 'normal';
const importTrack = (id, sharing = 'public') => ({
  id,
  sharing,
  kind: 'track',
  streamable: true,
  access: 'playable',
  title: 'Imported song ' + id,
  duration: 120000,
  permalink_url:
    'https://soundcloud.com/qa-owner/imported-' +
    id +
    '?utm_medium=api&utm_source=id_fixture',
  user: {
    username: 'QA Owner',
    permalink_url:
      'https://soundcloud.com/qa-owner?utm_medium=api&utm_source=id_fixture',
  },
});
globalThis.fetch = async (input, init) => {
  const target =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  assert.equal(init.redirect, 'manual');
  if (target.endsWith('/oauth/token') || target.endsWith('/api/token')) {
    const body = new URLSearchParams(init.body);
    if (body.get('grant_type') === 'refresh_token') {
      refreshCalls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } else assert.ok(body.get('code_verifier').length >= 43);
    if (target.includes('soundcloud'))
      assert.equal(body.get('client_secret'), 'test-secret');
    if (pauseExchange) {
      const fn = pauseExchange;
      pauseExchange = null;
      await fn();
    }
    tokensIssued++;
    return Response.json({
      access_token: 'access-' + tokensIssued,
      refresh_token: 'refresh-' + tokensIssued,
      expires_in: 3600,
      ...(target.includes('spotify') &&
      body.get('grant_type') !== 'refresh_token'
        ? { scope: service.SPOTIFY_PLAYBACK_SCOPES }
        : {}),
    });
  }
  assert.match(init.headers.Authorization, /^(OAuth|Bearer) access-/);
  if (target === 'https://api.soundcloud.com/me')
    return Response.json({
      id: 42,
      username: 'QA Owner',
      permalink_url: 'https://soundcloud.com/qa-owner',
    });
  if (target.startsWith('https://api.soundcloud.com/tracks?')) {
    const query = new URL(target).searchParams;
    assert.equal(query.get('q'), 'vendetta');
    assert.equal(query.get('access'), 'playable');
    const track = {
      id: 12,
      title: 'Vendetta!',
      duration: 107000,
      access: 'playable',
      permalink_url: 'https://soundcloud.com/sadfriendd/vendetta',
      user: {
        username: 'Sadfriendd',
        permalink_url: 'https://soundcloud.com/sadfriendd',
      },
    };
    return Response.json({
      collection: [
        track,
        { ...track, access: 'preview' },
        { ...track, sharing: 'private' },
        { ...track, permalink_url: 'https://evil.example/track' },
      ],
    });
  }
  if (target === 'https://api.spotify.com/v1/me')
    return Response.json({
      id: 'qa-spotify',
      display_name: 'Spotify Owner',
      external_urls: { spotify: 'https://open.spotify.com/user/qa-spotify' },
    });
  if (target.startsWith('https://api.soundcloud.com/me/playlists'))
    return Response.json({ collection: [scPlaylist], next_href: nextHref });
  if (
    target.startsWith(
      'https://api.soundcloud.com/playlists/soundcloud%3Aplaylists%3A1/tracks',
    )
  ) {
    if (target.includes('cursor=next')) {
      if (importPageMode === 'fail')
        return Response.json({ error: 'temporary' }, { status: 503 });
      return Response.json({
        collection: [importTrack(13), importTrack(14, 'private')],
        next_href: null,
      });
    }
    return Response.json({
      collection: [importTrack(12)],
      next_href:
        importPageMode === 'foreign'
          ? 'https://evil.example/steal'
          : 'https://api.soundcloud.com/playlists/soundcloud%3Aplaylists%3A1/tracks?cursor=next',
    });
  }
  if (target.startsWith('https://api.soundcloud.com/playlists/1'))
    return Response.json(scPlaylist);
  const spPlaylist = {
    id: 'abc123',
    name: 'Spotify personal',
    external_urls: { spotify: 'https://open.spotify.com/playlist/abc123' },
    items: { total: 4 },
  };
  if (target.startsWith('https://api.spotify.com/v1/me/playlists'))
    return Response.json({ items: [spPlaylist], next: null });
  if (target === 'https://api.spotify.com/v1/playlists/abc123')
    return Response.json(spPlaylist);
  throw new Error('Unexpected provider request ' + target);
};
async function start(user = 'alice', p = provider) {
  const origin =
    p === 'spotify' ? 'http://127.0.0.1:3000' : 'http://localhost:3000';
  const response = await service.connectMusic(
    new Request(origin + `/api/music/services/${p}/connect`, {
      method: 'POST',
    }),
    user,
    p,
  );
  const auth = new URL((await response.json()).authorizationUrl),
    cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.has('client_secret'), false);
  return new Request(
    origin +
      `/api/music/services/${p}/callback?code=test-code&state=` +
      auth.searchParams.get('state'),
    { headers: { cookie } },
  );
}
try {
  const callback = await start();
  await assert.rejects(
    service.finishMusicConnection(callback, 'bob', provider),
    (e) => e.status === 400,
  );
  await assert.rejects(
    service.finishMusicConnection(new Request(callback.url), 'alice', provider),
    (e) => e.status === 400,
  );
  const finished = await service.finishMusicConnection(
    callback,
    'alice',
    provider,
  );
  assert.equal(finished.status, 303);
  assert.ok(finished.headers.get('location').includes('result=connected'));
  await assert.rejects(
    service.finishMusicConnection(callback, 'alice', provider),
    (e) => e.status === 400,
  );
  const row = sqlite
    .prepare('SELECT * FROM music_connections WHERE userId=?')
    .get('alice');
  assert.equal(row.accountId, '42');
  assert.ok(!row.sealedTokens.includes('access-'));
  const publicStatus = JSON.stringify(
    await service.musicServiceStatus('alice'),
  );
  for (const key of [
    'access_token',
    'refresh_token',
    'sealedTokens',
    'test-secret',
  ])
    assert.ok(!publicStatus.includes(key));
  assert.equal(
    (await service.musicServiceStatus('bob')).find(
      (s) => s.provider === provider,
    ).status,
    'disconnected',
  );
  const page = await service.servicePlaylists('alice', provider, '');
  const searched = await service.searchServiceTracks(
    'alice',
    provider,
    ' vendetta ',
  );
  assert.equal(searched.length, 1);
  assert.equal(searched[0].durationMs, 107000);
  await assert.rejects(
    service.searchServiceTracks('bob', provider, 'vendetta'),
    (error) => error.code === 'MUSIC_NOT_CONNECTED',
  );
  await assert.rejects(
    service.searchServiceTracks('alice', provider, 'x'.repeat(151)),
    (error) => error.status === 400,
  );
  assert.equal(page.items[0].playable, false);
  assert.ok(page.next && !page.next.includes('api.soundcloud.com'));
  await service.servicePlaylists('alice', provider, page.next);
  await assert.rejects(
    service.servicePlaylists('bob', provider, page.next),
    (e) => e.status === 400,
  );
  nextHref = 'https://evil.example/steal';
  assert.equal(
    (await service.servicePlaylists('alice', provider, '')).next,
    null,
  );
  const copied = await service.importServicePlaylist('alice', provider, '1');
  assert.ok(copied.localPlaylistId);
  assert.equal(copied.importedTrackCount, 2);
  assert.equal(
    sqlite
      .prepare(
        "SELECT authorUrl FROM music_tracks WHERE url='https://soundcloud.com/qa-owner/imported-12'",
      )
      .get().authorUrl,
    'https://soundcloud.com/qa-owner',
  );
  assert.equal(
    sqlite
      .prepare('SELECT ownerId FROM music_playlists WHERE id=?')
      .get(copied.localPlaylistId).ownerId,
    'alice',
  );
  assert.deepEqual(
    sqlite
      .prepare(
        'SELECT t.title FROM music_playlist_tracks pt JOIN music_tracks t ON t.id=pt.trackId WHERE pt.playlistId=? ORDER BY pt.sortOrder',
      )
      .all(copied.localPlaylistId)
      .map((t) => t.title),
    ['Imported song 12', 'Imported song 13'],
  );
  sqlite
    .prepare(
      'UPDATE music_playlist_tracks SET sortOrder=1-sortOrder WHERE playlistId=?',
    )
    .run(copied.localPlaylistId);
  assert.equal(
    (await service.importServicePlaylist('alice', provider, '1'))
      .localPlaylistId,
    copied.localPlaylistId,
  );
  assert.deepEqual(
    sqlite
      .prepare(
        'SELECT t.title FROM music_playlist_tracks pt JOIN music_tracks t ON t.id=pt.trackId WHERE pt.playlistId=? ORDER BY pt.sortOrder',
      )
      .all(copied.localPlaylistId)
      .map((t) => t.title),
    ['Imported song 13', 'Imported song 12'],
    'Reimport preserves local edits',
  );
  sqlite
    .prepare('DELETE FROM music_playlists WHERE id=?')
    .run(copied.localPlaylistId);
  assert.equal(
    (await service.importedPlaylists('alice', provider))[0].localPlaylistId,
    null,
  );
  for (const mode of ['fail', 'foreign']) {
    importPageMode = mode;
    await assert.rejects(service.importServicePlaylist('alice', provider, '1'));
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS n FROM music_playlists').get().n,
      0,
      'A failed page never produces a partial playlist',
    );
  }
  importPageMode = 'normal';
  assert.equal(
    (await service.importServicePlaylist('alice', provider, '1'))
      .importedTrackCount,
    2,
  );
  assert.equal((await service.importedPlaylists('alice', provider)).length, 1);
  assert.equal((await service.importedPlaylists('bob', provider)).length, 0);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM music_library').get().n,
    0,
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM music_listens').get().n,
    0,
  );
  sqlite.exec("UPDATE music_connections SET expiresAt=0 WHERE userId='alice'");
  const parallel = await Promise.allSettled([
    service.servicePlaylists('alice', provider, ''),
    service.servicePlaylists('alice', provider, ''),
  ]);
  assert.equal(refreshCalls, 1);
  assert.ok(parallel.some((r) => r.status === 'fulfilled'));
  // Disconnect during refresh cannot resurrect a deleted connection.
  sqlite.exec("UPDATE music_connections SET expiresAt=0 WHERE userId='alice'");
  pauseExchange = () => service.disconnectMusic('alice', provider);
  await assert.rejects(service.servicePlaylists('alice', provider, ''));
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM music_connections').get().n,
    0,
  );
  assert.equal((await service.importedPlaylists('alice', provider)).length, 0);
  // Disconnect during an OAuth callback also cancels the in-flight connection.
  const pending = await start();
  pauseExchange = () => service.disconnectMusic('alice', provider);
  await assert.rejects(
    service.finishMusicConnection(pending, 'alice', provider),
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM music_connections').get().n,
    0,
  );
  const spotifyCallback = await start('alice', 'spotify');
  assert.equal(
    (await service.finishMusicConnection(spotifyCallback, 'alice', 'spotify'))
      .status,
    303,
  );
  const sp = await service.servicePlaylists('alice', 'spotify', '');
  assert.equal(sp.items[0].playable, false);
  assert.equal(sp.items[0].trackCount, 4, '2026 Spotify playlist items field');
  const playbackToken = await service.spotifyPlaybackToken('alice');
  assert.ok(playbackToken.accessToken.startsWith('access-'));
  assert.deepEqual(Object.keys(playbackToken).sort(), [
    'accessToken',
    'expiresAt',
  ]);
  await assert.rejects(
    service.spotifyPlaybackToken('bob'),
    (e) => e.code === 'MUSIC_NOT_CONNECTED',
  );
  const spotifyRow = sqlite
    .prepare(
      "SELECT * FROM music_connections WHERE userId='alice' AND provider='spotify'",
    )
    .get();
  const oldTokens = await service.openMusicToken(
    spotifyRow.sealedTokens,
    settings.MUSIC_TOKEN_KEY,
    JSON.stringify(['music', 'alice', 'spotify']),
  );
  const oldSealed = await service.sealMusicToken(
    { ...oldTokens, scope: 'playlist-read-private' },
    settings.MUSIC_TOKEN_KEY,
    JSON.stringify(['music', 'alice', 'spotify']),
  );
  sqlite
    .prepare(
      "UPDATE music_connections SET sealedTokens=? WHERE userId='alice' AND provider='spotify'",
    )
    .run(oldSealed);
  await assert.rejects(
    service.spotifyPlaybackToken('alice'),
    (e) => e.code === 'MUSIC_RECONNECT',
  );
  sqlite
    .prepare(
      "UPDATE music_connections SET sealedTokens=?,expiresAt=0 WHERE userId='alice' AND provider='spotify'",
    )
    .run(spotifyRow.sealedTokens);
  assert.ok(
    (await service.spotifyPlaybackToken('alice')).expiresAt > Date.now(),
  );
  await service.importServicePlaylist('alice', 'spotify', 'abc123');
  await service.disconnectMusic('alice', 'spotify');
  assert.equal((await service.importedPlaylists('alice', 'spotify')).length, 0);
  await assert.rejects(
    service.spotifyPlaybackToken('alice'),
    (e) => e.code === 'MUSIC_NOT_CONNECTED',
  );
  let yandexList = [
    {
      kind: 3,
      title: 'Personal',
      trackCount: 1,
      owner: { uid: 123 },
      cover: { uri: 'avatars.yandex.net/get-music-content/1/%%' },
    },
  ];
  let pauseYandex = null;
  let unauthorized = false;
  let playlistStatus = 200;
  globalThis.fetch = async (url, init) => {
    assert.ok(url.startsWith('https://api.music.yandex.net/'));
    assert.equal(init.headers.Authorization, 'OAuth own-yandex-token-test');
    assert.equal(init.redirect, 'manual');
    if (pauseYandex) {
      const callback = pauseYandex;
      pauseYandex = null;
      await callback();
    }
    if (unauthorized) return new Response(null, { status: 401 });
    if (url.endsWith('/account/status'))
      return Response.json({
        result: { account: { uid: 123, displayName: 'Yandex Owner' } },
      });
    if (url.endsWith('/users/123/playlists/list') && playlistStatus !== 200)
      return new Response(null, { status: playlistStatus });
    if (url.endsWith('/users/123/playlists/list'))
      return Response.json({ result: yandexList });
    if (url.endsWith('/users/123/playlists/3'))
      return Response.json({
        result: {
          kind: 3,
          tracks: [
            {
              track: {
                id: 42,
                title: 'Recording',
                artists: [{ name: 'Artist' }],
                durationMs: 107000,
              },
            },
          ],
        },
      });
    throw new Error('Unexpected Yandex path');
  };
  await assert.rejects(
    service.connectYandex('alice', 'bad\r\ntoken'),
    (e) => e.status === 400,
  );
  await service.connectYandex('alice', 'own-yandex-token-test');
  assert.equal((await service.yandexStatus('alice')).status, 'connected');
  assert.equal(
    (await service.musicServiceStatus('alice')).find(
      (x) => x.provider === 'yandex',
    ).status,
    'connected',
  );
  assert.ok(
    !JSON.stringify(
      sqlite
        .prepare("SELECT * FROM music_connections WHERE provider='yandex'")
        .get(),
    ).includes('own-yandex-token-test'),
  );
  await service.syncYandex('alice');
  assert.equal((await service.yandexPlaylists('alice')).length, 1);
  assert.equal((await service.yandexPlaylists('bob')).length, 0);
  playlistStatus = 451;
  await assert.rejects(
    service.syncYandex('alice'),
    (e) => e.code === 'YANDEX_ACCESS_RESTRICTED',
  );
  assert.equal(
    (await service.yandexStatus('alice')).status,
    'connected',
    'Regional denial does not invalidate the token',
  );
  assert.equal(
    (await service.yandexPlaylists('alice')).length,
    1,
    'Failed sync preserves the existing library',
  );
  playlistStatus = 503;
  await assert.rejects(
    service.syncYandex('alice'),
    (e) => e.code === 'YANDEX_HTTP_503',
  );
  playlistStatus = 200;
  assert.equal(
    (await service.yandexTracks('alice', '3')).items[0].title,
    'Recording',
  );
  await assert.rejects(
    service.yandexTracks('bob', '3'),
    (e) => e.code === 'MUSIC_NOT_CONNECTED',
  );
  await assert.rejects(
    service.yandexTracks('alice', '../account/status'),
    (e) => e.status === 400,
  );
  for (const bad of [
    'https://evil.example/cover',
    'https://avatars.yandex.net.evil.example/cover',
    'https://token@avatars.yandex.net/cover',
  ])
    assert.equal(service.yandexArtwork(bad), '');
  yandexList = [];
  await service.syncYandex('alice');
  assert.equal(
    (await service.yandexPlaylists('alice')).length,
    0,
    'Deleted playlists disappear on sync',
  );
  unauthorized = true;
  await assert.rejects(
    service.syncYandex('alice'),
    (e) => e.code === 'MUSIC_RECONNECT',
  );
  assert.equal((await service.yandexStatus('alice')).status, 'expired');
  unauthorized = false;
  await service.connectYandex('alice', 'own-yandex-token-test');
  pauseYandex = () => service.disconnectYandex('alice');
  await assert.rejects(service.syncYandex('alice'));
  assert.equal((await service.yandexPlaylists('alice')).length, 0);
  pauseYandex = () => service.disconnectYandex('alice');
  await assert.rejects(service.connectYandex('alice', 'own-yandex-token-test'));
  assert.equal((await service.yandexStatus('alice')).status, 'disconnected');
  console.log(
    'Music services passed: PKCE, encrypted tokens, private imports, refresh/disconnect races, Spotify SDK scopes/tokens and experimental Yandex playlist sync.',
  );
} finally {
  globalThis.fetch = realFetch;
  sqlite.close();
  delete globalThis.__musicFixture;
}
