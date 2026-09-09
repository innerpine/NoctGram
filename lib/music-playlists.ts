import { db } from './storage';
import { ApiError } from './api-error';
import { visibleAccount } from './account-access';
import { parseMusicLink, type MusicTrack } from './music-links';
import { resolveTrack } from './music-track-resolver';
import { moveMusicItem } from './music-queue';
import {
  roomPosition,
  type PlaylistDetail,
  type PlaylistSummary,
} from './music-playlist-types';

const LEASE = 70000;
// Alias u is the proposed guest; these four bindings are the inviting user.
const inviteAllowed = `u.id<>? AND u.kind='person' AND ${visibleAccount('u')}
  AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker=? AND blocked=u.id) OR (blocker=u.id AND blocked=?))
  AND (COALESCE((SELECT messagePolicy FROM user_privacy WHERE userId=u.id),'everyone')='everyone'
    OR ((SELECT messagePolicy FROM user_privacy WHERE userId=u.id)='following' AND EXISTS(SELECT 1 FROM follows WHERE follower=u.id AND following=?)))`;
const allowed = `EXISTS(SELECT 1 FROM music_playlist_members am JOIN music_playlists ap ON ap.id=am.playlistId
  JOIN users u ON u.id=ap.ownerId WHERE am.playlistId=music_playlists.id AND am.userId=? AND am.status='accepted'
  AND ${visibleAccount('u')} AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker=am.userId AND blocked=ap.ownerId) OR (blocker=ap.ownerId AND blocked=am.userId)))`;
function value(input: unknown, max = 100) {
  if (typeof input !== 'string' || !input.trim() || input.length > max)
    throw new ApiError(400, 'Проверьте введённые данные');
  return input.trim();
}
function session(input: unknown) {
  const result = value(input, 80);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(result))
    throw new ApiError(400, 'Некорректный сеанс');
  return result;
}
type Row = {
  id: string;
  ownerId: string;
  name: string;
} & PlaylistDetail['playback'];
async function member(me: string, id: string): Promise<Row> {
  const row = await db()
    .prepare(`SELECT * FROM music_playlists WHERE id=? AND ${allowed}`)
    .bind(id, me)
    .first<Row>();
  if (!row) throw new ApiError(404, 'Плейлист недоступен');
  return row;
}
export async function listPlaylists(me: string) {
  const result = await db()
    .prepare(`SELECT p.id,p.name,p.ownerId,u.name AS ownerName,p.created,p.updatedAt,m.status,
    (SELECT COUNT(*) FROM music_playlist_tracks WHERE playlistId=p.id) AS trackCount,
    (SELECT COUNT(*) FROM music_playlist_members WHERE playlistId=p.id AND status='accepted') AS memberCount,
    (SELECT t.artwork FROM music_playlist_tracks pt JOIN music_tracks t ON t.id=pt.trackId WHERE pt.playlistId=p.id ORDER BY pt.sortOrder,pt.created,t.id LIMIT 1) AS artwork
    FROM music_playlists p JOIN music_playlist_members m ON m.playlistId=p.id JOIN users u ON u.id=p.ownerId
    WHERE m.userId=? AND ${visibleAccount('u')} AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker=? AND blocked=u.id) OR (blocker=u.id AND blocked=?))
    ORDER BY p.updatedAt DESC,p.id LIMIT 100`)
    .bind(me, me, me)
    .all<PlaylistSummary>();
  return {
    playlists: result.results.filter((p) => p.status === 'accepted'),
    invitations: result.results.filter((p) => p.status === 'invited'),
  };
}
export async function trackPlaylists(me: string, url: string) {
  const link = parseMusicLink(url);
  if (!link || link.kind !== 'track')
    throw new ApiError(400, 'Выберите отдельную песню');
  const lists = await listPlaylists(me);
  const saved = await db()
    .prepare(`SELECT pt.playlistId,pt.trackId FROM music_playlist_tracks pt
    JOIN music_tracks t ON t.id=pt.trackId JOIN music_playlists p ON p.id=pt.playlistId
    WHERE p.ownerId=? AND t.url=?`)
    .bind(me, link.url)
    .all<{ playlistId: string; trackId: string }>();
  return {
    playlists: lists.playlists
      .filter((p) => p.ownerId === me)
      .map((p) => ({
        ...p,
        savedTrackId:
          saved.results.find((t) => t.playlistId === p.id)?.trackId || null,
      })),
  };
}
export async function readPlaylist(
  me: string,
  id: string,
  now = Date.now(),
): Promise<PlaylistDetail> {
  const row = await member(me, id);
  const [tracks, members, mine] = await Promise.all([
    db()
      .prepare(
        `SELECT t.* FROM music_playlist_tracks pt JOIN music_tracks t ON t.id=pt.trackId WHERE pt.playlistId=? ORDER BY pt.sortOrder,pt.created,t.id`,
      )
      .bind(id)
      .all<MusicTrack>(),
    db()
      .prepare(`SELECT m.userId,u.name,u.avatar,COALESCE(h.handle,'') AS handle,m.status,
      CASE WHEN m.listenUntil>? THEN 1 ELSE 0 END AS listening
      FROM music_playlist_members m JOIN users u ON u.id=m.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1
      WHERE m.playlistId=? AND ${visibleAccount('u')} ORDER BY m.created,m.userId`)
      .bind(now, id)
      .all<PlaylistDetail['members'][number]>(),
    db()
      .prepare(
        'SELECT listenSession,listenUntil FROM music_playlist_members WHERE playlistId=? AND userId=?',
      )
      .bind(id, me)
      .first<{ listenSession: string; listenUntil: number }>(),
  ]);
  return {
    id,
    name: row.name,
    ownerId: row.ownerId,
    me,
    tracks: tracks.results,
    members: members.results,
    listenSession: mine && mine.listenUntil > now ? mine.listenSession : '',
    serverTime: now,
    playback: {
      trackId: row.trackId,
      playing: row.playing,
      positionMs: row.positionMs,
      durationMs: row.durationMs,
      playbackAt: row.playbackAt,
      revision: row.revision,
    },
  };
}
export async function changePlaylist(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  const action = value(body.action, 30);
  if (action === 'create') {
    const id = crypto.randomUUID(),
      name = value(body.name, 80);
    const initial = body.trackIds ?? [];
    if (!Array.isArray(initial) || initial.length > 50)
      throw new ApiError(400, 'При создании можно выбрать до 50 песен');
    const trackIds = [...new Set(initial.map((trackId) => value(trackId)))];
    const friendHandle =
      body.friendHandle === undefined || body.friendHandle === ''
        ? ''
        : value(body.friendHandle).replace(/^@/, '').toLowerCase();
    const friend = friendHandle
      ? await db()
          .prepare(
            `SELECT u.id FROM users u JOIN handles h ON h.userId=u.id WHERE h.handle=? COLLATE NOCASE AND ${inviteAllowed}`,
          )
          .bind(friendHandle, me, me, me, me)
          .first<{ id: string }>()
      : null;
    if (friendHandle && !friend)
      throw new ApiError(
        400,
        'Не удалось пригласить друга. Проверьте @ник и настройки приватности',
      );
    const trackGuard = trackIds.length
      ? `AND (SELECT COUNT(*) FROM music_library l JOIN music_tracks t ON t.id=l.trackId WHERE l.userId=? AND t.kind='track' AND t.provider='soundcloud' AND l.trackId IN (${trackIds.map(() => '?').join(',')}))=?`
      : '';
    const friendGuard = friend
      ? `AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND ${inviteAllowed})`
      : '';
    const result = await db().batch([
      db()
        .prepare(
          `INSERT INTO music_playlists(id,ownerId,name,created,updatedAt) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM music_playlists WHERE ownerId=?)<20 ${trackGuard} ${friendGuard}`,
        )
        .bind(
          id,
          me,
          name,
          now,
          now,
          me,
          ...(trackIds.length ? [me, ...trackIds, trackIds.length] : []),
          ...(friend ? [friend.id, me, me, me, me] : []),
        ),
      db()
        .prepare(
          `INSERT INTO music_playlist_members(playlistId,userId,status,created) SELECT id,ownerId,'accepted',created FROM music_playlists WHERE id=?`,
        )
        .bind(id),
      ...trackIds.map((trackId, index) =>
        db()
          .prepare(
            `INSERT INTO music_playlist_tracks(playlistId,trackId,addedBy,created) SELECT id,?,ownerId,? FROM music_playlists WHERE id=?`,
          )
          .bind(trackId, now + index, id),
      ),
      ...(friend
        ? [
            db()
              .prepare(
                `INSERT INTO music_playlist_members(playlistId,userId,status,created) SELECT id,?,'invited',? FROM music_playlists WHERE id=?`,
              )
              .bind(friend.id, now, id),
          ]
        : []),
    ]);
    if (!result[0].meta.changes)
      throw new ApiError(
        409,
        'Не удалось создать плейлист. Проверьте выбранные песни и лимит в 20 плейлистов',
      );
    return readPlaylist(me, id, now);
  }
  const id = value(body.id);
  if (action === 'accept' || action === 'decline') {
    if (action === 'decline') {
      await db()
        .prepare(
          "DELETE FROM music_playlist_members WHERE playlistId=? AND userId=? AND status='invited'",
        )
        .bind(id, me)
        .run();
      return { ok: true };
    }
    await db()
      .prepare(`UPDATE music_playlist_members SET status='accepted' WHERE playlistId=? AND userId=? AND status='invited'
      AND EXISTS(SELECT 1 FROM music_playlists p JOIN users u ON u.id=p.ownerId WHERE p.id=playlistId AND ${visibleAccount('u')}
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker=? AND blocked=u.id) OR (blocker=u.id AND blocked=?)))`)
      .bind(id, me, me, me)
      .run();
    return readPlaylist(me, id, now);
  }
  const row = await member(me, id);
  const owner = row.ownerId === me;
  if (['rename', 'invite', 'kick', 'delete'].includes(action) && !owner)
    throw new ApiError(403, 'Это действие доступно владельцу');
  if (action === 'rename') {
    await db()
      .prepare(
        `UPDATE music_playlists SET name=?,updatedAt=? WHERE id=? AND ownerId=?`,
      )
      .bind(value(body.name, 80), now, id, me)
      .run();
  } else if (action === 'delete') {
    await db()
      .prepare('DELETE FROM music_playlists WHERE id=? AND ownerId=?')
      .bind(id, me)
      .run();
    return { ok: true };
  } else if (action === 'invite') {
    const handle = value(body.handle, 100).replace(/^@/, '').toLowerCase();
    const result = await db()
      .prepare(`INSERT OR IGNORE INTO music_playlist_members(playlistId,userId,status,created)
      SELECT p.id,u.id,'invited',? FROM music_playlists p JOIN handles h ON h.handle=? COLLATE NOCASE JOIN users u ON u.id=h.userId
      WHERE p.id=? AND p.ownerId=? AND ${inviteAllowed}
      AND (SELECT COUNT(*) FROM music_playlist_members WHERE playlistId=p.id)<32
      `)
      .bind(now, handle, id, me, me, me, me, me)
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        409,
        'Не удалось пригласить: проверьте @ник, настройки приватности или состав участников',
      );
  } else if (action === 'kick' || action === 'leave') {
    const target = action === 'leave' ? me : value(body.userId);
    if (target === row.ownerId)
      throw new ApiError(400, 'Владелец может удалить плейлист в настройках');
    await db()
      .prepare(
        'DELETE FROM music_playlist_members WHERE playlistId=? AND userId=?',
      )
      .bind(id, target)
      .run();
    if (action === 'leave') return { ok: true };
  } else if (action === 'reorder') {
    const trackId = value(body.trackId),
      targetId = value(body.targetId);
    const tracks = (
      await db()
        .prepare(
          `SELECT trackId FROM music_playlist_tracks WHERE playlistId=? ORDER BY sortOrder,created,trackId`,
        )
        .bind(id)
        .all<{ trackId: string }>()
    ).results.map((t) => t.trackId);
    const from = tracks.indexOf(trackId),
      to = tracks.indexOf(targetId);
    if (from < 0 || to < 0)
      throw new ApiError(409, 'Очередь изменилась. Попробуйте ещё раз');
    if (from !== to) {
      const ordered = moveMusicItem(tracks, from, to);
      // Compare the complete order atomically: a concurrent edit must not be overwritten.
      const result = await db()
        .prepare(`WITH original AS MATERIALIZED (SELECT json_group_array(trackId) AS ids FROM (SELECT trackId FROM music_playlist_tracks WHERE playlistId=? ORDER BY sortOrder,created,trackId))
        UPDATE music_playlist_tracks SET sortOrder=(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=trackId)
        WHERE playlistId=? AND EXISTS(SELECT 1 FROM music_playlists WHERE id=? AND ${allowed})
        AND (SELECT ids FROM original)=?`)
        .bind(id, JSON.stringify(ordered), id, id, me, JSON.stringify(tracks))
        .run();
      if (!result.meta.changes)
        throw new ApiError(409, 'Очередь изменилась. Попробуйте ещё раз');
      await db()
        .prepare(
          `UPDATE music_playlists SET updatedAt=? WHERE id=? AND ${allowed}`,
        )
        .bind(now, id, me)
        .run();
    }
  } else if (action === 'add') {
    const link = parseMusicLink(body.url);
    if (!link || link.kind !== 'track')
      throw new ApiError(400, 'Добавьте ссылку на отдельную песню');
    if (link.provider !== 'soundcloud')
      throw new ApiError(400, 'Добавьте ссылку на песню SoundCloud.');
    const limit = await db()
      .prepare(
        `INSERT INTO auth_limits(key,count,expiresAt) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<30 RETURNING count`,
      )
      .bind('playlist-add:' + me + ':' + Math.floor(now / 60000), now + 60000)
      .first();
    if (!limit)
      throw new ApiError(429, 'Подождите минуту перед добавлением новых песен');
    const track = await resolveTrack(link);
    const result = await db().batch([
      db()
        .prepare(`INSERT OR IGNORE INTO music_playlist_tracks(playlistId,trackId,addedBy,created,sortOrder) SELECT id,?,?,?,COALESCE((SELECT MAX(sortOrder)+1 FROM music_playlist_tracks WHERE playlistId=music_playlists.id),0) FROM music_playlists WHERE id=? AND ${allowed}
        AND (SELECT COUNT(*) FROM music_playlist_tracks WHERE playlistId=music_playlists.id)<200`)
        .bind(track.id, me, now, id, me),
      db()
        .prepare(
          `UPDATE music_playlists SET updatedAt=? WHERE id=? AND ${allowed}`,
        )
        .bind(now, id, me),
    ]);
    if (
      !result[0].meta.changes &&
      !(await db()
        .prepare(
          'SELECT 1 FROM music_playlist_tracks WHERE playlistId=? AND trackId=?',
        )
        .bind(id, track.id)
        .first())
    )
      throw new ApiError(409, 'Плейлист недоступен или в нём уже 200 песен');
  } else if (action === 'remove') {
    const trackId = value(body.trackId);
    // Clear room playback first if the currently selected track is removed.
    await db().batch([
      db()
        .prepare(
          `UPDATE music_playlists SET trackId=NULL,playing=0,positionMs=0,durationMs=0,revision=revision+1,playbackAt=? WHERE id=? AND trackId=? AND ${allowed}`,
        )
        .bind(now, id, trackId, me),
      db()
        .prepare(
          `DELETE FROM music_playlist_tracks WHERE playlistId=? AND trackId=? AND EXISTS(SELECT 1 FROM music_playlists WHERE id=? AND ${allowed})`,
        )
        .bind(id, trackId, id, me),
    ]);
  } else if (
    action === 'join' ||
    action === 'heartbeat' ||
    action === 'detach'
  ) {
    const token = session(body.session);
    const freezeEmptyRoom = db()
      .prepare(`UPDATE music_playlists SET positionMs=CASE WHEN durationMs>0
      THEN MIN(durationMs,positionMs+MAX(0,?-playbackAt)) ELSE positionMs+MAX(0,?-playbackAt) END,
      playing=0,playbackAt=?,revision=revision+1 WHERE id=? AND playing=1
      AND NOT EXISTS(SELECT 1 FROM music_playlist_members WHERE playlistId=? AND listenUntil>?)`)
      .bind(now, now, now, id, id, now);
    const updateListener = db()
      .prepare(`UPDATE music_playlist_members SET listenSession=?,listenUntil=? WHERE playlistId=? AND userId=? AND status='accepted'
      ${action === 'join' ? '' : 'AND listenSession=?'}`)
      .bind(
        action === 'detach' ? '' : token,
        action === 'detach' ? 0 : now + LEASE,
        id,
        me,
        ...(action === 'join' ? [] : [token]),
      );
    await db().batch(
      action === 'join'
        ? [freezeEmptyRoom, updateListener]
        : action === 'detach'
          ? [updateListener, freezeEmptyRoom]
          : [updateListener],
    );
    if (action === 'detach') return { ok: true };
  } else if (action === 'control') {
    const token = session(body.session),
      revision = body.revision;
    if (!Number.isSafeInteger(revision) || Number(revision) < 0)
      throw new ApiError(400, 'Некорректная версия плеера');
    const command = value(body.command, 20);
    let trackId = row.trackId,
      position = roomPosition(row, now),
      duration = row.durationMs,
      playing = row.playing;
    if (command === 'play' || command === 'advance') {
      const tracks = (
        await db()
          .prepare(
            `SELECT t.id,t.durationMs FROM music_playlist_tracks pt JOIN music_tracks t ON t.id=pt.trackId WHERE pt.playlistId=? ORDER BY pt.sortOrder,pt.created,t.id`,
          )
          .bind(id)
          .all<{ id: string; durationMs: number }>()
      ).results;
      const next =
        command === 'play'
          ? tracks.find((t) => t.id === body.trackId)
          : tracks[
              (tracks.findIndex((t) => t.id === row.trackId) + 1) %
                tracks.length
            ];
      if (!next) throw new ApiError(400, 'Добавьте песню в плейлист');
      if (
        command === 'advance' &&
        (!row.playing ||
          row.durationMs <= 0 ||
          position < row.durationMs - 2000)
      )
        throw new ApiError(409, 'Песня ещё играет');
      trackId = next.id;
      position = 0;
      duration = next.durationMs || 0;
      playing = 1;
    } else if (command === 'pause') {
      playing = 0;
    } else if (command === 'resume') {
      playing = 1;
    } else if (command === 'seek' || command === 'duration') {
      const input = command === 'seek' ? body.positionMs : body.durationMs;
      if (
        typeof input !== 'number' ||
        !Number.isFinite(input) ||
        input < 0 ||
        input > 86400000
      )
        throw new ApiError(400, 'Некорректная позиция песни');
      if (command === 'seek') position = Math.min(input, duration || input);
      else {
        if (input === 0) throw new ApiError(400, 'Некорректная длительность');
        duration = input;
      }
    } else throw new ApiError(400, 'Неизвестная команда');
    if (!trackId) throw new ApiError(400, 'Сначала выберите песню');
    const result = await db()
      .prepare(`UPDATE music_playlists SET trackId=?,playing=?,positionMs=?,durationMs=?,playbackAt=?,revision=revision+1
      WHERE id=? AND revision=? AND ${allowed} AND EXISTS(SELECT 1 FROM music_playlist_members WHERE playlistId=? AND userId=? AND listenSession=? AND listenUntil>?)`)
      .bind(
        trackId,
        playing,
        Math.round(position),
        Math.round(duration),
        now,
        id,
        revision,
        me,
        id,
        me,
        token,
        now,
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError(409, 'Плеер уже изменился. Синхронизируем состояние…');
  } else throw new ApiError(400, 'Неизвестное действие');
  return readPlaylist(me, id, now);
}
