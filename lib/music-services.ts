import { db } from './storage';
import { ApiError } from './api-error';
import {
  setting,
  randomToken,
  tokenHash,
  cookieValue,
  authCookie,
} from './auth-session';
import { assertWritable } from './account-access';
import { yandexStatus } from './yandex-music';
import { parseMusicLink } from './music-links';
import {
  MUSIC_SERVICES,
  type OAuthMusicService,
  type ServicePlaylist,
  type ServiceStatus,
} from './music-service-types';
import {
  musicPKCE,
  openMusicToken,
  sealMusicToken,
} from './music-token-crypto';

type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};
export const SPOTIFY_PLAYBACK_SCOPES =
  'streaming user-read-email user-read-private user-modify-playback-state';
type Connection = {
  userId: string;
  provider: OAuthMusicService;
  id: string;
  accountId: string;
  displayName: string;
  profileUrl: string;
  sealedTokens: string;
  expiresAt: number;
  status: string;
  refreshLock: string;
  refreshUntil: number;
};
type Data = Record<string, unknown>;
const text = (value: unknown, max = 300) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const tokenContext = (user: string, provider: string) =>
  JSON.stringify(['music', user, provider]);
const writableSQL = `NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=? AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))`;
const endpoints = {
  soundcloud: {
    authorize: 'https://secure.soundcloud.com/authorize',
    token: 'https://secure.soundcloud.com/oauth/token',
    api: 'https://api.soundcloud.com',
    playlists:
      '/me/playlists?show_tracks=false&linked_partitioning=true&limit=20',
  },
  spotify: {
    authorize: 'https://accounts.spotify.com/authorize',
    token: 'https://accounts.spotify.com/api/token',
    api: 'https://api.spotify.com/v1',
    playlists: '/me/playlists?limit=20',
  },
};
function configuration(provider: OAuthMusicService) {
  const prefix = provider.toUpperCase(),
    clientId = setting(prefix + '_CLIENT_ID'),
    clientSecret = setting(prefix + '_CLIENT_SECRET'),
    redirectUri = setting(prefix + '_REDIRECT_URI'),
    encryptionKey = setting('MUSIC_TOKEN_KEY');
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
  if (
    !clientId ||
    (provider === 'soundcloud' && !clientSecret) ||
    !/^[a-f0-9]{64}$/i.test(encryptionKey) ||
    (redirect.protocol !== 'https:' &&
      !(local && redirect.protocol === 'http:')) ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    redirect.pathname !== `/api/music/services/${provider}/callback` ||
    (provider === 'spotify' && redirect.hostname === 'localhost')
  )
    return null;
  return {
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey,
    origin: redirect.origin,
  };
}
function config(provider: OAuthMusicService) {
  const value = configuration(provider);
  if (!value)
    throw new ApiError(
      503,
      'Подключение этого сервиса ещё не настроено владельцем Noctgram.',
      'MUSIC_SETUP_REQUIRED',
    );
  return value;
}
function context(user: string, provider: string, purpose: string) {
  return tokenContext(user, provider) + ':' + purpose;
}
async function requestJSON(url: string, init: RequestInit = {}): Promise<Data> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ApiError(
      502,
      'Музыкальный сервис не отвечает. Попробуйте позже.',
    );
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 400)
      throw new ApiError(
        401,
        'Подключите музыкальный аккаунт заново.',
        'MUSIC_RECONNECT',
      );
    if (response.status === 403)
      throw new ApiError(
        403,
        'Сервис не предоставил доступ. Проверьте разрешения приложения.',
        'MUSIC_PROVIDER_ACCESS',
      );
    if (response.status === 429)
      throw new ApiError(
        429,
        'Сервис временно ограничил запросы. Попробуйте позже.',
      );
    throw new ApiError(502, 'Не удалось получить ответ музыкального сервиса.');
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new ApiError(502, 'Некорректный ответ музыкального сервиса.');
  return data as Data;
}
async function exchange(
  provider: OAuthMusicService,
  fields: Record<string, string>,
  previousRefresh = '',
  previousScope = '',
): Promise<Tokens> {
  const c = config(provider);
  const data = await requestJSON(endpoints[provider].token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: c.clientId,
      ...(provider === 'soundcloud' ? { client_secret: c.clientSecret } : {}),
      ...fields,
    }),
  });
  const access = text(data.access_token, 8000),
    refresh = text(data.refresh_token, 8000) || previousRefresh;
  if (
    !access ||
    !refresh ||
    typeof data.expires_in !== 'number' ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  )
    throw new ApiError(502, 'Сервис не выдал действительное подключение.');
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: Math.min(data.expires_in, 86400),
    scope: text(data.scope, 2000) || previousScope,
  };
}
const authHeaders = (provider: OAuthMusicService, access: string) => ({
  Authorization: `${provider === 'soundcloud' ? 'OAuth' : 'Bearer'} ${access}`,
  Accept: 'application/json',
});
function profileURL(provider: OAuthMusicService, value: unknown) {
  const candidate = text(value, 1000);
  return (provider === 'soundcloud'
    ? /^https:\/\/soundcloud\.com\/[a-zA-Z0-9_-]+\/?$/
    : /^https:\/\/open\.spotify\.com\/user\/[a-zA-Z0-9_%.-]+\/?$/
  ).test(candidate)
    ? candidate
    : '';
}
async function connection(user: string, provider: OAuthMusicService) {
  const row = await db()
    .prepare('SELECT * FROM music_connections WHERE userId=? AND provider=?')
    .bind(user, provider)
    .first<Connection>();
  if (!row)
    throw new ApiError(
      409,
      'Сначала подключите аккаунт.',
      'MUSIC_NOT_CONNECTED',
    );
  return row;
}
export async function musicServiceStatus(
  user: string,
): Promise<ServiceStatus[]> {
  const yandex = await yandexStatus(user);
  const rows = await db()
    .prepare(
      'SELECT provider,displayName,profileUrl,status FROM music_connections WHERE userId=?',
    )
    .bind(user)
    .all<Connection>();
  return MUSIC_SERVICES.map((provider) => {
    if (provider === 'youtube')
      return { provider, configured: true, status: 'link_only' };
    if (provider === 'yandex') return yandex;
    if (provider !== 'soundcloud' && provider !== 'spotify')
      return { provider, configured: false, status: 'unavailable' };
    const row = rows.results.find((r) => r.provider === provider),
      configured = !!configuration(provider);
    return {
      provider,
      configured,
      status: !configured
        ? 'setup_required'
        : !row
          ? 'disconnected'
          : row.status === 'expired'
            ? 'expired'
            : 'connected',
      ...(row
        ? { displayName: row.displayName, profileUrl: row.profileUrl }
        : {}),
    };
  });
}
export async function connectMusic(
  req: Request,
  user: string,
  provider: OAuthMusicService,
) {
  const c = config(provider);
  if (new URL(req.url).origin !== c.origin)
    throw new ApiError(
      409,
      'Откройте Noctgram по адресу, настроенному для музыкального входа.',
      'MUSIC_ORIGIN_MISMATCH',
    );
  const state = randomToken(),
    browser = randomToken(),
    verifier = randomToken(),
    stateHash = await tokenHash(state);
  await db().batch([
    db()
      .prepare(
        'DELETE FROM music_oauth_states WHERE expiresAt<? OR (userId=? AND provider=?)',
      )
      .bind(Date.now(), user, provider),
    db()
      .prepare(
        'INSERT INTO music_oauth_states(stateHash,userId,provider,browserHash,sealedVerifier,expiresAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        stateHash,
        user,
        provider,
        await tokenHash(browser),
        await sealMusicToken(
          verifier,
          c.encryptionKey,
          context(user, provider, 'oauth'),
        ),
        Date.now() + 600000,
      ),
  ]);
  const url = new URL(endpoints[provider].authorize);
  url.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    state,
    code_challenge: await musicPKCE(verifier),
    code_challenge_method: 'S256',
    ...(provider === 'spotify'
      ? {
          scope:
            'playlist-read-private playlist-read-collaborative ' +
            SPOTIFY_PLAYBACK_SCOPES,
        }
      : {}),
  }).toString();
  return Response.json(
    { authorizationUrl: url.toString() },
    {
      headers: {
        'Set-Cookie': authCookie(req, 'noct_music_' + provider, browser, 600),
      },
    },
  );
}
export async function finishMusicConnection(
  req: Request,
  user: string,
  provider: OAuthMusicService,
) {
  const c = config(provider),
    params = new URL(req.url).searchParams,
    state = params.get('state') || '',
    browser = cookieValue(req.headers.get('cookie'), 'noct_music_' + provider);
  if (
    new URL(req.url).origin !== c.origin ||
    !/^[a-f0-9]{64}$/.test(state) ||
    !/^[a-f0-9]{64}$/.test(browser)
  )
    throw new ApiError(
      400,
      'Подключение не подтверждено. Начните вход заново.',
    );
  const stateHash = await tokenHash(state);
  const row = await db()
    .prepare(
      'UPDATE music_oauth_states SET consumed=1 WHERE stateHash=? AND userId=? AND provider=? AND browserHash=? AND expiresAt>? AND consumed=0 RETURNING sealedVerifier',
    )
    .bind(
      await tokenHash(state),
      user,
      provider,
      await tokenHash(browser),
      Date.now(),
    )
    .first<{ sealedVerifier: string }>();
  if (!row)
    throw new ApiError(
      400,
      'Попытка входа истекла или уже использована. Начните заново.',
    );
  const result = (value: string) =>
    new Response(null, {
      status: 303,
      headers: {
        Location:
          c.origin +
          '/music/services?provider=' +
          provider +
          '&result=' +
          value,
        'Set-Cookie': authCookie(req, 'noct_music_' + provider, '', 0),
      },
    });
  if (params.has('error')) return result('cancelled');
  const code = params.get('code');
  if (!code || code.length > 4096)
    throw new ApiError(400, 'Сервис не подтвердил вход.');
  const verifier = await openMusicToken<string>(
    row.sealedVerifier,
    c.encryptionKey,
    context(user, provider, 'oauth'),
  );
  const tokens = await exchange(provider, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: c.redirectUri,
  });
  const profile = await requestJSON(endpoints[provider].api + '/me', {
    headers: authHeaders(provider, tokens.access_token),
  });
  const accountId =
    typeof profile.id === 'number' || typeof profile.id === 'string'
      ? String(profile.id).slice(0, 160)
      : '';
  if (!accountId)
    throw new ApiError(502, 'Не удалось определить музыкальный аккаунт.');
  const external = profile.external_urls as Data | undefined;
  const name =
    text(provider === 'soundcloud' ? profile.username : profile.display_name) ||
    accountId;
  const url = profileURL(
    provider,
    provider === 'soundcloud' ? profile.permalink_url : external?.spotify,
  );
  const sealed = await sealMusicToken(
      tokens,
      c.encryptionKey,
      tokenContext(user, provider),
    ),
    id = randomToken();
  await assertWritable(user);
  const operations = await db().batch([
    db()
      .prepare(`INSERT INTO music_connections(userId,provider,id,accountId,displayName,profileUrl,sealedTokens,expiresAt,status,refreshLock,refreshUntil,updated)
      SELECT ?,?,?,?,?,?,?,?,'connected','',0,? WHERE ${writableSQL} AND EXISTS(SELECT 1 FROM music_oauth_states WHERE stateHash=? AND userId=? AND provider=? AND consumed=1 AND expiresAt>?)
      ON CONFLICT(userId,provider) DO UPDATE SET id=excluded.id,accountId=excluded.accountId,displayName=excluded.displayName,profileUrl=excluded.profileUrl,sealedTokens=excluded.sealedTokens,expiresAt=excluded.expiresAt,status='connected',refreshLock='',refreshUntil=0,updated=excluded.updated`)
      .bind(
        user,
        provider,
        id,
        accountId,
        name,
        url,
        sealed,
        Date.now() + tokens.expires_in * 1000,
        Date.now(),
        user,
        stateHash,
        user,
        provider,
        Date.now(),
      ),
    db()
      .prepare(
        'DELETE FROM music_imports WHERE userId=? AND provider=? AND connectionId<>(SELECT id FROM music_connections WHERE userId=? AND provider=?)',
      )
      .bind(user, provider, user, provider),
    db()
      .prepare('DELETE FROM music_oauth_states WHERE stateHash=?')
      .bind(stateHash),
  ]);
  if (!operations[0].meta.changes)
    throw new ApiError(403, 'Подключение аккаунта сейчас недоступно.');
  return result('connected');
}
async function access(user: string, provider: OAuthMusicService) {
  const c = config(provider),
    row = await connection(user, provider);
  if (row.status === 'expired')
    throw new ApiError(401, 'Подключите аккаунт заново.', 'MUSIC_RECONNECT');
  if (row.status === 'refreshing') {
    if (row.refreshUntil > Date.now())
      throw new ApiError(
        409,
        'Подключение обновляется. Повторите через несколько секунд.',
      );
    await db()
      .prepare(
        "UPDATE music_connections SET status='expired' WHERE userId=? AND provider=? AND id=? AND status='refreshing' AND refreshUntil<?",
      )
      .bind(user, provider, row.id, Date.now())
      .run();
    throw new ApiError(
      401,
      'Обновление подключения прервалось. Войдите заново.',
      'MUSIC_RECONNECT',
    );
  }
  const tokens = await openMusicToken<Tokens>(
    row.sealedTokens,
    c.encryptionKey,
    tokenContext(user, provider),
  );
  if (row.expiresAt > Date.now() + 60000)
    return {
      access: tokens.access_token,
      connectionId: row.id,
      scope: tokens.scope || '',
      expiresAt: row.expiresAt,
    };
  const lease = randomToken();
  const claimed = await db()
    .prepare(
      "UPDATE music_connections SET status='refreshing',refreshLock=?,refreshUntil=? WHERE userId=? AND provider=? AND id=? AND status='connected' AND sealedTokens=? RETURNING id",
    )
    .bind(lease, Date.now() + 30000, user, provider, row.id, row.sealedTokens)
    .first();
  if (!claimed)
    throw new ApiError(
      409,
      'Подключение обновляется. Повторите через несколько секунд.',
    );
  try {
    const next = await exchange(
      provider,
      { grant_type: 'refresh_token', refresh_token: tokens.refresh_token },
      provider === 'spotify' ? tokens.refresh_token : '',
      tokens.scope,
    );
    const updated = await db()
      .prepare(
        "UPDATE music_connections SET sealedTokens=?,expiresAt=?,status='connected',refreshLock='',refreshUntil=0,updated=? WHERE userId=? AND provider=? AND id=? AND refreshLock=? RETURNING id",
      )
      .bind(
        await sealMusicToken(
          next,
          c.encryptionKey,
          tokenContext(user, provider),
        ),
        Date.now() + next.expires_in * 1000,
        Date.now(),
        user,
        provider,
        row.id,
        lease,
      )
      .first();
    if (!updated)
      throw new ApiError(409, 'Подключение изменилось. Обновите страницу.');
    return {
      access: next.access_token,
      connectionId: row.id,
      scope: next.scope || '',
      expiresAt: Date.now() + next.expires_in * 1000,
    };
  } catch (error) {
    // A timeout may have consumed a single-use refresh token. Never blindly retry it.
    await db()
      .prepare(
        "UPDATE music_connections SET status='expired',refreshLock='',refreshUntil=0 WHERE userId=? AND provider=? AND id=? AND refreshLock=?",
      )
      .bind(user, provider, row.id, lease)
      .run();
    throw error;
  }
}
async function serviceRequest(
  user: string,
  provider: OAuthMusicService,
  path: string,
) {
  const auth = await access(user, provider);
  try {
    return {
      data: await requestJSON(endpoints[provider].api + path, {
        headers: authHeaders(provider, auth.access),
      }),
      connectionId: auth.connectionId,
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'MUSIC_RECONNECT')
      await db()
        .prepare(
          "UPDATE music_connections SET status='expired' WHERE userId=? AND provider=? AND id=?",
        )
        .bind(user, provider, auth.connectionId)
        .run();
    throw error;
  }
}
function artwork(value: unknown) {
  const url = text(value, 1500);
  return /^https:\/\/(?:i\d+\.sndcdn\.com|i\.scdn\.co|mosaic\.scdn\.co|image-cdn-[a-z0-9-]+\.spotifycdn\.com)\//.test(
    url,
  )
    ? url
    : '';
}
function playlist(
  provider: OAuthMusicService,
  raw: Data,
): ServicePlaylist | null {
  const id =
    typeof raw.id === 'number' || typeof raw.id === 'string'
      ? String(raw.id)
      : '';
  const external = raw.external_urls as Data | undefined;
  const url = text(
    provider === 'soundcloud' ? raw.permalink_url : external?.spotify,
    1000,
  );
  const link = provider === 'soundcloud' ? parseMusicLink(url) : null;
  if (
    !id ||
    !/^[a-zA-Z0-9:_-]{1,160}$/.test(id) ||
    (provider === 'soundcloud'
      ? link?.kind !== 'playlist'
      : !/^https:\/\/open\.spotify\.com\/playlist\/[a-zA-Z0-9]+$/.test(url))
  )
    return null;
  const images = Array.isArray(raw.images) ? (raw.images as Data[]) : [];
  const tracks = (raw.items || raw.tracks) as Data | undefined;
  const count = provider === 'soundcloud' ? raw.track_count : tracks?.total;
  return {
    id,
    provider,
    title: text(provider === 'soundcloud' ? raw.title : raw.name) || 'Плейлист',
    url,
    artwork: artwork(
      provider === 'soundcloud' ? raw.artwork_url : images[0]?.url,
    ),
    trackCount:
      typeof count === 'number' && Number.isFinite(count)
        ? Math.max(0, count)
        : 0,
    playable: provider === 'soundcloud' && raw.sharing === 'public',
  };
}
export async function servicePlaylists(
  user: string,
  provider: OAuthMusicService,
  cursor: string,
) {
  const c = config(provider);
  let path = endpoints[provider].playlists;
  if (cursor) {
    let decoded: { path: string; expires: number };
    try {
      decoded = await openMusicToken(
        cursor ? cursor : '',
        c.encryptionKey,
        context(user, provider, 'cursor'),
      );
    } catch {
      throw new ApiError(400, 'Некорректная страница плейлистов.');
    }
    if (
      decoded.expires < Date.now() ||
      !/^\/(?:me\/)?playlists\?/.test(decoded.path)
    )
      throw new ApiError(400, 'Обновите список плейлистов.');
    path = decoded.path;
  }
  const { data } = await serviceRequest(user, provider, path);
  const list = provider === 'soundcloud' ? data.collection : data.items;
  if (!Array.isArray(list))
    throw new ApiError(502, 'Сервис не вернул список плейлистов.');
  const items = list
    .filter((v) => v && typeof v === 'object')
    .map((v) => playlist(provider, v as Data))
    .filter((v): v is ServicePlaylist => !!v);
  const imports = await db()
    .prepare(
      'SELECT playlistId FROM music_imports WHERE userId=? AND provider=?',
    )
    .bind(user, provider)
    .all<{ playlistId: string }>();
  let next: string | null = null;
  const href = text(
    provider === 'soundcloud' ? data.next_href : data.next,
    3000,
  );
  if (href) {
    const u = new URL(href),
      base = new URL(endpoints[provider].api);
    const nextPath =
      provider === 'spotify' ? u.pathname.replace(/^\/v1/, '') : u.pathname;
    if (
      u.origin === base.origin &&
      !u.username &&
      !u.password &&
      /^\/(?:me\/)?playlists$/.test(nextPath) &&
      !u.searchParams.has('access_token')
    )
      next = await sealMusicToken(
        { path: nextPath + u.search, expires: Date.now() + 3600000 },
        c.encryptionKey,
        context(user, provider, 'cursor'),
      );
  }
  return {
    items: items.map((p) => ({
      ...p,
      imported: imports.results.some((i) => i.playlistId === p.id),
    })),
    next,
  };
}
export async function importServicePlaylist(
  user: string,
  provider: OAuthMusicService,
  id: unknown,
) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(id))
    throw new ApiError(400, 'Некорректный плейлист.');
  const { data, connectionId } = await serviceRequest(
    user,
    provider,
    '/playlists/' +
      encodeURIComponent(id) +
      (provider === 'soundcloud' ? '?show_tracks=false' : ''),
  );
  const value = playlist(provider, data);
  if (!value || value.id !== id)
    throw new ApiError(422, 'Этот плейлист не поддерживается.');
  const row = await db()
    .prepare(`INSERT INTO music_imports(userId,provider,playlistId,connectionId,title,url,artwork,trackCount,playable,imported)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM music_connections WHERE userId=? AND provider=? AND id=?) AND ${writableSQL}
    AND ((SELECT COUNT(*) FROM music_imports WHERE userId=? AND provider=?)<100 OR EXISTS(SELECT 1 FROM music_imports WHERE userId=? AND provider=? AND playlistId=?))
    ON CONFLICT(userId,provider,playlistId) DO UPDATE SET connectionId=excluded.connectionId,title=excluded.title,url=excluded.url,artwork=excluded.artwork,trackCount=excluded.trackCount,playable=excluded.playable,imported=excluded.imported RETURNING playlistId`)
    .bind(
      user,
      provider,
      value.id,
      connectionId,
      value.title,
      value.url,
      value.artwork,
      value.trackCount,
      value.playable ? 1 : 0,
      Date.now(),
      user,
      provider,
      connectionId,
      user,
      user,
      provider,
      user,
      provider,
      id,
    )
    .first();
  if (!row)
    throw new ApiError(
      409,
      'Не удалось импортировать. Проверьте подключение и лимит в 100 плейлистов.',
    );
  return value;
}
export async function importedPlaylists(
  user: string,
  provider: OAuthMusicService,
) {
  const rows = await db()
    .prepare(
      'SELECT playlistId AS id,provider,title,url,artwork,trackCount,playable FROM music_imports WHERE userId=? AND provider=? ORDER BY imported DESC LIMIT 100',
    )
    .bind(user, provider)
    .all<ServicePlaylist>();
  return rows.results.map((row) => ({
    ...row,
    playable: !!row.playable,
    imported: true,
  }));
}
export async function searchServiceTracks(
  user: string,
  provider: OAuthMusicService,
  query: string,
) {
  if (provider !== 'soundcloud')
    throw new ApiError(400, 'В этом сервисе доступен импорт ваших плейлистов.');
  if (!query.trim() || query.length > 150)
    throw new ApiError(400, 'Введите название трека.');
  const { data } = await serviceRequest(
    user,
    provider,
    '/tracks?' +
      new URLSearchParams({
        q: query.trim(),
        limit: '20',
        linked_partitioning: 'true',
        access: 'playable',
      }),
  );
  const collection = Array.isArray(data.collection)
    ? (data.collection as Data[])
    : [];
  return collection.flatMap((row) => {
    if (
      row.access === 'preview' ||
      row.access === 'blocked' ||
      row.sharing === 'private' ||
      row.streamable === false
    )
      return [];
    const link = parseMusicLink(row.permalink_url),
      author = row.user as Data | undefined;
    return link?.provider === 'soundcloud' && link.kind === 'track'
      ? [
          {
            ...link,
            id: String(row.id),
            title: text(row.title),
            artist: text(author?.username),
            artwork: artwork(row.artwork_url),
            authorUrl: profileURL(provider, author?.permalink_url),
            durationMs:
              typeof row.duration === 'number' && Number.isFinite(row.duration)
                ? Math.max(0, row.duration)
                : undefined,
          },
        ]
      : [];
  });
}
export async function disconnectMusic(
  user: string,
  provider: OAuthMusicService,
) {
  // Atomically remove local secrets, pending callbacks and private imported data.
  await db().batch([
    db()
      .prepare('DELETE FROM music_oauth_states WHERE userId=? AND provider=?')
      .bind(user, provider),
    db()
      .prepare('DELETE FROM music_connections WHERE userId=? AND provider=?')
      .bind(user, provider),
    db()
      .prepare('DELETE FROM music_imports WHERE userId=? AND provider=?')
      .bind(user, provider),
  ]);
  return { ok: true };
}

// Only the short-lived SDK credential leaves the server; refresh tokens remain sealed.
export async function spotifyPlaybackToken(user: string) {
  const auth = await access(user, 'spotify');
  if (
    !SPOTIFY_PLAYBACK_SCOPES.split(' ').every((scope) =>
      auth.scope.split(' ').includes(scope),
    )
  )
    throw new ApiError(
      409,
      'Переподключите Spotify в сервисах, чтобы разрешить воспроизведение.',
      'MUSIC_RECONNECT',
    );
  const current = await connection(user, 'spotify');
  if (current.id !== auth.connectionId || current.status !== 'connected')
    throw new ApiError(409, 'Подключение изменилось. Войдите заново.');
  // The SDK verifies Premium. GET /me no longer exposes product in development mode.
  return { accessToken: auth.access, expiresAt: auth.expiresAt };
}
