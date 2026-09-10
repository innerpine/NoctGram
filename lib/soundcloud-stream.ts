import { readUpstreamJson } from './upstream-json';
import { db } from './storage';
import { setting } from './auth-session';
import { ApiError } from './api-error';
import { openMusicToken, sealMusicToken } from './music-token-crypto';
import { parseMusicLink, type MusicTrack } from './music-links';

type Tokens = { access_token: string; refresh_token?: string };
type CachedTokens = Tokens & { envelope: string };
type TokenRow = {
  sealedTokens: string;
  expiresAt: number;
  leaseUntil: number;
  retryAt: number;
};
type Data = Record<string, unknown>;
const API = 'https://api.soundcloud.com';
const pendingTokens = new Map<string, Promise<CachedTokens>>();
const resources = new Map<string, { until: number; data: Promise<Data> }>();
export function soundcloudStreamingConfigured() {
  return (
    !!setting('SOUNDCLOUD_CLIENT_ID') &&
    !!setting('SOUNDCLOUD_CLIENT_SECRET') &&
    /^[a-f0-9]{64}$/i.test(setting('MUSIC_TOKEN_KEY'))
  );
}
const unavailable = () =>
  new ApiError(
    503,
    'SoundCloud временно недоступен. Попробуйте ещё раз.',
    'SOUNDCLOUD_UNAVAILABLE',
  );

async function storedToken(): Promise<CachedTokens> {
  if (!soundcloudStreamingConfigured())
    throw new ApiError(
      503,
      'Воспроизведение через SoundCloud API ещё не настроено.',
      'MUSIC_SETUP_REQUIRED',
    );
  const id = setting('SOUNDCLOUD_CLIENT_ID'),
    secret = setting('SOUNDCLOUD_CLIENT_SECRET'),
    key = setting('MUSIC_TOKEN_KEY');
  const context = 'soundcloud:public-playback:' + id;
  const d = db();
  for (let attempt = 0; attempt < 12; attempt++) {
    const now = Date.now();
    const row = await d
      .prepare('SELECT * FROM music_app_tokens WHERE id=?')
      .bind(id)
      .first<TokenRow>();
    if (row?.sealedTokens && row.expiresAt > now + 60000)
      return {
        ...(await openMusicToken<Tokens>(row.sealedTokens, key, context)),
        envelope: row.sealedTokens,
      };
    if (row && row.retryAt > now) throw unavailable();
    const lease = crypto.randomUUID();
    const claimed = await d
      .prepare(`INSERT INTO music_app_tokens(id,lease,leaseUntil) VALUES(?,?,?)
      ON CONFLICT(id) DO UPDATE SET lease=excluded.lease,leaseUntil=excluded.leaseUntil
      WHERE leaseUntil<=? AND retryAt<=? AND expiresAt<=? RETURNING id`)
      .bind(id, lease, now + 20000, now, now, now + 60000)
      .first();
    if (!claimed) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    try {
      const old = row?.sealedTokens
        ? await openMusicToken<Tokens>(row.sealedTokens, key, context)
        : null;
      // Consume the refresh credential before HTTP. A timeout must never replay a
      // single-use token, including from a different Worker instance.
      await d
        .prepare(
          "UPDATE music_app_tokens SET sealedTokens='',expiresAt=0 WHERE id=? AND lease=?",
        )
        .bind(id, lease)
        .run();
      const body = new URLSearchParams(
        old?.refresh_token
          ? {
              grant_type: 'refresh_token',
              refresh_token: old.refresh_token,
              client_id: id,
              client_secret: secret,
            }
          : { grant_type: 'client_credentials' },
      );
      const response = await fetch(
        'https://secure.soundcloud.com/oauth/token',
        {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(12000),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(!old?.refresh_token
              ? { Authorization: 'Basic ' + btoa(id + ':' + secret) }
              : {}),
          },
          body,
        },
      );
      if (!response.ok) throw unavailable();
      const token = (await readUpstreamJson(response, 65536)) as Tokens & {
        expires_in: number;
      };
      if (
        typeof token.access_token !== 'string' ||
        !token.access_token ||
        !Number.isFinite(token.expires_in) ||
        token.expires_in < 120 ||
        (token.refresh_token !== undefined &&
          typeof token.refresh_token !== 'string')
      )
        throw unavailable();
      const sealed = await sealMusicToken(token, key, context);
      const saved = await d
        .prepare(
          "UPDATE music_app_tokens SET sealedTokens=?,expiresAt=?,lease='',leaseUntil=0,retryAt=0 WHERE id=? AND lease=? RETURNING id",
        )
        .bind(sealed, Date.now() + token.expires_in * 1000, id, lease)
        .first();
      if (!saved) throw unavailable();
      return { ...token, envelope: sealed };
    } catch {
      await d
        .prepare(
          "UPDATE music_app_tokens SET sealedTokens='',expiresAt=0,lease='',leaseUntil=0,retryAt=? WHERE id=? AND lease=?",
        )
        .bind(Date.now() + 60000, id, lease)
        .run();
      throw unavailable();
    }
  }
  throw unavailable();
}
async function token() {
  const id = setting('SOUNDCLOUD_CLIENT_ID');
  let pending = pendingTokens.get(id);
  if (!pending) {
    pending = storedToken().finally(() => pendingTokens.delete(id));
    pendingTokens.set(id, pending);
  }
  return pending;
}
function apiURL(value: string) {
  const url = new URL(value, API);
  if (url.origin !== API || url.username || url.password || url.hash)
    throw unavailable();
  return url.href;
}
async function request(path: string, redirect = true) {
  const auth = await token();
  let url = apiURL(path);
  for (let hop = 0; hop < 3; hop++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: 'OAuth ' + auth.access_token },
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw unavailable();
    }
    if (response.status === 302 && redirect) {
      url = apiURL(response.headers.get('location') || '');
      continue;
    }
    if (response.status === 401) {
      // Do not create a token loop when credentials are rejected by the provider.
      await db()
        .prepare(
          'UPDATE music_app_tokens SET expiresAt=0 WHERE id=? AND sealedTokens=?',
        )
        .bind(setting('SOUNDCLOUD_CLIENT_ID'), auth.envelope)
        .run();
      throw unavailable();
    }
    if (response.status === 403 || response.status === 404)
      throw new ApiError(
        422,
        'Этот трек недоступен для воспроизведения через SoundCloud.',
        'SOUNDCLOUD_TRACK_UNAVAILABLE',
      );
    if (!response.ok && response.status !== 302) throw unavailable();
    return response;
  }
  throw unavailable();
}
function publicTrack(value: unknown) {
  const link = parseMusicLink(value);
  if (link?.provider !== 'soundcloud' || link.kind !== 'track')
    throw new ApiError(400, 'Нужна публичная ссылка на трек SoundCloud.');
  return link;
}
async function resource(value: unknown) {
  const link = publicTrack(value),
    cacheKey = setting('SOUNDCLOUD_CLIENT_ID') + ':' + link.url;
  const cached = resources.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.data;
  const data = (async () => {
    const response = await request(
      '/resolve?url=' + encodeURIComponent(link.url),
    );
    const track = (await readUpstreamJson(response)) as Data;
    if (
      track.kind !== 'track' ||
      track.sharing !== 'public' ||
      track.streamable !== true ||
      track.access !== 'playable'
    )
      throw new ApiError(
        422,
        'SoundCloud не разрешает полное воспроизведение этого трека.',
        'SOUNDCLOUD_TRACK_UNAVAILABLE',
      );
    if (
      typeof track.urn !== 'string' ||
      !/^soundcloud:tracks:\d+$/.test(track.urn)
    )
      throw unavailable();
    return track;
  })();
  const entry = { until: Date.now() + 60000, data };
  resources.set(cacheKey, entry);
  if (resources.size > 128) resources.delete(resources.keys().next().value!);
  try {
    return await data;
  } catch (error) {
    if (resources.get(cacheKey) === entry) resources.delete(cacheKey);
    throw error;
  }
}
export async function soundcloudTrack(value: unknown): Promise<MusicTrack> {
  const link = publicTrack(value),
    track = await resource(value);
  return trackMetadata(track, link);
}
function trackMetadata(
  track: Data,
  link: ReturnType<typeof publicTrack>,
): MusicTrack {
  const user = track.user as Data | undefined;
  const string = (v: unknown) =>
    typeof v === 'string' ? v.slice(0, 1500) : '';
  const art = string(track.artwork_url),
    author = string(user?.permalink_url).split(/[?#]/, 1)[0];
  return {
    ...link,
    playback: 'soundcloud',
    id: String(track.urn),
    title: string(track.title),
    artist: string(track.metadata_artist) || string(user?.username),
    artwork: /^https:\/\/i\d+\.sndcdn\.com\//.test(art) ? art : '',
    authorUrl: /^https:\/\/soundcloud\.com\/[\w-]+\/?$/.test(author)
      ? author
      : '',
    durationMs:
      typeof track.duration === 'number' && Number.isFinite(track.duration)
        ? Math.max(0, track.duration)
        : 0,
  };
}

export async function searchSoundCloud(query: unknown, page: unknown = '1') {
  if (typeof query !== 'string' || !query.trim() || query.length > 150)
    throw new ApiError(
      400,
      'Введите название песни или исполнителя — до 150 символов.',
    );
  if (typeof page !== 'string' || !/^(?:[1-9]|1\d|20)$/.test(page))
    throw new ApiError(400, 'Некорректная страница поиска.');
  const response = await request(
    '/tracks?' +
      new URLSearchParams({
        q: query.trim(),
        access: 'playable',
        limit: '20',
        offset: String((Number(page) - 1) * 20),
        linked_partitioning: 'true',
      }),
  );
  const data = (await readUpstreamJson(response)) as Data;
  const collection = Array.isArray(data) ? data : data.collection;
  if (!Array.isArray(collection)) throw unavailable();
  const seen = new Set<string>();
  const items = collection.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const track = value as Data,
      link = parseMusicLink(track.permalink_url);
    if (
      track.sharing !== 'public' ||
      track.access !== 'playable' ||
      track.streamable !== true ||
      typeof track.urn !== 'string' ||
      !/^soundcloud:tracks:\d+$/.test(track.urn) ||
      typeof track.title !== 'string' ||
      !track.title.trim() ||
      link?.provider !== 'soundcloud' ||
      link.kind !== 'track' ||
      seen.has(link.url)
    )
      return [];
    seen.add(link.url);
    return [trackMetadata(track, link)];
  });
  return {
    items,
    nextPage:
      Number(page) < 20 &&
      (Array.isArray(data) ? collection.length === 20 : !!data.next_href)
        ? String(Number(page) + 1)
        : null,
  };
}
export async function soundcloudStream(value: unknown) {
  const track = await resource(value);
  const response = await request(
    '/tracks/' + encodeURIComponent(String(track.urn)) + '/streams',
  );
  const streams = (await readUpstreamJson(response)) as Data;
  // Full HLS only. Never substitute a preview or a download for playback.
  const path = streams.hls_mp3_128_url || streams.hls_aac_160_url;
  if (typeof path !== 'string')
    throw new ApiError(
      422,
      'SoundCloud не предоставил полный аудиопоток.',
      'SOUNDCLOUD_TRACK_UNAVAILABLE',
    );
  const stream = await request(apiURL(path), false);
  const location = stream.headers.get('location');
  if (stream.status !== 302 || !location) throw unavailable();
  const url = new URL(location);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    !(
      url.hostname.endsWith('.sndcdn.com') ||
      url.hostname === 'playback.media-streaming.soundcloud.cloud'
    )
  )
    throw unavailable();
  return url.href;
}
