import { db, ApiError } from './server';
import { visibleAccount } from './account-access';
import { personalVisibility } from './privacy';

export function commentReplyTarget(value: unknown) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value || value.length > 250)
    throw new ApiError(400, 'Некорректный комментарий для ответа');
  return value;
}

// Both read and write exclude blocked authors in either direction. A reply
// cannot retain a copy of text that was later deleted or hidden by moderation.
export function availableCommentParent() {
  return `${visibleAccount('u')} AND ${personalVisibility('u')}
    AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE b.blocker IN(u.id,u.ownerId) AND b.blocked=?)`;
}

export async function insertComment(
  id: string,
  postId: string,
  me: string,
  text: string,
  replyTo: string | null,
) {
  const result = await db()
    .prepare(`INSERT INTO comments(id,postId,userId,text,created,replyTo)
    SELECT ?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(
      SELECT 1 FROM comments c JOIN users u ON u.id=c.userId
      WHERE c.id=? AND c.postId=? AND ${availableCommentParent()})`)
    .bind(
      id,
      postId,
      me,
      text,
      Date.now(),
      replyTo,
      replyTo,
      replyTo,
      postId,
      me,
      me,
    )
    .run();
  if (!result.meta.changes)
    throw new ApiError(
      409,
      'Комментарий для ответа больше недоступен. Отмените ответ или выберите другой.',
    );
}

export async function withCommentReplies<
  T extends { postId: string; replyTo?: string | null },
>(rows: T[], me: string) {
  const ids = [
    ...new Set(rows.flatMap((row) => (row.replyTo ? [row.replyTo] : []))),
  ];
  if (!ids.length) return rows.map((row) => ({ ...row, reply: null }));
  const { results } = await db()
    .prepare(`SELECT c.id,c.postId,c.userId,u.name,substr(c.text,1,240) AS text
    FROM comments c JOIN users u ON u.id=c.userId
    WHERE c.id IN(SELECT value FROM json_each(?)) AND ${availableCommentParent()}`)
    .bind(JSON.stringify(ids), me, me)
    .all<{
      id: string;
      postId: string;
      userId: string;
      name: string;
      text: string;
    }>();
  const parents = new Map(results.map((row) => [row.id, row]));
  return rows.map((row) => {
    const parent = row.replyTo ? parents.get(row.replyTo) : null;
    const available = parent?.postId === row.postId;
    return {
      ...row,
      reply: row.replyTo
        ? {
            id: row.replyTo,
            userId: available ? parent!.userId : '',
            name: available ? parent!.name : '',
            text: available ? parent!.text : '',
            unavailable: !available,
          }
        : null,
    };
  });
}
