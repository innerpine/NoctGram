import { db } from './storage';
import type { Message } from './client';
import { ApiError } from './api-error';
import { messageAllowed } from './privacy';
import { visibleAccount } from './account-access';
import { messageVisible, messagePair } from './chat-access';

export async function readUnreadMessageCount(me: string): Promise<number> {
  // The navigation badge only displays up to 99+, without loading every peer's
  // appearance, last message and conversation history on every background poll.
  const row = await db()
    .prepare(`SELECT COUNT(*) AS unread FROM (
      SELECT 1 FROM messages m JOIN users u ON u.id=m.sender
      WHERE m.recipient=? AND m.read=0 AND ${messageVisible('m', 'm.recipient')}
        AND ${visibleAccount('u')}
        AND EXISTS(SELECT 1 FROM handles h WHERE h.userId=u.id AND h.main=1)
      LIMIT 100
    )`)
    .bind(me)
    .first<{ unread: number }>();
  return row?.unread || 0;
}

export async function readConversation(
  me: string,
  peer: string,
  focus = '',
): Promise<Message[]> {
  await db().batch([
    db()
      .prepare(
        `UPDATE messages SET read=1 WHERE sender=? AND recipient=? AND read=0 AND ${messageVisible('messages', 'messages.recipient')}`,
      )
      .bind(peer, me),
    db()
      .prepare(`UPDATE notifications SET read=1 WHERE userId=? AND kind='gift' AND read=0
      AND EXISTS(SELECT 1 FROM messages m WHERE m.giftReceiptId=notifications.targetId
        AND m.sender=? AND m.recipient=? AND ${messageVisible('m', 'm.recipient')})`)
      .bind(me, peer, me),
  ]);
  const rows = await db()
    .prepare(`WITH RECURSIVE scope AS (SELECT ? AS me,? AS peer), visible AS (
      SELECT m.* FROM messages m,scope s WHERE ${messagePair('m', 's.me', 's.peer')} AND ${messageVisible('m', 's.me')}
    ), recent AS (SELECT * FROM visible ORDER BY created DESC,id DESC LIMIT 300), chosen AS (
      SELECT * FROM recent UNION SELECT m.* FROM visible m JOIN message_pins p ON p.messageId=m.id
      UNION SELECT * FROM visible WHERE id=?
    ), attribution(copyId,id,sender,forwardSourceId,forwardedName) AS (
      SELECT m.id,src.id,src.sender,src.forwardSourceId,src.forwardedName
      FROM chosen m JOIN messages src ON src.id=m.forwardSourceId WHERE m.forwardedName<>''
      UNION
      SELECT a.copyId,src.id,src.sender,src.forwardSourceId,src.forwardedName
      FROM attribution a JOIN messages src ON src.id=a.forwardSourceId
    ) SELECT m.id,m.sender,m.recipient,m.text,m.media,m.created,m.read,m.editedAt,m.forwardedName,p.created AS pinnedAt,
      (SELECT a.sender FROM attribution a WHERE a.copyId=m.id AND a.forwardSourceId IS NULL AND a.forwardedName='' LIMIT 1) AS forwardedSender,
      m.replyTo,rp.id AS replyId,rp.sender AS replySender,ru.name AS replyName,
      CASE WHEN rp.text<>'' THEN substr(rp.text,1,240) WHEN json_array_length(rp.media)>0 THEN
        CASE json_extract(rp.media,'$[0].kind') WHEN 'image' THEN 'Фото' WHEN 'video' THEN 'Видео' ELSE json_extract(rp.media,'$[0].name') END ELSE 'Сообщение' END AS replyText,
      g.id AS receiptId,g.giftId AS giftType,g.message AS giftMessage,t.amount AS giftPrice
    FROM chosen m
    LEFT JOIN message_pins p ON p.messageId=m.id
    LEFT JOIN messages rp ON rp.id=m.replyTo AND ${messagePair('rp', 'm.sender', 'm.recipient')} AND ${messageVisible('rp', '(SELECT me FROM scope)')}
    LEFT JOIN users ru ON ru.id=rp.sender
    LEFT JOIN received_gifts g ON g.id=m.giftReceiptId AND g.sender=m.sender AND g.recipient=m.recipient
    LEFT JOIN star_transfers t ON t.id=g.transferId AND t.kind='gift' AND t.sender=g.sender
    ORDER BY m.created,m.id`)
    .bind(me, peer, focus.slice(0, 250))
    .all<
      Message & {
        media: string;
        receiptId: string | null;
        giftType: string | null;
        giftMessage: string | null;
        giftPrice: number | null;
        replyTo: string | null;
        replyId: string | null;
        replySender: string | null;
        replyName: string | null;
        replyText: string | null;
      }
    >();
  return rows.results.map(
    ({
      receiptId,
      giftType,
      giftMessage,
      giftPrice,
      media,
      replyTo,
      replyId,
      replySender,
      replyName,
      replyText,
      ...message
    }) => ({
      ...message,
      attachments: JSON.parse(media),
      ...(replyTo
        ? {
            reply: {
              id: replyTo,
              sender: replySender || '',
              name: replyName || '',
              text: replyId ? replyText || 'Сообщение' : 'Сообщение недоступно',
              unavailable: !replyId,
            },
          }
        : {}),
      ...(receiptId && giftType && giftPrice !== null
        ? {
            gift: {
              id: receiptId,
              giftId: giftType,
              message: giftMessage || '',
              price: giftPrice,
            },
          }
        : {}),
    }),
  );
}

export async function pinMessage(me: string, body: Record<string, unknown>) {
  const { id, peer, value } = body;
  if (
    typeof id !== 'string' ||
    id.length > 250 ||
    typeof peer !== 'string' ||
    peer.length > 100 ||
    peer === me ||
    typeof value !== 'boolean'
  )
    throw new ApiError(400, 'Выбери сообщение в диалоге');
  const [first, second] = [me, peer].sort();
  const access = `EXISTS(SELECT 1 FROM messages m,users s,users r WHERE m.id=? AND s.id=? AND r.id=?
    AND ((m.sender=s.id AND m.recipient=r.id) OR (m.sender=r.id AND m.recipient=s.id))
    AND ${messageVisible('m', 's.id')}
    AND ${visibleAccount('s')} AND ${visibleAccount('r')} AND ${messageAllowed}
    AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=s.id AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000)))`;
  const allowed = await db()
    .prepare(`SELECT 1 WHERE ${access}`)
    .bind(id, me, peer)
    .first();
  if (!allowed)
    throw new ApiError(403, 'Закрепление недоступно в этом диалоге');
  if (value) {
    await db()
      .prepare(`INSERT INTO message_pins(messageId,firstId,secondId,pinnedBy,created)
      SELECT ?,?,?,?,? WHERE ${access} AND (SELECT COUNT(*) FROM message_pins WHERE firstId=? AND secondId=?)<10
      ON CONFLICT(messageId) DO NOTHING`)
      .bind(id, first, second, me, Date.now(), id, me, peer, first, second)
      .run();
    if (
      !(await db()
        .prepare(
          'SELECT 1 FROM message_pins WHERE messageId=? AND firstId=? AND secondId=?',
        )
        .bind(id, first, second)
        .first())
    )
      throw new ApiError(400, 'В диалоге можно закрепить до 10 сообщений');
  } else {
    await db()
      .prepare(
        `DELETE FROM message_pins WHERE messageId=? AND firstId=? AND secondId=? AND ${access}`,
      )
      .bind(id, first, second, id, me, peer)
      .run();
  }
  return { ok: true };
}
