import { db } from './storage';
import { ApiError } from './api-error';

export async function deleteAccount(
  me: string,
  sessionHash: string,
  deleteChannels: boolean,
) {
  const d = db(),
    requestId = crypto.randomUUID(),
    now = Date.now();
  const admin = await d
    .prepare('SELECT userId FROM administrators WHERE userId=?')
    .bind(me)
    .first();
  if (admin)
    throw new ApiError(
      409,
      'Удаление аккаунта администратора доступно после передачи его полномочий владельцем проекта.',
    );
  const channels = await d
    .prepare('SELECT id FROM users WHERE ownerId=? AND deletedAt=0')
    .bind(me)
    .all();
  if (channels.results.length && !deleteChannels)
    throw new ApiError(
      409,
      'Подтвердите удаление своих каналов вместе с аккаунтом.',
    );
  const gate =
    'EXISTS(SELECT 1 FROM account_deletions WHERE userId=? AND requestId=?)';
  const args = [me, requestId];
  const own = 'SELECT id FROM users WHERE id=? OR ownerId=?';
  const statements: D1PreparedStatement[] = [
    d
      .prepare(
        `INSERT INTO account_deletions(userId,requestId,created) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=? AND s.userId=? AND s.expiresAt>? AND s.verifiedAt>? AND u.deletedAt=0) AND NOT EXISTS(SELECT 1 FROM administrators WHERE userId=?) AND (?=1 OR NOT EXISTS(SELECT 1 FROM users WHERE ownerId=? AND deletedAt=0))`,
      )
      .bind(
        me,
        requestId,
        now,
        sessionHash,
        me,
        now,
        now - 300000,
        me,
        deleteChannels ? 1 : 0,
        me,
      ),
    d
      .prepare(
        `INSERT OR IGNORE INTO storage_deletions(objectKey,created) SELECT objectKey,? FROM music_audio WHERE userId=? AND ${gate}`,
      )
      .bind(now, me, ...args),
    d
      .prepare(
        `UPDATE posts SET cancelledAt=?,notifyPending=0 WHERE publisherId=? AND userId NOT IN(${own}) AND publishAt>? AND ${gate}`,
      )
      .bind(now, me, me, me, now, ...args),
    d
      .prepare(`DELETE FROM posts WHERE userId IN(${own}) AND ${gate}`)
      .bind(me, me, ...args),
    d
      .prepare(`DELETE FROM stories WHERE userId IN(${own}) AND ${gate}`)
      .bind(me, me, ...args),
    d
      .prepare(`DELETE FROM comments WHERE userId=? AND ${gate}`)
      .bind(me, ...args),
    d
      .prepare(
        `DELETE FROM messages WHERE (sender=? OR recipient=?) AND ${gate}`,
      )
      .bind(me, me, ...args),
    d
      .prepare(
        `DELETE FROM follows WHERE (follower IN(${own}) OR following IN(${own})) AND ${gate}`,
      )
      .bind(me, me, me, me, ...args),
    d
      .prepare(
        `DELETE FROM user_blocks WHERE (blocker=? OR blocked=?) AND ${gate}`,
      )
      .bind(me, me, ...args),
    d
      .prepare(
        `DELETE FROM channel_members WHERE (userId=? OR channelId IN(${own})) AND ${gate}`,
      )
      .bind(me, me, me, ...args),
    d
      .prepare(
        `DELETE FROM notifications WHERE (userId=? OR actorId IN(${own})) AND ${gate}`,
      )
      .bind(me, me, me, ...args),
    d
      .prepare(
        `DELETE FROM auth_challenges WHERE (linkUserId=? OR email IN(SELECT email FROM auth_identities WHERE userId=?)) AND ${gate}`,
      )
      .bind(me, me, ...args),
    d
      .prepare(
        `DELETE FROM call_signals WHERE callId IN(SELECT id FROM calls WHERE caller=? OR callee=?) AND ${gate}`,
      )
      .bind(me, me, ...args),
    d
      .prepare(`DELETE FROM calls WHERE (caller=? OR callee=?) AND ${gate}`)
      .bind(me, me, ...args),
  ];
  // Evidence and the Stars ledger retain anonymous user IDs; no balance is recalculated by deletion.
  for (const table of [
    'likes',
    'bookmarks',
    'votes',
    'hidden_posts',
    'reports',
    'post_views',
    'story_views',
    'user_privacy',
    'music_audio',
    'music_library',
    'music_preferences',
    'music_sessions',
    'music_listens',
    'music_connections',
    'music_oauth_states',
    'music_imports',
    'telegram_challenges',
    'telegram_links',
    'push_subscriptions',
    'auth_sessions',
    'auth_identities',
    'account_challenges',
    'recovery_codes',
    'moderators',
    'channel_boost_slots',
  ])
    statements.push(
      d
        .prepare(`DELETE FROM ${table} WHERE userId=? AND ${gate}`)
        .bind(me, ...args),
    );
  for (const table of ['profile_appearance', 'premium_entitlements', 'handles'])
    statements.push(
      d
        .prepare(`DELETE FROM ${table} WHERE userId IN(${own}) AND ${gate}`)
        .bind(me, me, ...args),
    );
  statements.push(
    d
      .prepare(
        `UPDATE channel_boost_slots SET channelId=NULL WHERE channelId IN(${own}) AND ${gate}`,
      )
      .bind(me, me, ...args),
  );
  statements.push(
    d
      .prepare(
        `UPDATE users SET name='Удалённый аккаунт',bio='',avatar='',cover='',verified=0,lastSeen=0,onboardingComplete=0,deletedAt=?,sessionsRevokedAt=? WHERE (id=? OR ownerId=?) AND ${gate}`,
      )
      .bind(now, now, me, me, ...args),
  );
  const results = await d.batch(statements);
  if (!results[0].meta.changes)
    throw new ApiError(409, 'Сессия изменилась. Подтвердите доступ ещё раз.');
}
