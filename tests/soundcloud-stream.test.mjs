import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(await readFile('drizzle/0029_music_app_tokens.sql', 'utf8'));
const settings = {};
let holdTokenRead;
globalThis.__scTest = {
  settings,
  db: {
    prepare(sql) {
      let args = [];
      return {
        bind(...v) {
          args = v;
          return this;
        },
        async first() {
          if (holdTokenRead && sql.startsWith('SELECT * FROM music_app_tokens')) {
            const hold = holdTokenRead;
            holdTokenRead = null;
            await hold;
          }
          return sqlite.prepare(sql).get(...args) || null;
        },
        async run() {
          return {
            meta: { changes: sqlite.prepare(sql).run(...args).changes },
          };
        },
      };
    },
  },
};
const bundle = await build({
  entryPoints: ['lib/soundcloud-stream.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'runtime',
      setup(b) {
        b.onResolve({ filter: /^\.\/(storage|auth-session)$/ }, (args) => ({
          path: args.path,
          namespace: 'runtime',
        }));
        b.onLoad({ filter: /.*/, namespace: 'runtime' }, (args) => ({
          contents:
            args.path === './storage'
              ? 'export const db = () => globalThis.__scTest.db;'
              : 'export const setting = key => globalThis.__scTest.settings[key] || "";',
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
assert.equal(api.soundcloudStreamingConfigured(), false);
await assert.rejects(api.soundcloudTrack('https://soundcloud.com/fixture/a'), {
  code: 'MUSIC_SETUP_REQUIRED',
});
Object.assign(settings, {
  SOUNDCLOUD_CLIENT_ID: 'fixture-client',
  SOUNDCLOUD_CLIENT_SECRET: 'fixture-secret',
  MUSIC_TOKEN_KEY: 'ab'.repeat(32),
});
let tokens = 0,
  refreshes = 0,
  failRefresh = false,
  resolveRedirect = false,
  maliciousRedirect = false,
  streamRedirect = 'https://cf-hls-media.sndcdn.com/fixture/playlist.m3u8',
  access = 'playable',
  sharing = 'public',
  onlyPreview = false;
const network = [];
let holdResource;
globalThis.fetch = async (input, options) => {
  const u = new URL(input);
  network.push(u.origin + u.pathname);
  assert.equal(options.redirect, 'manual');
  if (u.origin === 'https://secure.soundcloud.com') {
    const body = new URLSearchParams(options.body);
    if (body.get('grant_type') === 'client_credentials') {
      assert.equal(
        options.headers.Authorization,
        'Basic ' + btoa('fixture-client:fixture-secret'),
      );
      tokens++;
    } else {
      refreshes++;
      assert.equal(body.get('refresh_token'), 'refresh-' + tokens);
      if (failRefresh) throw Error('network timeout');
    }
    return Response.json({
      access_token: 'access-' + tokens + '-' + refreshes,
      refresh_token: 'refresh-' + tokens,
      expires_in: 3600,
    });
  }
  assert.equal(
    u.origin,
    'https://api.soundcloud.com',
    'Never send authorization to a CDN or arbitrary redirect',
  );
  assert.match(options.headers.Authorization, /^OAuth access-/);
  if (holdResource && u.pathname === '/resolve') {
    const hold = holdResource;
    holdResource = null;
    await hold;
  }
  if (u.pathname === '/tracks') {
    assert.equal(u.searchParams.get('q'), 'FACE антидепрессант');
    assert.equal(u.searchParams.get('access'), 'playable');
    assert.equal(u.searchParams.get('limit'), '20');
    assert.ok(['0', '20'].includes(u.searchParams.get('offset')));
    const track = {
      kind: 'track',
      sharing: 'public',
      access: 'playable',
      streamable: true,
      urn: 'soundcloud:tracks:42',
      title: 'Антидепрессант',
      permalink_url: 'https://soundcloud.com/face/song?utm_source=test',
      duration: 123000,
      artwork_url: 'https://i1.sndcdn.com/cover.jpg',
      user: {
        username: 'FACE',
        permalink_url: 'https://soundcloud.com/face?utm_source=test',
      },
    };
    return Response.json({
      collection: [
        track,
        {
          ...track,
          urn: 'soundcloud:tracks:43',
          permalink_url: 'https://soundcloud.com/face/private',
          sharing: 'private',
        },
        { id: 4 },
        { ...track, access: 'preview' },
        { ...track, access: 'blocked' },
        { ...track, streamable: false },
        { ...track, permalink_url: 'https://evil.test/song' },
        track,
      ],
      next_href:
        u.searchParams.get('offset') === '0'
          ? 'https://api.soundcloud.com/tracks?cursor=next'
          : null,
    });
  }
  if (u.pathname === '/resolve' && (resolveRedirect || maliciousRedirect))
    return new Response(null, {
      status: 302,
      headers: {
        Location: maliciousRedirect
          ? 'https://evil.test/leak'
          : 'https://api.soundcloud.com/tracks/soundcloud:tracks:123',
      },
    });
  if (u.pathname.endsWith('/streams'))
    return Response.json(
      onlyPreview
        ? { preview_mp3_128_url: 'https://api.soundcloud.com/preview' }
        : {
            hls_mp3_128_url:
              'https://api.soundcloud.com/tracks/123/streams/full',
          },
    );
  if (u.pathname.endsWith('/streams/full'))
    return new Response(null, {
      status: 302,
      headers: { Location: streamRedirect },
    });
  return Response.json({
    kind: 'track',
    sharing,
    access,
    streamable: true,
    urn: 'soundcloud:tracks:123',
    title: 'Fixture',
    duration: 42000,
    artwork_url: 'https://i1.sndcdn.com/fixture.jpg',
    user: {
      username: 'Artist',
      permalink_url: 'https://soundcloud.com/fixture',
    },
  });
};
const url = (suffix) => 'https://soundcloud.com/fixture/' + suffix;
const tracks = await Promise.all(
  Array.from({ length: 8 }, (_, i) =>
    api.soundcloudTrack(url('parallel-' + i)),
  ),
);
assert.equal(tokens, 1, 'Concurrent requests share one app token');
async function independentRequest(first, second, release, message) {
  let timer;
  try {
    await Promise.race([
      second(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    release();
    await first;
  }
}
// A disconnected Worker request can leave its I/O promise unresolved. Another
// request must read the saved credential itself rather than join that promise.
let releaseToken;
holdTokenRead = new Promise((resolve) => (releaseToken = resolve));
const strandedToken = api.soundcloudTrack(url('stranded-token'));
await independentRequest(
  strandedToken,
  () => api.soundcloudTrack(url('after-stranded-token')),
  releaseToken,
  'A pending token read must not block every subsequent track',
);
let releaseResource;
holdResource = new Promise((resolve) => (releaseResource = resolve));
const strandedResource = api.soundcloudTrack(url('stranded-resource'));
await new Promise((resolve) => setTimeout(resolve, 10));
await independentRequest(
  strandedResource,
  () => api.soundcloudTrack(url('stranded-resource')),
  releaseResource,
  'Retrying a track must not join its previous unfinished request',
);
const beforeCached = network.length;
await api.soundcloudTrack(url('stranded-resource'));
assert.equal(network.length, beforeCached, 'Completed metadata remains cached');
const searched = await api.searchSoundCloud(' FACE антидепрессант ');
assert.equal(searched.items.length, 1);
assert.equal(searched.items[0].url, 'https://soundcloud.com/face/song');
assert.equal(searched.items[0].authorUrl, 'https://soundcloud.com/face');
assert.equal(searched.items[0].durationMs, 123000);
assert.equal(searched.items[0].playback, 'soundcloud');
assert.equal(searched.nextPage, '2');
assert.equal(
  (await api.searchSoundCloud('FACE антидепрессант', '2')).nextPage,
  null,
);
assert.equal(
  tokens,
  1,
  'Search shares the existing app token without a connected personal account',
);
for (const q of ['', '   ', 'x'.repeat(151), null])
  await assert.rejects(api.searchSoundCloud(q), { status: 400 });
for (const page of ['0', '-1', '1.5', '21', 'https://evil.test'])
  await assert.rejects(api.searchSoundCloud('FACE антидепрессант', page), {
    status: 400,
  });
assert.equal(tracks[0].playback, 'soundcloud');
assert.equal(tracks[0].durationMs, 42000);
assert.equal(await api.soundcloudStream(url('parallel-0')), streamRedirect);
const stored = sqlite.prepare('SELECT * FROM music_app_tokens').get();
assert.ok(stored.sealedTokens.startsWith('v1.'));
assert.ok(!stored.sealedTokens.includes('access-'));
resolveRedirect = true;
await api.soundcloudTrack(url('redirect'));
resolveRedirect = false;
maliciousRedirect = true;
await assert.rejects(api.soundcloudTrack(url('evil')), {
  code: 'SOUNDCLOUD_UNAVAILABLE',
});
assert.ok(!network.some((u) => u.includes('evil.test')));
maliciousRedirect = false;
for (const mode of ['preview', 'blocked']) {
  access = mode;
  await assert.rejects(api.soundcloudTrack(url(mode)), {
    code: 'SOUNDCLOUD_TRACK_UNAVAILABLE',
  });
}
access = 'playable';
sharing = 'private';
await assert.rejects(api.soundcloudTrack(url('private')), {
  code: 'SOUNDCLOUD_TRACK_UNAVAILABLE',
});
sharing = 'public';
onlyPreview = true;
await assert.rejects(api.soundcloudStream(url('preview-only')), {
  code: 'SOUNDCLOUD_TRACK_UNAVAILABLE',
});
onlyPreview = false;
streamRedirect = 'https://cf-hls-media.sndcdn.com.evil.test/file';
await assert.rejects(api.soundcloudStream(url('bad-cdn')), {
  code: 'SOUNDCLOUD_UNAVAILABLE',
});
sqlite.exec('UPDATE music_app_tokens SET expiresAt=0');
await Promise.all([
  api.soundcloudTrack(url('refresh-a')),
  api.soundcloudTrack(url('refresh-b')),
]);
assert.equal(refreshes, 1, 'Single-use refresh credential is not raced');
sqlite.exec('UPDATE music_app_tokens SET expiresAt=0');
failRefresh = true;
await assert.rejects(api.soundcloudTrack(url('timeout')), {
  code: 'SOUNDCLOUD_UNAVAILABLE',
});
assert.equal(
  sqlite.prepare('SELECT sealedTokens FROM music_app_tokens').get()
    .sealedTokens,
  '',
);
await assert.rejects(api.soundcloudTrack(url('backoff')), {
  code: 'SOUNDCLOUD_UNAVAILABLE',
});
assert.equal(refreshes, 2, 'Unknown refresh outcome is never replayed');
sqlite.exec('UPDATE music_app_tokens SET retryAt=0');
failRefresh = false;
await api.soundcloudTrack(url('recover'));
assert.equal(
  tokens,
  2,
  'Recovery obtains a fresh credential after the cooldown',
);
for (const bad of [
  'https://evil.test/music',
  'https://soundcloud.com/a/sets/b',
  'https://soundcloud.com/a/b?secret_token=secret',
])
  await assert.rejects(api.soundcloudTrack(bad), { status: 400 });
sqlite.close();
delete globalThis.__scTest;
console.log(
  'SoundCloud playback: encrypted token reuse, refresh races, failures, full public streams and redirect boundaries passed',
);
