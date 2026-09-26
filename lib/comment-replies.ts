import { visibleAccount } from './account-access';
import { personalVisibility } from './privacy';
import { ApiError, db } from './server';

// Answers to comments (drizzle/0050_comment_replies.sql). A comment may answer
// another comment of the same post. Lists show whom it answers and the start
// of that comment. A deleted comment, or one whose author the viewer cannot
// see, leaves only replyTo, so the answer says the comment is unavailable.
// Aliases are internal SQL identifiers; values always use bindings.

function alias(name: string) {
  if (!/^[a-z]+$/.test(name)) throw new Error('Invalid SQL alias');
  return name;
}

/** Columns of the answered comment, from the joins below. */
export function replyColumns(reply: string, author: string) {
  const r = alias(reply),
    a = alias(author);
  return `${a}.id AS replyUserId,${a}.name AS replyName,CASE WHEN ${a}.id IS NULL THEN NULL ELSE substr(${r}.text,1,160) END AS replyText`;
}

/** Joins the answered comment and its author; consumes one viewer binding. */
export function replyJoins(comment: string, reply: string, author: string) {
  const c = alias(comment),
    r = alias(reply),
    a = alias(author);
  return `LEFT JOIN comments ${r} ON ${r}.id=${c}.replyTo LEFT JOIN users ${a} ON ${a}.id=${r}.userId AND ${visibleAccount(a)} AND ${personalVisibility(a)}`;
}

/** The comment a new one answers: of the same post and visible, or none. */
export async function replyTarget(me: string, postId: string, value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 100)
    throw new ApiError(400, 'Выберите комментарий для ответа');
  const row = await db()
    .prepare(
      `SELECT c.id FROM comments c JOIN users u ON u.id=c.userId WHERE c.id=? AND c.postId=? AND ${visibleAccount('u')} AND ${personalVisibility('u')}`,
    )
    .bind(value, postId, me)
    .first<{ id: string }>();
  if (!row)
    throw new ApiError(404, 'Комментарий, на который вы отвечаете, удалён');
  return row.id;
}
