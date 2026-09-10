import { assertPremiumEmoji } from './premium-emoji-access';
import { db } from './storage';
import { ApiError } from './api-error';
import { assertWritable, visibleAccount } from './account-access';
import { messageAllowed } from './privacy';
import { messageVisible, messagePair, messageWritable } from './chat-access';

function selection(body: Record<string, unknown>) {
  const { ids, peer } = body;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 20 ||
    ids.some((id) => typeof id !== 'string' || !id || id.length > 250) ||
    new Set(ids).size !== ids.length ||
    typeof peer !== 'string' ||
    !peer ||
    peer.length > 100
  )
    throw new ApiError(400, 'Выбери от 1 до 20 сообщений в диалоге');
  return { ids: ids as string[], peer, json: JSON.stringify(ids) };
}
export async function deleteMessages(
  me: string,
  body: Record<string, unknown>,
) {
  await assertWritable(me);
  const { ids, peer, json } = selection(body);
  if (typeof body.everyone !== 'boolean' || peer === me)
    throw new ApiError(400, 'Выбери способ удаления');
  const access = await db()
    .prepare(
      `SELECT COUNT(*) n FROM messages m,json_each(?) j WHERE m.id=j.value AND ${messagePair('m', '?', '?')}`,
    )
    .bind(json, me, peer, peer, me)
    .first<{ n: number }>();
  if (access?.n !== ids.length) throw new ApiError(403, 'Сообщения недоступны');
  // Retain gift receipts and moderation evidence; all chat reads exclude deleted rows.
  const where = `id IN (SELECT value FROM json_each(?)) AND ${messagePair('messages', '?', '?')} AND ${messageWritable('?')}`;
  await db().batch(
    body.everyone
      ? [
          db()
            .prepare(
              `UPDATE messages SET deletedAt=? WHERE ${where} AND deletedAt=0`,
            )
            .bind(Date.now(), json, me, peer, peer, me, me),
          db()
            .prepare(
              `DELETE FROM message_pins WHERE messageId IN (SELECT id FROM messages WHERE id IN (SELECT value FROM json_each(?)) AND deletedAt>0)`,
            )
            .bind(json),
          db()
            .prepare(
              `DELETE FROM notifications WHERE EXISTS(SELECT 1 FROM messages m WHERE m.id IN (SELECT value FROM json_each(?)) AND m.deletedAt>0 AND ((notifications.kind='message' AND notifications.targetId=m.id) OR (notifications.kind='gift' AND notifications.targetId=m.giftReceiptId)))`,
            )
            .bind(json),
        ]
      : [
          db()
            .prepare(
              `INSERT OR IGNORE INTO hidden_messages(messageId,userId) SELECT id,? FROM messages WHERE ${where}`,
            )
            .bind(me, json, me, peer, peer, me, me),
          db()
            .prepare(
              `DELETE FROM notifications WHERE userId=? AND EXISTS(SELECT 1 FROM messages m JOIN hidden_messages hm ON hm.messageId=m.id AND hm.userId=notifications.userId WHERE m.id IN (SELECT value FROM json_each(?)) AND ((notifications.kind='message' AND notifications.targetId=m.id) OR (notifications.kind='gift' AND notifications.targetId=m.giftReceiptId)))`,
            )
            .bind(me, json),
        ],
  );
  return { ok: true };
}
export async function editMessage(me: string, body: Record<string, unknown>) {
  await assertWritable(me);
  const { id, peer, text, revision } = body;
  if (
    typeof id !== 'string' ||
    id.length > 250 ||
    typeof peer !== 'string' ||
    peer.length > 100 ||
    typeof text !== 'string' ||
    text.length > 4000 ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    throw new ApiError(400, 'Некорректное редактирование');
  const caption = text.trim();
  await assertPremiumEmoji(me, caption);
  const access = `m.sender=s.id AND m.recipient=r.id AND m.giftReceiptId IS NULL AND m.forwardSourceId IS NULL AND ${messageVisible('m', 's.id')} AND ${visibleAccount('s')} AND ${visibleAccount('r')} AND ${messageWritable('s.id')} AND ${messageAllowed}`;
  const message = await db()
    .prepare(
      `SELECT m.text,m.media,m.editedAt FROM messages m,users s,users r WHERE m.id=? AND s.id=? AND r.id=? AND ${access}`,
    )
    .bind(id, me, peer)
    .first<{ text: string; media: string; editedAt: number }>();
  if (!message)
    throw new ApiError(
      403,
      'Можно изменять только свои сообщения в доступном диалоге',
    );
  if (!caption && !JSON.parse(message.media).length)
    throw new ApiError(400, 'Напиши текст сообщения');
  if (message.text === caption) return { ok: true };
  if (message.editedAt !== revision)
    throw new ApiError(
      409,
      'Сообщение уже изменилось. Открой редактирование заново',
    );
  const result = await db()
    .prepare(
      `UPDATE messages SET text=?,editedAt=MAX(editedAt+1,?) WHERE id=? AND editedAt=? AND EXISTS(SELECT 1 FROM messages m,users s,users r WHERE m.id=messages.id AND s.id=? AND r.id=? AND ${access})`,
    )
    .bind(caption, Date.now(), id, revision, me, peer)
    .run();
  if (!result.meta.changes)
    throw new ApiError(409, 'Сообщение изменилось или больше недоступно');
  return { ok: true };
}
export async function forwardMessages(
  me: string,
  body: Record<string, unknown>,
) {
  await assertWritable(me);
  const { ids, peer, json } = selection(body);
  const { recipient, key } = body;
  if (
    typeof recipient !== 'string' ||
    !recipient ||
    recipient.length > 100 ||
    recipient === me ||
    recipient === 'noctgram' ||
    typeof key !== 'string' ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(key)
  )
    throw new ApiError(400, 'Выбери получателя');
  const outputIds = ids.map((_, i) => `forward:${me}:${key}:${i}`),
    outputJson = JSON.stringify(outputIds);
  const saved = () =>
    db()
      .prepare(
        'SELECT id,recipient,forwardSourceId FROM messages WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',
      )
      .bind(outputJson)
      .all<{ id: string; recipient: string; forwardSourceId: string }>();
  const matches = (rows: Awaited<ReturnType<typeof saved>>['results']) =>
    rows.length === ids.length &&
    rows.every(
      (row) =>
        row.recipient === recipient &&
        row.forwardSourceId === ids[outputIds.indexOf(row.id)],
    );
  const existing = (await saved()).results;
  if (existing.length) {
    if (!matches(existing))
      throw new ApiError(
        409,
        'Этот запрос уже использован для другой пересылки',
      );
    return { ids: outputIds };
  }
  const sourceAccess = `${messagePair('src', 's.id', '?')} AND ${messageVisible('src', 's.id')}
    AND NOT EXISTS(SELECT 1 FROM json_each(src.media) a WHERE NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(a.value,'$.id') AND up.state='ready'))
    AND NOT EXISTS(SELECT 1 FROM json_each(src.media) a JOIN moderated_uploads mu ON mu.uploadId=json_extract(a.value,'$.id'))`;
  const results = await db().batch([
    db()
      .prepare(`INSERT INTO messages(id,sender,recipient,text,media,created,forwardedName,forwardSourceId)
      SELECT 'forward:'||s.id||':'||?||':'||j.key,s.id,r.id,src.text,src.media,?+CAST(j.key AS INTEGER),
        CASE WHEN src.forwardedName<>'' THEN src.forwardedName ELSE origin.name END,src.id
      FROM json_each(?) j JOIN messages src ON src.id=j.value JOIN users origin ON origin.id=src.sender,users s,users r
      WHERE s.id=? AND r.id=? AND s.kind='person' AND r.kind='person' AND ${visibleAccount('s')} AND ${visibleAccount('r')} AND ${messageWritable('s.id')} AND ${messageAllowed}
      AND (SELECT COUNT(*) FROM messages src,json_each(?) requested WHERE src.id=requested.value AND ${sourceAccess})=?
      AND NOT EXISTS(SELECT 1 FROM messages WHERE id IN (SELECT value FROM json_each(?)))
      ON CONFLICT(id) DO NOTHING`)
      .bind(
        key,
        Date.now(),
        json,
        me,
        recipient,
        json,
        peer,
        peer,
        ids.length,
        outputJson,
      ),
    db()
      .prepare(
        `INSERT OR IGNORE INTO notifications(id,userId,actorId,kind,targetId,created) SELECT 'message:'||id,recipient,sender,'message',id,created FROM messages WHERE id IN (SELECT value FROM json_each(?)) AND deletedAt=0`,
      )
      .bind(outputJson),
  ]);
  if (
    results[0].meta.changes !== ids.length &&
    !matches((await saved()).results)
  )
    throw new ApiError(
      403,
      'Пересылка недоступна: проверь сообщения и настройки получателя',
    );
  return { ids: outputIds };
}
