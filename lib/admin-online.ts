import { db } from './storage';
import { requireAdministrator } from './administrator-access';
import {
  ONLINE_MINUTE_MS,
  ONLINE_RETENTION_MS,
  ONLINE_WINDOW_MS,
  onlinePoints,
  onlineRange,
  type OnlinePoint,
  type OnlineStats,
} from './online-stats';

// Uses the existing authenticated presence signal. No IPs or individual history.
const onlineWhere = `u.lastSeen>? AND u.lastSeen<=? AND u.kind='person'
  AND u.deletedAt=0 AND u.onboardingComplete=1
  AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId IN (u.id,u.ownerId)
    AND ar.mode='blocked' AND (ar.expiresAt IS NULL OR ar.expiresAt>?))`;

export async function recordOnlineSnapshot(now = Date.now()) {
  const d = db();
  const minute = Math.floor(now / ONLINE_MINUTE_MS) * ONLINE_MINUTE_MS;
  await d.batch([
    d
      .prepare(`INSERT INTO online_samples(minute,online,recordedAt)
      SELECT ?,COUNT(*),? FROM users u WHERE ${onlineWhere}
      ON CONFLICT(minute) DO NOTHING`)
      .bind(minute, now, now - ONLINE_WINDOW_MS, now, now),
    d
      .prepare('DELETE FROM online_samples WHERE minute<?')
      .bind(minute - ONLINE_RETENTION_MS),
  ]);
}

export async function readAdminOnline(
  me: string,
  requestedRange: string | null,
  now = Date.now(),
): Promise<OnlineStats> {
  await requireAdministrator(me);
  const range = onlineRange(requestedRange, now);
  const results = await db().batch<Record<string, number | null>>([
    db()
      .prepare(`SELECT COUNT(*) AS online FROM users u WHERE ${onlineWhere}`)
      .bind(now - ONLINE_WINDOW_MS, now, now),
    db().prepare(
      "SELECT COUNT(*) AS registered FROM users WHERE kind='person' AND deletedAt=0 AND onboardingComplete=1",
    ),
    db()
      .prepare(`SELECT CAST(minute / ? AS INTEGER) * ? AS time, AVG(online) AS average,
      MAX(online) AS peak, MIN(online) AS minimum, COUNT(*) AS samples
      FROM online_samples WHERE minute>=? AND minute<=? GROUP BY time ORDER BY time`)
      .bind(range.step, range.step, range.start, now),
    db()
      .prepare(`SELECT
      (SELECT recordedAt FROM online_samples WHERE minute<=? ORDER BY minute LIMIT 1) AS firstSampleAt,
      (SELECT recordedAt FROM online_samples WHERE minute<=? ORDER BY minute DESC LIMIT 1) AS latestSampleAt,
      MAX(online) AS peak, AVG(online) AS average, COUNT(*) AS samples
      FROM online_samples WHERE minute>=? AND minute<=?`)
      .bind(now, now, now - 86400000, now),
  ]);
  const history = results[3].results[0];
  return {
    serverTime: now,
    online: Number(results[0].results[0].online),
    registered: Number(results[1].results[0].registered),
    range: range.range,
    step: range.step,
    points: onlinePoints(range, results[2].results as OnlinePoint[]),
    firstSampleAt: history.firstSampleAt as number | null,
    latestSampleAt: history.latestSampleAt as number | null,
    day: {
      peak: history.peak as number | null,
      average: history.average as number | null,
      samples: Number(history.samples),
    },
  };
}
