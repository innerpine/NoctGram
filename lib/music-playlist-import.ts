import { db } from './storage';
import { ApiError } from './api-error';
import { parseMusicLink } from './music-links';
import type { ServicePlaylist } from './music-service-types';

export const MAX_IMPORTED_TRACKS = 1000;
type Data = Record<string, unknown>;
const text = (v: unknown, max = 300) =>
  typeof v === 'string' ? v.slice(0, max) : '';

/** Materialize a private Noctgram copy. The connected service is never edited. */
export async function copySoundCloudPlaylist(
  user: string,
  connectionId: string,
  playlist: ServicePlaylist,
  source: Data[],
) {
  const tracks = new Map<string, Data>();
  for (const row of source) {
    const link = parseMusicLink(row.permalink_url);
    if (
      row.sharing !== 'public' ||
      row.streamable === false ||
      row.access === 'preview' ||
      row.access === 'blocked' ||
      !link ||
      link.provider !== 'soundcloud' ||
      link.kind !== 'track'
    )
      continue;
    const author = row.user as Data | undefined;
    // Official API links include utm_* attribution on artist profiles too.
    const authorUrl = text(author?.permalink_url, 1000)
      .split(/[?#]/, 1)[0]
      .replace(/\/$/, '');
    if (!/^https:\/\/soundcloud\.com\/[a-zA-Z0-9_-]+\/?$/.test(authorUrl))
      continue;
    const artwork = text(row.artwork_url, 1500);
    if (!tracks.has(link.url))
      tracks.set(link.url, {
        id: crypto.randomUUID(),
        url: link.url,
        title: text(row.title) || 'Без названия',
        artist: text(author?.username, 160) || 'SoundCloud',
        authorUrl,
        artwork: /^https:\/\/i\d+\.sndcdn\.com\//.test(artwork) ? artwork : '',
        durationMs:
          typeof row.duration === 'number' && Number.isFinite(row.duration)
            ? Math.max(0, Math.round(row.duration))
            : 0,
      });
  }
  if (!tracks.size && playlist.trackCount > 0)
    throw new ApiError(
      422,
      'В этом плейлисте нет доступных для импорта песен.',
    );
  if (tracks.size > MAX_IMPORTED_TRACKS)
    throw new ApiError(
      422,
      `Можно импортировать до ${MAX_IMPORTED_TRACKS} песен в один плейлист.`,
    );
  const id = crypto.randomUUID(),
    now = Date.now(),
    json = JSON.stringify([...tracks.values()]);
  // One D1 transaction: no half-imported playlist, orphaned songs or duplicates
  // if two tabs import together or the connection is revoked during fetching.
  await db().batch([
    db()
      .prepare(`INSERT INTO music_playlists(id,ownerId,name,created,updatedAt)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM music_connections WHERE userId=? AND provider='soundcloud' AND id=?)
      AND NOT EXISTS(SELECT 1 FROM account_restrictions WHERE userId=? AND (expiresAt IS NULL OR expiresAt>?))
      AND (SELECT COUNT(*) FROM music_playlists WHERE ownerId=?)<20
      AND NOT EXISTS(SELECT 1 FROM music_imports WHERE userId=? AND provider='soundcloud' AND playlistId=? AND localPlaylistId IS NOT NULL)`)
      .bind(
        id,
        user,
        playlist.title.slice(0, 80),
        now,
        now,
        user,
        connectionId,
        user,
        now,
        user,
        user,
        playlist.id,
      ),
    db()
      .prepare(`INSERT OR IGNORE INTO music_tracks(id,url,kind,provider,title,artist,artwork,authorUrl,durationMs,created)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.url'),'track','soundcloud',json_extract(value,'$.title'),
      json_extract(value,'$.artist'),json_extract(value,'$.artwork'),json_extract(value,'$.authorUrl'),json_extract(value,'$.durationMs'),?
      FROM json_each(?) WHERE EXISTS(SELECT 1 FROM music_playlists WHERE id=?)`)
      .bind(now, json, id),
    db()
      .prepare(`INSERT INTO music_playlist_members(playlistId,userId,status,created)
      SELECT id,ownerId,'accepted',created FROM music_playlists WHERE id=?`)
      .bind(id),
    db()
      .prepare(`INSERT INTO music_playlist_tracks(playlistId,trackId,addedBy,created,sortOrder)
      SELECT p.id,t.id,p.ownerId,?,CAST(j.key AS INTEGER) FROM json_each(?) j
      JOIN music_tracks t ON t.url=json_extract(j.value,'$.url') JOIN music_playlists p ON p.id=?`)
      .bind(now, json, id),
    db()
      .prepare(`INSERT INTO music_imports(userId,provider,playlistId,connectionId,localPlaylistId,title,url,artwork,trackCount,playable,imported)
      SELECT ownerId,'soundcloud',?,?,?,?,?,?,?,?,? FROM music_playlists WHERE id=?
      ON CONFLICT(userId,provider,playlistId) DO UPDATE SET connectionId=excluded.connectionId,localPlaylistId=excluded.localPlaylistId,
      title=excluded.title,url=excluded.url,artwork=excluded.artwork,trackCount=excluded.trackCount,playable=excluded.playable,imported=excluded.imported`)
      .bind(
        playlist.id,
        connectionId,
        id,
        playlist.title,
        playlist.url,
        playlist.artwork,
        playlist.trackCount,
        playlist.playable ? 1 : 0,
        now,
        id,
      ),
  ]);
  const saved = await db()
    .prepare(`SELECT i.localPlaylistId,(SELECT COUNT(*) FROM music_playlist_tracks WHERE playlistId=p.id) AS importedTrackCount
    FROM music_imports i JOIN music_playlists p ON p.id=i.localPlaylistId AND p.ownerId=i.userId
    WHERE i.userId=? AND i.provider='soundcloud' AND i.playlistId=?`)
    .bind(user, playlist.id)
    .first<{ localPlaylistId: string; importedTrackCount: number }>();
  if (!saved)
    throw new ApiError(
      409,
      'Не удалось импортировать плейлист. Проверьте подключение и лимит в 20 плейлистов.',
    );
  return { ...playlist, ...saved, imported: true };
}
