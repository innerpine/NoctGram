import { db } from './storage';
import { ApiError } from './api-error';
import { isReactionEmoji } from './message-reactions';

type ReactionTable = 'message_reactions' | 'chat_room_message_reactions';

// All SQL expressions come from the server, never from request values.
export function reactionSummarySql(
  table: ReactionTable,
  message: string,
  actor: string,
) {
  return `(SELECT json_group_array(json_object('emoji',emoji,'count',total,'own',own)) FROM (
    SELECT emoji,COUNT(*) AS total,MAX(userId=${actor}) AS own
    FROM ${table} WHERE messageId=${message} GROUP BY emoji))`;
}

export async function saveMessageReaction(
  table: ReactionTable,
  messageId: string,
  actor: string,
  emoji: unknown,
  gate: string,
  bindings: (string | number | null)[],
) {
  if (emoji !== null && !isReactionEmoji(emoji))
    throw new ApiError(400, 'Выбери реакцию из списка');
  // Explicit set/remove is safe to retry. Authorization is checked inside the
  // write and again in the same transaction, including idempotent removal.
  const statement =
    emoji === null
      ? db()
          .prepare(
            `DELETE FROM ${table} WHERE messageId=? AND userId=? AND ${gate}`,
          )
          .bind(messageId, actor, ...bindings)
      : db()
          .prepare(`INSERT INTO ${table}(messageId,userId,emoji,created)
        SELECT ?,?,?,? WHERE ${gate}
        ON CONFLICT(messageId,userId) DO UPDATE SET emoji=excluded.emoji,
          created=CASE WHEN ${table}.emoji=excluded.emoji THEN ${table}.created ELSE excluded.created END`)
          .bind(messageId, actor, emoji, Date.now(), ...bindings);
  const result = await db().batch([
    statement,
    db()
      .prepare(`SELECT 1 AS allowed WHERE ${gate}`)
      .bind(...bindings),
  ]);
  if (!result[1].results.length)
    throw new ApiError(403, 'Реакции недоступны для этого сообщения');
  return { ok: true as const };
}
