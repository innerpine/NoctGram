import { db } from './storage';
import { visibleAccount } from './account-access';

export const musicScoreEligible = `EXISTS(SELECT 1 FROM users u
  WHERE u.id=? AND ${visibleAccount('u')}
  AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=u.id AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000)))`;

/** Each qualified playback counts once; retries of its acknowledgement do not. */
export async function recordMusicListen(
  me: string,
  session: string,
  now: number,
) {
  const d = db();
  const ready = `userId=? AND id=? AND counted=0 AND totalMs>=30000 AND created<=? AND ${musicScoreEligible}`;
  // D1 batches are transactional: a competing/retried request sees counted=1
  // only after the matching daily score has been incremented successfully.
  await d.batch([
    d
      .prepare(`INSERT INTO music_listens(userId,trackId,day,created,plays)
      SELECT userId,trackId,?,?,1 FROM music_sessions WHERE ${ready}
      ON CONFLICT(userId,trackId,day) DO UPDATE SET plays=music_listens.plays+1`)
      .bind(Math.floor(now / 86400000), now, me, session, now - 30000, me),
    d
      .prepare(`UPDATE music_sessions SET counted=1 WHERE ${ready}`)
      .bind(me, session, now - 30000, me),
  ]);
  return !!(await d
    .prepare(
      'SELECT 1 FROM music_sessions WHERE userId=? AND id=? AND counted=1',
    )
    .bind(me, session)
    .first());
}
