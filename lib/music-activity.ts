import { db } from './storage';
import { ApiError } from './api-error';
import { visibleAccount } from './account-access';
import { parseMusicLink, type MusicProviderId } from './music-links';
import { playerArtwork } from './music-player';

export const ACTIVITY_TTL = 70000;
export type MusicCompanion = {
  userId: string;
  name: string;
  avatar: string;
  handle: string;
  expiresAt: number;
};
export type MusicActivity = {
  trackUrl: string;
  title: string;
  artist: string;
  artwork: string;
  provider: MusicProviderId;
  state: 'playing' | 'paused';
  positionMs: number;
  durationMs: number;
  updatedAt: number;
  expiresAt: number;
  listeningWith: MusicCompanion[];
};
export async function musicActivityEnabled(me: string) {
  const row = await db()
    .prepare('SELECT showMusicActivity FROM user_privacy WHERE userId=?')
    .bind(me)
    .first();
  return row?.showMusicActivity !== 0;
}
export async function setMusicActivityEnabled(me: string, enabled: unknown) {
  if (typeof enabled !== 'boolean')
    throw new ApiError(400, 'Проверь настройку активности');
  await db().batch([
    db()
      .prepare(`INSERT INTO user_privacy(userId,showMusicActivity) VALUES(?,?)
      ON CONFLICT(userId) DO UPDATE SET showMusicActivity=excluded.showMusicActivity`)
      .bind(me, Number(enabled)),
    // Do not bring a previously hidden song back when sharing is enabled again.
    db()
      .prepare(
        `UPDATE music_activity SET trackUrl='',title='',artist='',artwork='',expiresAt=0 WHERE userId=?`,
      )
      .bind(me),
  ]);
  return { enabled };
}
export async function readMusicActivity(
  me: string,
  id: string,
  now = Date.now(),
) {
  const activity = await db()
    .prepare(`SELECT a.trackUrl,a.title,a.artist,a.artwork,a.provider,
      a.state,a.positionMs,a.durationMs,a.updatedAt,a.expiresAt
    FROM music_activity a JOIN users u ON u.id=a.userId
    WHERE a.userId=? AND a.expiresAt>? AND a.trackUrl<>''
      AND u.kind='person' AND ${visibleAccount('u')}
      AND COALESCE((SELECT showMusicActivity FROM user_privacy WHERE userId=u.id),1)=1
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker=? AND blocked=u.id) OR (blocker=u.id AND blocked=?))`)
    .bind(id, now, me, me)
    .first<Omit<MusicActivity, 'listeningWith'>>();
  if (!activity) return null;
  // Derive companions from the live room and each listener's actual playback,
  // never from client-supplied names or the playlist's invitation list. Choose
  // the most recently renewed room if a previous connection is still expiring.
  const companions = await db()
    .prepare(`WITH room AS (
      SELECT p.id,p.ownerId,self.listenUntil FROM music_playlist_members self
      JOIN music_playlists p ON p.id=self.playlistId
      JOIN music_tracks t ON t.id=p.trackId
      JOIN users owner ON owner.id=p.ownerId
      WHERE self.userId=? AND self.status='accepted' AND self.listenUntil>?
        AND self.listenSession<>'' AND t.url=? AND p.playing=?
        AND ${visibleAccount('owner')}
        AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE
          (blocker=self.userId AND blocked=p.ownerId) OR
          (blocker=p.ownerId AND blocked=self.userId))
      ORDER BY self.listenUntil DESC,p.id LIMIT 1
    ) SELECT u.id AS userId,u.name,u.avatar,COALESCE(h.handle,'') AS handle,
      MIN(room.listenUntil,m.listenUntil,a.expiresAt) AS expiresAt
    FROM room JOIN music_playlist_members m ON m.playlistId=room.id
    JOIN users u ON u.id=m.userId
    JOIN music_activity a ON a.userId=u.id
    LEFT JOIN handles h ON h.userId=u.id AND h.main=1
    WHERE u.id<>? AND m.status='accepted' AND m.listenUntil>? AND m.listenSession<>''
      AND a.expiresAt>? AND a.trackUrl=? AND a.state=?
      AND u.kind='person' AND ${visibleAccount('u')}
      AND COALESCE((SELECT showMusicActivity FROM user_privacy WHERE userId=u.id),1)=1
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE
        (blocker IN (?,?,room.ownerId) AND blocked=u.id) OR
        (blocker=u.id AND blocked IN (?,?,room.ownerId)))
    ORDER BY u.name,u.id LIMIT 31`)
    .bind(
      id,
      now,
      activity.trackUrl,
      activity.state === 'playing' ? 1 : 0,
      id,
      now,
      now,
      activity.trackUrl,
      activity.state,
      me,
      id,
      me,
      id,
    )
    .all<MusicCompanion>();
  return { ...activity, listeningWith: companions.results };
}
function text(value: unknown, max: number, required = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new ApiError(400, 'Некорректные данные трека');
  return value.trim();
}
export async function publishMusicActivity(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  const session = text(body.sessionId, 80, true),
    sequence = body.sequence;
  if (
    !/^[a-zA-Z0-9-]{16,80}$/.test(session) ||
    !Number.isSafeInteger(sequence) ||
    Number(sequence) < 1
  )
    throw new ApiError(400, 'Некорректный сеанс воспроизведения');
  // Older clients used playing=false to clear activity; keep that behavior.
  const state =
    body.state ??
    (typeof body.playing === 'boolean'
      ? body.playing
        ? 'playing'
        : 'stopped'
      : undefined);
  if (state !== 'playing' && state !== 'paused' && state !== 'stopped')
    throw new ApiError(400, 'Укажи состояние плеера');
  if (state === 'stopped') {
    // Keep the revision as a tombstone: a delayed heartbeat cannot resurrect it.
    await db()
      .prepare(`INSERT INTO music_activity(userId,sessionId,sequence,updatedAt,expiresAt) VALUES(?,?,?,?,0)
      ON CONFLICT(userId) DO UPDATE SET trackUrl='',title='',artist='',artwork='',expiresAt=0,sequence=excluded.sequence,updatedAt=excluded.updatedAt
      WHERE music_activity.sessionId=excluded.sessionId AND music_activity.sequence<excluded.sequence`)
      .bind(me, session, sequence, now)
      .run();
    return { enabled: await musicActivityEnabled(me) };
  }
  const link = parseMusicLink(body.url);
  if (!link || link.kind !== 'track')
    throw new ApiError(400, 'Нужна ссылка на трек');
  const title = text(body.title, 300, true),
    artist = text(body.artist, 200),
    artwork = playerArtwork(text(body.artwork || '', 2048));
  const duration = body.durationMs,
    position = body.positionMs;
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 86400000 ||
    typeof position !== 'number' ||
    !Number.isFinite(position) ||
    position < 0 ||
    position > duration
  )
    throw new ApiError(400, 'Некорректная позиция трека');
  const enabled = await musicActivityEnabled(me);
  if (!enabled) return { enabled: false };
  await db()
    .prepare(`INSERT INTO music_activity(userId,sessionId,sequence,trackUrl,title,artist,artwork,provider,state,positionMs,durationMs,updatedAt,expiresAt)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT showMusicActivity FROM user_privacy WHERE userId=?),1)=1
      ON CONFLICT(userId) DO UPDATE SET sessionId=excluded.sessionId,sequence=excluded.sequence,
        trackUrl=excluded.trackUrl,title=excluded.title,artist=excluded.artist,artwork=excluded.artwork,
        provider=excluded.provider,state=excluded.state,positionMs=excluded.positionMs,durationMs=excluded.durationMs,
        updatedAt=excluded.updatedAt,expiresAt=excluded.expiresAt
      WHERE (music_activity.sessionId=excluded.sessionId AND music_activity.sequence<excluded.sequence)
        OR (music_activity.sessionId<>excluded.sessionId AND (?=1 OR music_activity.expiresAt<=?))`)
    .bind(
      me,
      session,
      sequence,
      link.url,
      title,
      artist,
      artwork,
      link.provider,
      state,
      Math.round(position),
      Math.round(duration),
      now,
      now + ACTIVITY_TTL,
      me,
      body.claim === true && state === 'playing' ? 1 : 0,
      now,
    )
    .run();
  return { enabled: true };
}
