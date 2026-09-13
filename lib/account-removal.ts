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
  // Shared groups survive their founder: deletion requires an explicit transfer
  // before the account can disappear. The same condition is repeated at commit.
  const sharedGroups = `EXISTS(SELECT 1 FROM chat_rooms gr WHERE gr.ownerId=? AND gr.kind='group' AND gr.deletedAt=0
    AND EXISTS(SELECT 1 FROM chat_room_members gm JOIN users gu ON gu.id=gm.userId WHERE gm.roomId=gr.id AND gm.status='active' AND gm.userId<>gr.ownerId AND gu.deletedAt=0))`;
  if (await d.prepare(`SELECT 1 WHERE ${sharedGroups}`).bind(me).first())
    throw new ApiError(
      409,
      'Перед удалением аккаунта передайте владение группами с другими участниками. Это можно сделать в настройках каждой группы.',
      'GROUP_OWNERSHIP_REQUIRED',
    );
  const gate =
    'EXISTS(SELECT 1 FROM account_deletions WHERE userId=? AND requestId=?)';
  const args = [me, requestId];
  const own = 'SELECT id FROM users WHERE id=? OR ownerId=?';
  const statements: D1PreparedStatement[] = [
    d
      .prepare(
        `INSERT INTO account_deletions(userId,requestId,created) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=? AND s.userId=? AND s.expiresAt>? AND s.verifiedAt>? AND u.deletedAt=0) AND NOT EXISTS(SELECT 1 FROM administrators WHERE userId=?) AND (?=1 OR NOT EXISTS(SELECT 1 FROM users WHERE ownerId=? AND deletedAt=0)) AND NOT (${sharedGroups})`,
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
        me,
      ),
    d
      .prepare(
        `DELETE FROM direct_chat_archives WHERE (userId=? OR peerId=?) AND ${gate}`,
      )
      .bind(me, me, ...args),
    // Secret room deletion cascades all ciphertext, both public keys and room
    // membership. Owned groups have no other live members after the gate above.
    d
      .prepare(
        `DELETE FROM chat_rooms WHERE (ownerId=? OR (kind='secret' AND EXISTS(SELECT 1 FROM chat_room_members sm WHERE sm.roomId=chat_rooms.id AND sm.userId=?))) AND ${gate}`,
      )
      .bind(me, me, ...args),
    d
      .prepare(`DELETE FROM chat_room_messages WHERE sender=? AND ${gate}`)
      .bind(me, ...args),
    d
      .prepare(`DELETE FROM chat_room_invites WHERE createdBy=? AND ${gate}`)
      .bind(me, ...args),
    d
      .prepare(`DELETE FROM chat_room_members WHERE userId=? AND ${gate}`)
      .bind(me, ...args),
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
        `UPDATE chat_uploads SET messageId=(
          SELECT m.id FROM messages m,json_each(m.media) j
          WHERE m.sender<>? AND m.recipient<>? AND m.deletedAt=0
            AND json_extract(j.value,'$.id')=chat_uploads.uploadId
          ORDER BY m.created,m.id LIMIT 1
        ) WHERE messageId IN(SELECT id FROM messages WHERE sender=? OR recipient=?) AND ${gate}`,
      )
      .bind(me, me, me, me, ...args),
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
    'message_reactions',
    'chat_room_message_reactions',
    'likes',
    'bookmarks',
    'votes',
    'hidden_posts',
    'reports',
    'post_views',
    'story_views',
    'user_privacy',
    'user_presence_privacy',
    'music_audio',
    'music_activity',
    'music_playlist_members',
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
        `DELETE FROM user_presence_exceptions WHERE (userId=? OR viewerId=?) AND ${gate}`,
      )
      .bind(me, me, ...args),
    d
      .prepare(`DELETE FROM music_playlists WHERE ownerId=? AND ${gate}`)
      .bind(me, ...args),
    d
      .prepare(
        `DELETE FROM chat_themes WHERE (firstId=? OR secondId=?) AND ${gate}`,
      )
      .bind(me, me, ...args),
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
