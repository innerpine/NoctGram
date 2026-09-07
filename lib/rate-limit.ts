import { db } from './storage';
import { ApiError } from './api-error';
import { tokenHash } from './auth-session';

export class ActionRateError extends ApiError {
  constructor(public retryAfter: number) {
    super(
      429,
      `Слишком часто. Повторите через ${retryAfter} сек.`,
      'RATE_LIMIT',
    );
  }
}
// A conditional upsert is atomic across Worker instances and concurrent requests.
export async function rateLimit(
  scope: string,
  identity: string,
  max: number,
  seconds: number,
) {
  const key = `action:${scope}:${await tokenHash(identity)}`,
    now = Date.now();
  const accepted = await db()
    .prepare(`INSERT INTO auth_limits(key,count,expiresAt) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expiresAt<=? THEN 1 ELSE count+1 END,
    expiresAt=CASE WHEN expiresAt<=? THEN excluded.expiresAt ELSE expiresAt END
    WHERE expiresAt<=? OR count<? RETURNING key`)
    .bind(key, now + seconds * 1000, now, now, now, max)
    .first();
  if (!accepted) {
    const row = await db()
      .prepare('SELECT expiresAt FROM auth_limits WHERE key=?')
      .bind(key)
      .first<{ expiresAt: number }>();
    throw new ActionRateError(
      Math.max(1, Math.ceil(((row?.expiresAt || now + 1000) - now) / 1000)),
    );
  }
}
const rules: Record<string, [string, number, number]> = {
  message: ['message', 30, 60],
  post: ['post', 5, 60],
  comment: ['comment', 15, 60],
  story: ['story', 5, 60],
  createChannel: ['channel', 3, 3600],
  callStart: ['call', 5, 60],
  report: ['report', 8, 600],
  reportComment: ['report', 8, 600],
  reportStory: ['report', 8, 600],
  reportMessage: ['report', 8, 600],
  follow: ['social', 40, 60],
  like: ['social', 60, 60],
  vote: ['social', 60, 60],
  support: ['support', 20, 60],
};
export async function socialRateLimit(me: string, action: string) {
  // Heartbeats, read acknowledgments and ICE signaling do not create user content.
  if (
    ['callEnd', 'telegramUnlink', 'telegramCancel', 'pushUnsubscribe'].includes(
      action,
    )
  )
    return;
  if (
    [
      'view',
      'viewStory',
      'callHeartbeat',
      'callSignal',
      'readNotifications',
    ].includes(action)
  ) {
    await rateLimit('activity', me, 600, 60);
    return;
  }
  await rateLimit('mutations', me, 180, 60);
  const r = rules[action];
  if (r) await rateLimit(r[0], me, r[1], r[2]);
}
