import { db } from './storage';
import { setting, randomToken } from './auth-session';
import { ApiError } from './api-error';
import { openMusicToken, sealMusicToken } from './music-token-crypto';
import type { ServiceStatus } from './music-service-types';
import { fetchYandex } from './yandex-transport';

// Experimental metadata connector. Protocol reference: MarshalX/yandex-music-api.
// It never requests downloads, streams, passwords or another application's credentials.
type Data = Record<string, unknown>;
type Connection = {
  id: string;
  accountId: string;
  displayName: string;
  sealedTokens: string;
  status: string;
};
export type YandexPlaylist = {
  id: string;
  title: string;
  count: number;
  artwork: string;
  url: string;
  syncedAt: number;
};
export type YandexTrack = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  artwork: string;
  url: string;
};
const object = (value: unknown): Data =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Data)
    : {};
const text = (value: unknown, max = 300) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const identifier = (value: unknown) =>
  /^\d{1,20}$/.test(String(value)) ? String(value) : '';
const writable = `NOT EXISTS(SELECT 1 FROM account_restrictions WHERE userId=? AND (expiresAt IS NULL OR expiresAt>strftime('%s','now')*1000))`;
const context = (user: string) => JSON.stringify(['music', user, 'yandex']);
function key() {
  const value = setting('MUSIC_TOKEN_KEY');
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new ApiError(
      503,
      'Владелец Noctgram ещё не настроил защищённое хранение подключений.',
    );
  return value;
}
export function yandexArtwork(value: unknown) {
  const raw = text(value, 1500).replace('%%', '200x200');
  const candidate = raw.startsWith('https://') ? raw : 'https://' + raw;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' &&
      url.hostname === 'avatars.yandex.net' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
      ? url.href
      : '';
  } catch {
    return '';
  }
}
async function api(token: string, path: string): Promise<unknown> {
  const response = await fetchYandex(path, token);
  if (response.status === 401 || response.status === 403)
    throw new ApiError(
      401,
      'Токен Яндекс Музыки не принят. Подключите аккаунт заново.',
      'MUSIC_RECONNECT',
    );
  if (response.status === 429)
    throw new ApiError(
      429,
      'Яндекс временно ограничил запросы. Попробуйте позже.',
    );
  if (response.status === 451)
    throw new ApiError(
      502,
      'Доступ к плейлистам Яндекс Музыки ограничен (HTTP 451). Проверьте регион и подключение сервера Noctgram: VPN только в браузере не меняет этот запрос. Подключённый аккаунт и сохранённые плейлисты не удалены.',
      'YANDEX_ACCESS_RESTRICTED',
    );
  if (!response.ok)
    throw new ApiError(
      502,
      `Яндекс Музыка не смогла выполнить запрос (HTTP ${response.status}). Повторите синхронизацию позже.`,
      'YANDEX_HTTP_' + response.status,
    );
  let payload: Data;
  try {
    payload = object(await response.json());
  } catch {
    throw new ApiError(502, 'Яндекс вернул некорректный ответ.');
  }
  if (!('result' in payload) || payload.error)
    throw new ApiError(502, 'Данные Яндекс Музыки сейчас недоступны.');
  return payload.result;
}
async function connection(user: string) {
  const row = await db()
    .prepare(
      "SELECT id,accountId,displayName,sealedTokens,status FROM music_connections WHERE userId=? AND provider='yandex'",
    )
    .bind(user)
    .first<Connection>();
  if (!row)
    throw new ApiError(409, 'Подключите Яндекс Музыку.', 'MUSIC_NOT_CONNECTED');
  if (row.status !== 'connected')
    throw new ApiError(
      401,
      'Подключите Яндекс Музыку заново.',
      'MUSIC_RECONNECT',
    );
  return row;
}
async function current(user: string, id: string) {
  const row = await connection(user);
  if (row.id !== id)
    throw new ApiError(409, 'Подключение изменилось. Обновите список.');
}
async function request(user: string, row: Connection, path: string) {
  const token = await openMusicToken<{ access_token: string }>(
    row.sealedTokens,
    key(),
    context(user),
  );
  try {
    const result = await api(token.access_token, path);
    await current(user, row.id);
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'MUSIC_RECONNECT')
      await db()
        .prepare(
          "UPDATE music_connections SET status='expired' WHERE userId=? AND provider='yandex' AND id=?",
        )
        .bind(user, row.id)
        .run();
    throw error;
  }
}
export async function yandexStatus(user: string): Promise<ServiceStatus> {
  const row = await db()
    .prepare(
      "SELECT displayName,status FROM music_connections WHERE userId=? AND provider='yandex'",
    )
    .bind(user)
    .first<Connection>();
  const configured = /^[a-f0-9]{64}$/i.test(setting('MUSIC_TOKEN_KEY'));
  return {
    provider: 'yandex',
    configured,
    status: !configured
      ? 'setup_required'
      : !row
        ? 'disconnected'
        : row.status === 'connected'
          ? 'connected'
          : 'expired',
    ...(row ? { displayName: row.displayName } : {}),
  };
}
export async function connectYandex(user: string, value: unknown) {
  const secret = key();
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._~-]{20,4096}$/.test(value))
    throw new ApiError(
      400,
      'Введите действительный токен своего аккаунта Яндекс Музыки.',
    );
  const id = randomToken();
  await db().batch([
    db()
      .prepare(
        "DELETE FROM music_oauth_states WHERE userId=? AND provider='yandex'",
      )
      .bind(user),
    db()
      .prepare(
        "INSERT INTO music_oauth_states(stateHash,userId,provider,browserHash,sealedVerifier,expiresAt) VALUES(?,?,'yandex','','',?)",
      )
      .bind(id, user, Date.now() + 60000),
  ]);
  try {
    const profile = object(await api(value, '/account/status'));
    const account = object(profile.account),
      uid = identifier(account.uid);
    if (!uid)
      throw new ApiError(
        401,
        'Токен не предоставил доступ к аккаунту Яндекс Музыки.',
      );
    const name =
      text(account.displayName) || text(account.login) || 'Яндекс Музыка';
    const sealed = await sealMusicToken(
      { access_token: value },
      secret,
      context(user),
    );
    const result = await db().batch([
      db()
        .prepare(`INSERT INTO music_connections(userId,provider,id,accountId,displayName,profileUrl,sealedTokens,expiresAt,status,updated)
        SELECT ?,'yandex',?,?,?,'',?,0,'connected',? WHERE ${writable} AND EXISTS(SELECT 1 FROM music_oauth_states WHERE stateHash=? AND userId=? AND provider='yandex' AND expiresAt>?)
        ON CONFLICT(userId,provider) DO UPDATE SET id=excluded.id,accountId=excluded.accountId,displayName=excluded.displayName,sealedTokens=excluded.sealedTokens,status='connected',updated=excluded.updated`)
        .bind(
          user,
          id,
          uid,
          name,
          sealed,
          Date.now(),
          user,
          id,
          user,
          Date.now(),
        ),
      db()
        .prepare(
          "DELETE FROM music_imports WHERE userId=? AND provider='yandex' AND connectionId<>(SELECT id FROM music_connections WHERE userId=? AND provider='yandex')",
        )
        .bind(user, user),
    ]);
    if (!result[0].meta.changes)
      throw new ApiError(409, 'Подключение отменено или аккаунт недоступен.');
    return { ok: true };
  } finally {
    await db()
      .prepare('DELETE FROM music_oauth_states WHERE stateHash=?')
      .bind(id)
      .run();
  }
}
export async function disconnectYandex(user: string) {
  await db().batch([
    db()
      .prepare(
        "DELETE FROM music_oauth_states WHERE userId=? AND provider='yandex'",
      )
      .bind(user),
    db()
      .prepare(
        "DELETE FROM music_connections WHERE userId=? AND provider='yandex'",
      )
      .bind(user),
    db()
      .prepare("DELETE FROM music_imports WHERE userId=? AND provider='yandex'")
      .bind(user),
  ]);
  return { ok: true };
}
export async function yandexPlaylists(user: string): Promise<YandexPlaylist[]> {
  const result = await db()
    .prepare(
      "SELECT playlistId AS id,title,trackCount AS count,artwork,url,imported AS syncedAt FROM music_imports WHERE userId=? AND provider='yandex' ORDER BY imported DESC,title LIMIT 100",
    )
    .bind(user)
    .all<YandexPlaylist>();
  return result.results;
}
export async function syncYandex(user: string) {
  const row = await connection(user);
  const result = await request(
    user,
    row,
    '/users/' + row.accountId + '/playlists/list',
  );
  if (!Array.isArray(result))
    throw new ApiError(502, 'Яндекс не вернул список плейлистов.');
  if (result.length > 100)
    throw new ApiError(
      422,
      'Пока поддерживается синхронизация до 100 плейлистов.',
    );
  const time = Date.now();
  const items = result.flatMap((raw) => {
    const item = object(raw),
      id = identifier(item.kind),
      owner = object(item.owner);
    if (!id || (owner.uid && identifier(owner.uid) !== row.accountId))
      return [];
    return [
      {
        id,
        title: text(item.title) || 'Плейлист',
        count:
          typeof item.trackCount === 'number'
            ? Math.max(0, item.trackCount)
            : 0,
        artwork: yandexArtwork(object(item.cover).uri),
        url: `https://music.yandex.ru/users/${row.accountId}/playlists/${id}`,
        syncedAt: time,
      },
    ];
  });
  await db().batch([
    db()
      .prepare(
        `DELETE FROM music_imports WHERE userId=? AND provider='yandex' AND EXISTS(SELECT 1 FROM music_connections WHERE userId=? AND provider='yandex' AND id=?) AND ${writable}`,
      )
      .bind(user, user, row.id, user),
    ...items.map((item) =>
      db()
        .prepare(`INSERT INTO music_imports(userId,provider,playlistId,connectionId,title,url,artwork,trackCount,playable,imported)
      SELECT ?,'yandex',?,?,?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM music_connections WHERE userId=? AND provider='yandex' AND id=?) AND ${writable}`)
        .bind(
          user,
          item.id,
          row.id,
          item.title,
          item.url,
          item.artwork,
          item.count,
          time,
          user,
          row.id,
          user,
        ),
    ),
  ]);
  await current(user, row.id);
  return { items };
}
export async function yandexTracks(user: string, id: string) {
  if (!identifier(id)) throw new ApiError(400, 'Некорректный плейлист.');
  const row = await connection(user);
  const result = object(
    await request(user, row, '/users/' + row.accountId + '/playlists/' + id),
  );
  if (identifier(result.kind) !== id || !Array.isArray(result.tracks))
    throw new ApiError(502, 'Не удалось получить состав плейлиста.');
  const tracks: YandexTrack[] = result.tracks.slice(0, 1000).flatMap((raw) => {
    const track = object(object(raw).track),
      trackId = identifier(track.id),
      title = text(track.title);
    if (!trackId || !title) return [];
    return [
      {
        id: trackId,
        title,
        artist: (Array.isArray(track.artists) ? track.artists : [])
          .map((value) => text(object(value).name))
          .filter(Boolean)
          .join(', '),
        duration: typeof track.durationMs === 'number' ? track.durationMs : 0,
        artwork: yandexArtwork(track.coverUri),
        url: 'https://music.yandex.ru/track/' + trackId,
      },
    ];
  });
  return {
    items: tracks,
    total: result.tracks.length,
    partial: tracks.length !== result.tracks.length,
  };
}
