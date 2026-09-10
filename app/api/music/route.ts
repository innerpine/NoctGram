import {
  recordMusicListen,
  musicScoreEligible as eligible,
} from '@/lib/music-score';
import { rateLimit } from '@/lib/rate-limit';
import { queueStorageDeletion } from '@/lib/upload-storage';
import { appearanceColumns } from '@/lib/premium-access';
import { bucket, db, viewer, ApiError, failure } from '@/lib/server';
import { resolveTrack } from '@/lib/music-track-resolver';
import {
  assertReadable,
  assertWritable,
  visibleAccount,
} from '@/lib/account-access';
import { personalVisibility } from '@/lib/privacy';
import { readJsonBody } from '@/lib/request-body';
import { parseMusicLink, type MusicTrack } from '@/lib/music-links';

export const dynamic = 'force-dynamic';
const DAY = 86400000;
// Listening is automatic. Check account eligibility again inside score writes
// so a restriction added during playback still prevents a new score.

export async function GET(req: Request) {
  try {
    const me = await viewer();
    await assertReadable(me);
    const params = new URL(req.url).searchParams;
    if (params.get('action') === 'track') {
      const link = parseMusicLink(params.get('url'));
      if (link?.provider !== 'spotify')
        throw new ApiError(400, 'Нужна ссылка Spotify.');
      const track = await db()
        .prepare(
          "SELECT t.*, CASE WHEN a.objectKey IS NOT NULL THEN '/api/music/audio/' || t.id ELSE NULL END AS audioUrl FROM music_library l JOIN music_tracks t ON t.id=l.trackId LEFT JOIN music_audio a ON a.userId=l.userId AND a.trackId=t.id WHERE l.userId=? AND t.url=?",
        )
        .bind(me, link.url)
        .first<MusicTrack>();
      if (!track)
        throw new ApiError(404, 'Сначала добавьте этот трек в «Мою музыку».');
      return Response.json(track, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (params.get('action') !== 'home')
      throw new ApiError(400, 'Неизвестное действие');
    const period = params.get('period') || '7';
    if (!['today', '7', '30'].includes(period))
      throw new ApiError(400, 'Неизвестный период чарта');
    const chart = params.get('charts') !== '0';
    const leaders = chart || params.get('leaders') === '1';
    const d = db(),
      since =
        period === 'today'
          ? Math.floor(Date.now() / DAY) * DAY
          : Math.floor(Date.now() / DAY) * DAY - (Number(period) - 1) * DAY;
    const visibility = `${visibleAccount('u')} AND ${personalVisibility('u')}`;
    const [profile, library, discoveries, tracks, listeners, mine] =
      await Promise.all([
        d
          .prepare(
            `SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle FROM users u JOIN handles h ON h.userId=u.id AND h.main=1 WHERE u.id=?`,
          )
          .bind(me)
          .first(),
        d
          .prepare(
            "SELECT t.*, CASE WHEN a.objectKey IS NOT NULL THEN '/api/music/audio/' || t.id ELSE NULL END AS audioUrl FROM music_library l JOIN music_tracks t ON t.id=l.trackId LEFT JOIN music_audio a ON a.userId=l.userId AND a.trackId=t.id WHERE l.userId=? ORDER BY l.created DESC,t.id LIMIT 100",
          )
          .bind(me)
          .all(),
        d
          .prepare(
            `SELECT t.*,COUNT(*) as shared FROM music_library l JOIN music_tracks t ON t.id=l.trackId JOIN users u ON u.id=l.userId WHERE t.provider='soundcloud' AND ${visibility} GROUP BY t.id ORDER BY MAX(l.created) DESC,t.id LIMIT 50`,
          )
          .bind(me)
          .all(),
        chart
          ? d
              .prepare(
                `SELECT t.*,SUM(l.plays) as plays,COUNT(DISTINCT l.userId) as listeners FROM music_listens l JOIN music_tracks t ON t.id=l.trackId JOIN users u ON u.id=l.userId WHERE l.created>=? AND ${visibility} GROUP BY t.id ORDER BY plays DESC,t.id LIMIT 30`,
              )
              .bind(since, me)
              .all()
          : { results: [] },
        leaders
          ? d
              .prepare(
                `SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle,SUM(l.plays) as plays,COUNT(DISTINCT l.trackId) as tracks FROM music_listens l JOIN users u ON u.id=l.userId JOIN handles h ON h.userId=u.id AND h.main=1 WHERE l.created>=? AND ${visibility} GROUP BY u.id ORDER BY plays DESC,u.id LIMIT 25`,
              )
              .bind(since, me)
              .all()
          : { results: [] },
        leaders
          ? d
              .prepare(`WITH ranked AS (
          SELECT u.id,SUM(l.plays) AS plays,COUNT(DISTINCT l.trackId) AS tracks,
          ROW_NUMBER() OVER (ORDER BY SUM(l.plays) DESC,u.id) AS rank
          FROM music_listens l JOIN users u ON u.id=l.userId JOIN handles h ON h.userId=u.id AND h.main=1
          WHERE l.created>=? AND ${visibility} GROUP BY u.id
        ) SELECT COALESCE(r.plays,0) AS plays,COALESCE(r.tracks,0) AS tracks,r.rank,
          (SELECT COUNT(*) FROM ranked) AS participants FROM (SELECT 1) LEFT JOIN ranked r ON r.id=?`)
              .bind(since, me, me)
              .first()
          : null,
      ]);
    return Response.json(
      {
        profile,
        library: library.results,
        discoveries: discoveries.results,
        tracks: tracks.results.map((track) => ({
          ...track,
          audioUrl:
            library.results.find((item) => item.id === track.id)?.audioUrl ||
            null,
        })),
        listeners: listeners.results,
        mine,
        period,
        updatedAt: Date.now(),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    if (
      (req.headers.get('origin') &&
        req.headers.get('origin') !== new URL(req.url).origin) ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new ApiError(403, 'Недопустимый источник');
    const me = await viewer();
    await assertReadable(me);
    const body = await readJsonBody(req, 4096),
      d = db(),
      now = Date.now();
    await rateLimit(
      body.action === 'progress' ? 'music-progress' : 'music-actions',
      me,
      body.action === 'progress' ? 120 : 30,
      60,
    );
    if (body.action === 'preferences')
      throw new ApiError(
        400,
        'Прослушивания учитываются автоматически. Обновите страницу.',
      );
    await assertWritable(me);
    if (
      body.action === 'save' ||
      body.action === 'start' ||
      body.action === 'resolve'
    ) {
      const link = parseMusicLink(body.url);
      if (!link)
        throw new ApiError(
          400,
          body.action === 'save'
            ? 'Нужна ссылка на трек или плейлист SoundCloud.'
            : 'Нужна корректная ссылка на музыку.',
        );
      if (body.action === 'save' && link.provider !== 'soundcloud')
        throw new ApiError(400, 'Добавлять музыку можно только из SoundCloud.');
      if (body.action === 'resolve' && link.provider !== 'youtube')
        throw new ApiError(400, 'Неизвестный источник видео.');
      if (body.action === 'start') {
        if (link.provider === 'youtube')
          throw new ApiError(
            400,
            'Просмотры YouTube не участвуют в рейтинге слушателей.',
          );
        if (link.kind !== 'track')
          throw new ApiError(400, 'Засчитываются отдельные треки');
        if (
          link.provider === 'spotify' &&
          !(await d
            .prepare(
              'SELECT 1 FROM music_audio a JOIN music_library l ON l.userId=a.userId AND l.trackId=a.trackId JOIN music_tracks t ON t.id=a.trackId WHERE a.userId=? AND t.url=?',
            )
            .bind(me, link.url)
            .first())
        )
          throw new ApiError(
            400,
            'Добавьте свой аудиофайл, чтобы учитывать его прослушивания.',
          );
      }
      // Bound external metadata requests using the existing short-lived limit table.
      const key = 'music:' + me + ':' + Math.floor(now / 60000);
      const limit = await d
        .prepare(
          'INSERT INTO auth_limits(key,count,expiresAt) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<30 RETURNING count',
        )
        .bind(key, now + 60000)
        .first();
      if (!limit)
        throw new ApiError(429, 'Слишком много запросов. Подождите минуту.');
      await d
        .prepare('DELETE FROM auth_limits WHERE key LIKE ? AND expiresAt<?')
        .bind('music:' + me + ':%', now)
        .run();
      const track = await resolveTrack(link);
      if (body.action === 'resolve') return Response.json(track);
      if (body.action === 'save') {
        const result = await d
          .prepare(`INSERT OR IGNORE INTO music_library(userId,trackId,created) SELECT ?,?,? WHERE
          (SELECT COUNT(*) FROM music_library WHERE userId=?)<100 AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=? AND (ar.expiresAt IS NULL OR ar.expiresAt>?))`)
          .bind(me, track.id, now, me, me, now)
          .run();
        if (
          !result.meta.changes &&
          !(await d
            .prepare('SELECT 1 FROM music_library WHERE userId=? AND trackId=?')
            .bind(me, track.id)
            .first())
        )
          throw new ApiError(
            409,
            'Не удалось добавить запись. В коллекции может быть не больше 100 ссылок.',
          );
        return Response.json(track);
      }
      const id = crypto.randomUUID(),
        started = Date.now();
      const result = await d
        .prepare(`INSERT INTO music_sessions(userId,id,trackId,created,updated,totalMs,counted) SELECT ?,?,?,?,?,0,0 WHERE ${eligible}
        ON CONFLICT(userId) DO UPDATE SET id=excluded.id,trackId=excluded.trackId,created=excluded.created,updated=excluded.updated,totalMs=0,counted=0`)
        .bind(me, id, track.id, started, started, me)
        .run();
      return Response.json({ session: result.meta.changes ? id : null });
    }
    if (body.action === 'remove') {
      if (typeof body.id !== 'string')
        throw new ApiError(400, 'Некорректная запись');
      const pendingAudio = await d
        .prepare(
          'SELECT objectKey FROM music_audio WHERE userId=? AND trackId=?',
        )
        .bind(me, body.id)
        .first<{ objectKey: string }>();
      if (pendingAudio) await queueStorageDeletion(pendingAudio.objectKey);
      await d
        .prepare('DELETE FROM music_library WHERE userId=? AND trackId=?')
        .bind(me, body.id)
        .run();
      const audio = await d
        .prepare(
          'DELETE FROM music_audio WHERE userId=? AND trackId=? RETURNING objectKey',
        )
        .bind(me, body.id)
        .first<{ objectKey: string }>();
      if (audio)
        await bucket()
          .delete(audio.objectKey)
          .catch(() => {});
      return Response.json({ ok: true });
    }
    if (body.action === 'progress') {
      if (
        typeof body.session !== 'string' ||
        typeof body.totalMs !== 'number' ||
        !Number.isSafeInteger(body.totalMs) ||
        body.totalMs < 0 ||
        body.totalMs > 3600000
      )
        throw new ApiError(400, 'Некорректное событие воспроизведения');
      const result = await d
        .prepare(
          `UPDATE music_sessions SET totalMs=?,updated=? WHERE userId=? AND id=? AND created>? AND totalMs<=? AND ?<=?-created+1000 AND ?<=totalMs+?-updated+1000 AND ${eligible} RETURNING totalMs`,
        )
        .bind(
          body.totalMs,
          now,
          me,
          body.session,
          now - 3600000,
          body.totalMs,
          body.totalMs,
          now,
          body.totalMs,
          now,
          me,
        )
        .first<{ totalMs: number }>();
      if (!result)
        throw new ApiError(
          409,
          'Сессия прослушивания истекла или событие пришло слишком рано',
        );
      if (result.totalMs < 30000) return Response.json({ counted: false });
      const counted = await recordMusicListen(me, body.session, now);
      return Response.json({ counted });
    }
    throw new ApiError(400, 'Неизвестное действие');
  } catch (e) {
    return failure(e);
  }
}
