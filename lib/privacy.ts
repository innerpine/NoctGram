import { appearanceColumns } from '@/lib/premium-access';
import { db, clean, ApiError } from './server';
import { assertReadable, visibleAccount } from './account-access';
import { CHAT_ATTACHMENT_LIMIT, type ChatAttachment } from './chat-files';
import { messageVisible, messagePair } from './chat-access';

// Each predicate consumes one viewer binding; aliases are internal identifiers.
export function personalVisibility(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw new Error('Invalid SQL alias');
  return `NOT EXISTS(SELECT 1 FROM user_blocks pb WHERE pb.blocker=? AND pb.blocked IN (${alias}.id,${alias}.ownerId))`;
}
export function contentPreference(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw new Error('Invalid SQL alias');
  return `NOT EXISTS(SELECT 1 FROM user_privacy pref WHERE pref.userId=? AND pref.hideAdult=1 AND ${alias}.adult=1)`;
}
// Used inside the write statement as well as the UI read: blocking/settings and
// message insertion serialize in SQLite, without a check-then-send race.
export const messageAllowed = `NOT EXISTS(SELECT 1 FROM user_blocks WHERE
  (blocker=s.id AND blocked=r.id) OR (blocker=r.id AND blocked=s.id))
  AND (COALESCE((SELECT messagePolicy FROM user_privacy WHERE userId=r.id),'everyone')='everyone'
  OR ((SELECT messagePolicy FROM user_privacy WHERE userId=r.id)='following'
    AND EXISTS(SELECT 1 FROM follows WHERE follower=r.id AND following=s.id)))`;

export async function assertCanInteract(me: string, target: string) {
  const denied = await db()
    .prepare(`SELECT 1 FROM users u JOIN user_blocks b
    ON (b.blocker=? AND b.blocked IN(u.id,u.ownerId))
      OR (b.blocker IN(u.id,u.ownerId) AND b.blocked=?) WHERE u.id=?`)
    .bind(me, me, target)
    .first();
  if (denied)
    throw new ApiError(403, 'Действие недоступно из-за настроек приватности');
}
export async function sendPrivateMessage(
  me: string,
  recipient: string,
  text: string,
  attachments: unknown = [],
  key: unknown = crypto.randomUUID(),
  replyTo: unknown = null,
) {
  if (
    replyTo !== null &&
    (typeof replyTo !== 'string' || !replyTo || replyTo.length > 250)
  )
    throw new ApiError(400, 'Некорректное сообщение для ответа');
  if (
    !Array.isArray(attachments) ||
    attachments.length > CHAT_ATTACHMENT_LIMIT ||
    attachments.some(
      (id) => typeof id !== 'string' || !id || id.length > 100,
    ) ||
    new Set(attachments).size !== attachments.length
  )
    throw new ApiError(400, 'Можно прикрепить до 10 разных файлов');
  if (!text.trim() && !attachments.length)
    throw new ApiError(400, 'Напиши сообщение или прикрепи файл');
  if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(key))
    throw new ApiError(400, 'Некорректный запрос отправки');
  const id = `message:${me}:${key}`,
    ids = JSON.stringify(attachments);
  const existing = await db()
    .prepare(
      'SELECT recipient,text,media,replyTo FROM messages WHERE id=? AND sender=?',
    )
    .bind(id, me)
    .first<{
      recipient: string;
      text: string;
      media: string;
      replyTo: string | null;
    }>();
  const same = (row: NonNullable<typeof existing>) =>
    row.recipient === recipient &&
    row.text === text &&
    row.replyTo === replyTo &&
    JSON.stringify(
      (JSON.parse(row.media) as ChatAttachment[]).map((file) => file.id),
    ) === ids;
  if (existing) {
    if (!same(existing))
      throw new ApiError(
        409,
        'Этот запрос уже использован для другого сообщения',
      );
    return { id };
  }
  const results = await db().batch([
    db()
      .prepare(`INSERT INTO messages(id,sender,recipient,text,media,created,replyTo)
    SELECT ?,s.id,r.id,?,(SELECT json_group_array(json_object('id',up.id,'name',up.name,'type',up.type,'size',cu.size,'kind',cu.kind))
      FROM json_each(?) j JOIN uploads up ON up.id=j.value JOIN chat_uploads cu ON cu.uploadId=up.id),?,? FROM users s,users r
    WHERE s.id=? AND r.id=? AND s.id<>r.id AND r.kind='person'
    AND ${visibleAccount('s')} AND ${visibleAccount('r')}
    AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=s.id AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))
    AND ${messageAllowed}
    AND (? IS NULL OR EXISTS(SELECT 1 FROM messages rp WHERE rp.id=? AND ${messagePair('rp', 's.id', 'r.id')} AND ${messageVisible('rp', 's.id')}))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(
      SELECT 1 FROM uploads up JOIN chat_uploads cu ON cu.uploadId=up.id WHERE up.id=j.value AND up.userId=s.id
        AND up.state='ready' AND cu.recipient=r.id AND cu.messageId IS NULL AND NOT EXISTS(SELECT 1 FROM moderated_uploads mu WHERE mu.uploadId=up.id)))
    ON CONFLICT(id) DO NOTHING`)
      .bind(
        id,
        text,
        ids,
        Date.now(),
        replyTo,
        me,
        recipient,
        replyTo,
        replyTo,
        ids,
      ),
    db()
      .prepare(`UPDATE chat_uploads SET messageId=? WHERE messageId IS NULL AND EXISTS(
      SELECT 1 FROM messages m,json_each(m.media) j WHERE m.id=? AND m.sender=? AND json_extract(j.value,'$.id')=chat_uploads.uploadId)`)
      .bind(id, id, me),
    db()
      .prepare(
        "INSERT OR IGNORE INTO notifications(id,userId,actorId,kind,targetId,created) SELECT ?,recipient,sender,'message',id,created FROM messages WHERE id=?",
      )
      .bind('message:' + id, id),
  ]);
  if (!results[0].meta.changes) {
    const saved = await db()
      .prepare(
        'SELECT recipient,text,media,replyTo FROM messages WHERE id=? AND sender=?',
      )
      .bind(id, me)
      .first<NonNullable<typeof existing>>();
    if (saved && same(saved)) return { id };
    throw new ApiError(
      saved ? 409 : 403,
      saved
        ? 'Этот запрос уже использован'
        : 'Не удалось отправить: проверь доступ к диалогу и вложения',
    );
  }
  return { id };
}
export async function privacyGet(
  action: string,
  s: URLSearchParams,
  me: string,
): Promise<Response | null> {
  if (action === 'privacy') {
    const settings = await db()
      .prepare(
        'SELECT hideAdult,messagePolicy FROM user_privacy WHERE userId=?',
      )
      .bind(me)
      .first();
    const blocked = await db()
      .prepare(`SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle,b.created FROM user_blocks b
      JOIN users u ON u.id=b.blocked LEFT JOIN handles h ON h.userId=u.id AND h.main=1
      WHERE b.blocker=? ORDER BY b.created DESC,b.blocked`)
      .bind(me)
      .all();
    return Response.json({
      hideAdult: !!settings?.hideAdult,
      messagePolicy: settings?.messagePolicy || 'everyone',
      blocked: blocked.results,
    });
  }
  if (action === 'privacyPeople') {
    const q = clean(s.get('q') || '', 100).replace(/^@/, '');
    if (!q) return Response.json([]);
    const rows = await db()
      .prepare(`SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle,
      EXISTS(SELECT 1 FROM user_blocks WHERE blocker=? AND blocked=u.id) AS blockedByMe
      FROM users u JOIN handles h ON h.userId=u.id AND h.main=1
      WHERE u.kind='person' AND u.id<>? AND ${visibleAccount('u')}
      AND (u.name LIKE ? OR EXISTS(SELECT 1 FROM handles WHERE userId=u.id AND handle LIKE ?))
      ORDER BY h.handle LIMIT 30`)
      .bind(me, me, '%' + q + '%', '%' + q + '%')
      .all();
    return Response.json(rows.results);
  }
  if (action === 'messageAccess') {
    const row = await db()
      .prepare(`SELECT (${messageAllowed}) AS allowed,
      EXISTS(SELECT 1 FROM user_blocks WHERE blocker=s.id AND blocked=r.id) AS blockedByMe
      FROM users s,users r WHERE s.id=? AND r.id=? AND r.kind='person' AND r.id<>s.id AND ${visibleAccount('r')}`)
      .bind(me, s.get('peer') || '')
      .first();
    return Response.json({
      allowed: !!row?.allowed,
      blockedByMe: !!row?.blockedByMe,
    });
  }
  return null;
}
export async function privacyPost(
  action: string,
  b: Record<string, unknown>,
  me: string,
): Promise<Response | null> {
  if (!['privacy', 'blockUser', 'reportMessage'].includes(action)) return null;
  // Read-only users still need tools to protect themselves and report abuse.
  await assertReadable(me);
  if (action === 'privacy') {
    if (
      typeof b.hideAdult !== 'boolean' ||
      typeof b.messagePolicy !== 'string' ||
      !['everyone', 'following', 'nobody'].includes(b.messagePolicy)
    )
      throw new ApiError(400, 'Проверь настройки приватности');
    await db()
      .prepare(`INSERT INTO user_privacy(userId,hideAdult,messagePolicy) VALUES(?,?,?)
      ON CONFLICT(userId) DO UPDATE SET hideAdult=excluded.hideAdult,messagePolicy=excluded.messagePolicy`)
      .bind(me, b.hideAdult ? 1 : 0, b.messagePolicy)
      .run();
    return Response.json({ ok: true });
  }
  const id = clean(b.id, 200, true);
  if (action === 'reportMessage') {
    const reason = clean(b.reason, 500, true),
      now = Date.now();
    // Only a recipient can disclose the particular received message to moderation.
    // The rest of the conversation and the recipient's settings remain private.
    const row = await db()
      .prepare(
        `SELECT id,sender,text,created FROM messages WHERE id=? AND recipient=? AND sender<>? AND ${messageVisible('messages', 'messages.recipient')}`,
      )
      .bind(id, me, me)
      .first();
    if (!row) throw new ApiError(404, 'Полученное сообщение не найдено');
    await db()
      .prepare(`INSERT OR IGNORE INTO content_reports
      (id,targetType,targetId,postId,userId,authorId,text,snapshot,reason,created,updated)
      SELECT ?,'message',?,'',?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM messages WHERE id=? AND recipient=? AND ${messageVisible('messages', 'messages.recipient')})`)
      .bind(
        crypto.randomUUID(),
        id,
        me,
        row.sender,
        row.text,
        JSON.stringify(row),
        reason,
        now,
        now,
        id,
        me,
      )
      .run();
    return Response.json({ ok: true });
  }
  if (typeof b.value !== 'boolean') throw new ApiError(400, 'Укажи действие');
  if (
    id === me ||
    !(await db()
      .prepare(
        "SELECT id FROM users WHERE id=? AND kind='person' AND onboardingComplete=1",
      )
      .bind(id)
      .first())
  )
    throw new ApiError(400, 'Выбери другого пользователя');
  if (b.value) {
    await db().batch([
      db()
        .prepare(
          'INSERT OR IGNORE INTO user_blocks(blocker,blocked,created) VALUES(?,?,?)',
        )
        .bind(me, id, Date.now()),
      db()
        .prepare(`DELETE FROM follows WHERE (follower=? AND following IN(SELECT id FROM users WHERE id=? OR ownerId=?))
        OR (follower=? AND following IN(SELECT id FROM users WHERE id=? OR ownerId=?))`)
        .bind(me, id, id, id, me, me),
    ]);
  } else
    await db()
      .prepare('DELETE FROM user_blocks WHERE blocker=? AND blocked=?')
      .bind(me, id)
      .run();
  return Response.json({ ok: true });
}
