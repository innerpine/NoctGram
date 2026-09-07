import { db, viewer, ApiError, failure } from '@/lib/server';
import {
  assertReadable,
  assertWritable,
  visibleAccount,
} from '@/lib/account-access';
import { personalVisibility } from '@/lib/privacy';
import { readJsonBody } from '@/lib/request-body';
import {
  parseMusicLink,
  type MusicLink,
  type MusicTrack,
} from '@/lib/music-links';

export const dynamic = 'force-dynamic';
const DAY = 86400000;
// These predicates run inside score writes too, closing preference/moderation races.
const eligible = `EXISTS(SELECT 1 FROM music_preferences mp JOIN users u ON u.id=mp.userId
  WHERE mp.userId=? AND mp.participate=1 AND ${visibleAccount('u')}
  AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=u.id AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000)))`;

async function resolveTrack(link: MusicLink): Promise<MusicTrack> {
  const existing = await db()
    .prepare('SELECT * FROM music_tracks WHERE url=?')
    .bind(link.url)
    .first<MusicTrack>();
  if (existing) return existing;
  // Fixed endpoint, canonical public URL, no redirects, no client-provided HTML.
  let response: Response;
  try {
    response = await fetch(
      'https://soundcloud.com/oembed?' +
        new URLSearchParams({ format: 'json', url: link.url }),
      { redirect: 'manual', signal: AbortSignal.timeout(8000) },
    );
  } catch (error) {
    console.warn(
      'SoundCloud oEmbed request failed:',
      error instanceof Error ? error.message : 'Network error',
    );
    throw new ApiError(502, 'SoundCloud не отвечает. Попробуйте позже.');
  }
  if (!response.ok)
    throw new ApiError(
      422,
      'SoundCloud не нашёл публичную запись по этой ссылке.',
    );
  const info = (await response.json()) as {
    title?: unknown;
    author_name?: unknown;
    author_url?: unknown;
    thumbnail_url?: unknown;
  };
  if (typeof info.title !== 'string' || typeof info.author_name !== 'string')
    throw new ApiError(
      422,
      'Не удалось получить название записи из SoundCloud.',
    );
  const author = typeof info.author_url === 'string' ? info.author_url : '';
  if (!/^https:\/\/soundcloud\.com\/[a-zA-Z0-9_-]+\/?$/.test(author))
    throw new ApiError(422, 'Не удалось проверить автора записи.');
  const artwork =
    typeof info.thumbnail_url === 'string' &&
    /^https:\/\/i\d+\.sndcdn\.com\//.test(info.thumbnail_url)
      ? info.thumbnail_url
      : '';
  const track: MusicTrack = {
    ...link,
    id: crypto.randomUUID(),
    title: info.title.slice(0, 300),
    artist: info.author_name.slice(0, 160),
    artwork,
    authorUrl: author,
  };
  await db()
    .prepare(
      'INSERT OR IGNORE INTO music_tracks(id,url,kind,provider,title,artist,artwork,authorUrl,created) VALUES(?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      track.id,
      track.url,
      track.kind,
      track.provider,
      track.title,
      track.artist,
      track.artwork,
      track.authorUrl,
      Date.now(),
    )
    .run();
  return (await db()
    .prepare('SELECT * FROM music_tracks WHERE url=?')
    .bind(link.url)
    .first<MusicTrack>())!;
}

export async function GET(req: Request) {
  try {
    const me = await viewer();
    await assertReadable(me);
    if (new URL(req.url).searchParams.get('action') !== 'home')
      throw new ApiError(400, 'Неизвестное действие');
    const d = db(),
      since = Date.now() - 7 * DAY;
    const visibility = `${visibleAccount('u')} AND ${personalVisibility('u')}`;
    const [pref, library, discoveries, tracks, artists, listeners] =
      await Promise.all([
        d
          .prepare('SELECT participate FROM music_preferences WHERE userId=?')
          .bind(me)
          .first<{ participate: number }>(),
        d
          .prepare(
            'SELECT t.* FROM music_library l JOIN music_tracks t ON t.id=l.trackId WHERE l.userId=? ORDER BY l.created DESC,t.id LIMIT 100',
          )
          .bind(me)
          .all(),
        d
          .prepare(
            `SELECT t.*,COUNT(*) as shared FROM music_library l JOIN music_tracks t ON t.id=l.trackId JOIN users u ON u.id=l.userId WHERE ${visibility} GROUP BY t.id ORDER BY MAX(l.created) DESC,t.id LIMIT 50`,
          )
          .bind(me)
          .all(),
        d
          .prepare(
            `SELECT t.*,COUNT(*) as plays,COUNT(DISTINCT l.userId) as listeners FROM music_listens l JOIN music_tracks t ON t.id=l.trackId JOIN users u ON u.id=l.userId JOIN music_preferences mp ON mp.userId=u.id WHERE l.created>=? AND mp.participate=1 AND ${visibility} GROUP BY t.id ORDER BY plays DESC,t.id LIMIT 30`,
          )
          .bind(since, me)
          .all(),
        d
          .prepare(
            `SELECT t.artist,t.authorUrl,COUNT(*) as plays,COUNT(DISTINCT t.id) as tracks FROM music_listens l JOIN music_tracks t ON t.id=l.trackId JOIN users u ON u.id=l.userId JOIN music_preferences mp ON mp.userId=u.id WHERE l.created>=? AND mp.participate=1 AND ${visibility} GROUP BY t.authorUrl ORDER BY plays DESC,t.authorUrl LIMIT 30`,
          )
          .bind(since, me)
          .all(),
        d
          .prepare(
            `SELECT u.id,u.name,u.avatar,h.handle,COUNT(*) as plays,COUNT(DISTINCT l.trackId) as tracks FROM music_listens l JOIN users u ON u.id=l.userId JOIN handles h ON h.userId=u.id AND h.main=1 JOIN music_preferences mp ON mp.userId=u.id WHERE l.created>=? AND mp.participate=1 AND ${visibility} GROUP BY u.id ORDER BY plays DESC,u.id LIMIT 30`,
          )
          .bind(since, me)
          .all(),
      ]);
    return Response.json(
      {
        participate: !!pref?.participate,
        library: library.results,
        discoveries: discoveries.results,
        tracks: tracks.results,
        artists: artists.results,
        listeners: listeners.results,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await viewer();
    await assertReadable(me);
    const body = await readJsonBody(req, 4096),
      d = db(),
      now = Date.now();
    if (body.action === 'preferences') {
      if (typeof body.participate !== 'boolean')
        throw new ApiError(400, 'Некорректная настройка');
      // Read-only users can still revoke consent.
      if (body.participate) await assertWritable(me);
      const statements = [
        d
          .prepare(
            'INSERT INTO music_preferences(userId,participate) VALUES(?,?) ON CONFLICT(userId) DO UPDATE SET participate=excluded.participate',
          )
          .bind(me, body.participate ? 1 : 0),
      ];
      if (!body.participate)
        statements.push(
          d.prepare('DELETE FROM music_sessions WHERE userId=?').bind(me),
          d.prepare('DELETE FROM music_listens WHERE userId=?').bind(me),
        );
      await d.batch(statements);
      return Response.json({ ok: true });
    }
    await assertWritable(me);
    if (body.action === 'save' || body.action === 'start') {
      const link = parseMusicLink(body.url);
      if (!link)
        throw new ApiError(
          400,
          'Нужна публичная ссылка SoundCloud на трек или плейлист',
        );
      if (body.action === 'start') {
        if (link.kind !== 'track')
          throw new ApiError(400, 'Засчитываются отдельные треки');
        const pref = await d
          .prepare('SELECT participate FROM music_preferences WHERE userId=?')
          .bind(me)
          .first<{ participate: number }>();
        if (!pref?.participate) return Response.json({ session: null });
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
        .prepare(`INSERT INTO music_sessions(userId,id,trackId,created,updated,totalMs) SELECT ?,?,?,?,?,0 WHERE ${eligible}
        ON CONFLICT(userId) DO UPDATE SET id=excluded.id,trackId=excluded.trackId,created=excluded.created,updated=excluded.updated,totalMs=0`)
        .bind(me, id, track.id, started, started, me)
        .run();
      return Response.json({ session: result.meta.changes ? id : null });
    }
    if (body.action === 'remove') {
      if (typeof body.id !== 'string')
        throw new ApiError(400, 'Некорректная запись');
      await d
        .prepare('DELETE FROM music_library WHERE userId=? AND trackId=?')
        .bind(me, body.id)
        .run();
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
      await d
        .prepare(
          `INSERT OR IGNORE INTO music_listens(userId,trackId,day,created) SELECT userId,trackId,?,? FROM music_sessions WHERE userId=? AND id=? AND totalMs>=30000 AND created<=? AND ${eligible}`,
        )
        .bind(Math.floor(now / DAY), now, me, body.session, now - 30000, me)
        .run();
      const counted = !!(await d
        .prepare(
          'SELECT 1 FROM music_listens l JOIN music_sessions s ON s.userId=l.userId AND s.trackId=l.trackId WHERE s.userId=? AND s.id=? AND l.day=?',
        )
        .bind(me, body.session, Math.floor(now / DAY))
        .first());
      return Response.json({ counted });
    }
    throw new ApiError(400, 'Неизвестное действие');
  } catch (e) {
    return failure(e);
  }
}
