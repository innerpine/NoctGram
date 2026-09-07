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
      "export * from './lib/music-services'; export * from './lib/music-token-crypto';",
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
    });
  }
  assert.match(init.headers.Authorization, /^(OAuth|Bearer) access-/);
  if (target === 'https://api.soundcloud.com/me')
    return Response.json({
      id: 42,
      username: 'QA Owner',
      permalink_url: 'https://soundcloud.com/qa-owner',
    });
  if (target === 'https://api.spotify.com/v1/me')
    return Response.json({
      id: 'qa-spotify',
      display_name: 'Spotify Owner',
      external_urls: { spotify: 'https://open.spotify.com/user/qa-spotify' },
    });
  if (target.startsWith('https://api.soundcloud.com/me/playlists'))
    return Response.json({ collection: [scPlaylist], next_href: nextHref });
  if (target.startsWith('https://api.soundcloud.com/playlists/1'))
    return Response.json(scPlaylist);
  const spPlaylist = {
    id: 'abc123',
    name: 'Spotify personal',
    external_urls: { spotify: 'https://open.spotify.com/playlist/abc123' },
    tracks: { total: 4 },
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
  await service.importServicePlaylist('alice', provider, '1');
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
  await service.importServicePlaylist('alice', 'spotify', 'abc123');
  await service.disconnectMusic('alice', 'spotify');
  assert.equal((await service.importedPlaylists('alice', 'spotify')).length, 0);
  console.log(
    'Music services passed: PKCE, encrypted tokens, state replay/browser/user binding, private import, signed pagination, single refresh, disconnect races, and Spotify metadata-only behavior.',
  );
} finally {
  globalThis.fetch = realFetch;
  sqlite.close();
  delete globalThis.__musicFixture;
}
