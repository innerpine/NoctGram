import { db } from './storage';
import { ApiError } from './api-error';
import { assertSpamIdentity } from './antispam';
import { groupSenderVisible } from './antispam-access';
import { access } from './room-access';
import { messageSummarySql } from './message-summary-sql';

import {
  GENERAL_TOPIC,
  GENERAL_TOPIC_TITLE,
  TOPIC_LIMIT,
  TOPIC_TITLE_LIMIT,
  type RoomTopic,
} from './room-topic-shared';

export * from './room-topic-shared';

// The API names «Общее» 'general'; storage uses ''.
export function topicKey(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 100)
    throw new ApiError(400, 'Некорректная тема');
  return value === GENERAL_TOPIC ? '' : value;
}
export const topicName = (topicId: string) => topicId || GENERAL_TOPIC;

function title(value: unknown) {
  if (typeof value !== 'string')
    throw new ApiError(400, 'Укажите название темы');
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > TOPIC_TITLE_LIMIT)
    throw new ApiError(400, 'Название темы — от 1 до 128 символов');
  return trimmed;
}
function color(value: unknown) {
  if (value === undefined) return 0;
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 5
  )
    throw new ApiError(400, 'Выберите цвет темы');
  return value as number;
}
function emoji(value: unknown) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 16 || /\s/.test(value))
    throw new ApiError(400, 'Выберите эмодзи темы');
  return value;
}
const manager = (r: string, actor: string) =>
  access(r, actor, true, ['owner', 'admin']);
// The topic's creator or a group admin may edit, close or reopen it.
const topicEditor = (t: string, r: string, actor: string) =>
  `(${access(r, actor, true)} AND (${t}.createdBy=${actor} OR EXISTS(SELECT 1 FROM chat_room_members em WHERE em.roomId=${r}.id AND em.userId=${actor} AND em.status='active' AND em.role IN ('owner','admin'))))`;

function changed(result: { meta: { changes?: number } }) {
  if (!result.meta.changes)
    throw new ApiError(403, 'Действие с темой недоступно. Обновите чат');
}

export async function setForum(
  me: string,
  roomId: string,
  enabled: unknown,
  now: number,
) {
  if (typeof enabled !== 'boolean')
    throw new ApiError(400, 'Укажите, включить ли темы');
  changed(
    await db()
      .prepare(
        `WITH input AS (SELECT ? AS actor) UPDATE chat_rooms SET forum=?,updatedAt=? WHERE id=? AND kind='group'
        AND EXISTS(SELECT 1 FROM input i WHERE ${manager('chat_rooms', 'i.actor')})`,
      )
      .bind(me, enabled ? 1 : 0, now, roomId)
      .run(),
  );
}
export async function createTopic(
  me: string,
  roomId: string,
  body: Record<string, unknown>,
  now: number,
) {
  const name = title(body.title);
  const tint = color(body.color),
    icon = emoji(body.emoji);
  await assertSpamIdentity(me, name);
  const topicId = crypto.randomUUID();
  const result = await db()
    .prepare(
      `WITH input AS (SELECT ? AS actor)
      INSERT INTO chat_room_topics(id,roomId,title,color,emoji,createdBy,created,updatedAt)
      SELECT ?,r.id,?,?,?,i.actor,?,? FROM chat_rooms r,input i WHERE r.id=? AND r.kind='group' AND r.forum=1
      AND ${manager('r', 'i.actor')}
      AND (SELECT COUNT(*) FROM chat_room_topics existing WHERE existing.roomId=r.id AND existing.deletedAt=0)<${TOPIC_LIMIT}`,
    )
    .bind(me, topicId, name, tint, icon, now, now, roomId)
    .run();
  if (!result.meta.changes)
    throw new ApiError(
      403,
      'Темы создают администраторы группы с включёнными темами, до 100 тем',
    );
  return { id: topicId };
}
export async function updateTopic(
  me: string,
  roomId: string,
  body: Record<string, unknown>,
  now: number,
) {
  const topicId = topicKey(body.topicId);
  if (!topicId) throw new ApiError(400, 'Тему «Общее» нельзя изменить');
  const name = title(body.title);
  const tint = color(body.color),
    icon = emoji(body.emoji);
  await assertSpamIdentity(me, name);
  changed(
    await db()
      .prepare(
        `WITH input AS (SELECT ? AS actor) UPDATE chat_room_topics SET title=?,color=?,emoji=?,updatedAt=?
        WHERE id=? AND roomId=? AND deletedAt=0 AND EXISTS(SELECT 1 FROM chat_rooms r,input i
          WHERE r.id=chat_room_topics.roomId AND r.kind='group' AND ${topicEditor('chat_room_topics', 'r', 'i.actor')})`,
      )
      .bind(me, name, tint, icon, now, topicId, roomId)
      .run(),
  );
}
export async function closeTopic(
  me: string,
  roomId: string,
  body: Record<string, unknown>,
  closed: boolean,
  now: number,
) {
  const topicId = topicKey(body.topicId);
  if (!topicId) throw new ApiError(400, 'Тему «Общее» нельзя закрыть');
  changed(
    await db()
      .prepare(
        `WITH input AS (SELECT ? AS actor) UPDATE chat_room_topics SET closedAt=?,updatedAt=?
        WHERE id=? AND roomId=? AND deletedAt=0 AND EXISTS(SELECT 1 FROM chat_rooms r,input i
          WHERE r.id=chat_room_topics.roomId AND r.kind='group' AND ${topicEditor('chat_room_topics', 'r', 'i.actor')})`,
      )
      .bind(me, closed ? now : 0, now, topicId, roomId)
      .run(),
  );
}
// Deleting a topic removes its messages for everyone, like in Telegram.
export async function deleteTopic(
  me: string,
  roomId: string,
  body: Record<string, unknown>,
  now: number,
) {
  const topicId = topicKey(body.topicId);
  if (!topicId) throw new ApiError(400, 'Тему «Общее» нельзя удалить');
  const [result] = await db().batch([
    db()
      .prepare(
        `WITH input AS (SELECT ? AS actor) UPDATE chat_room_topics SET deletedAt=?,updatedAt=?
        WHERE id=? AND roomId=? AND deletedAt=0 AND EXISTS(SELECT 1 FROM chat_rooms r,input i
          WHERE r.id=chat_room_topics.roomId AND r.kind='group' AND ${manager('r', 'i.actor')})`,
      )
      .bind(me, now, now, topicId, roomId),
    db()
      .prepare(
        `UPDATE chat_room_messages SET text='',ciphertext=NULL,deletedAt=? WHERE roomId=? AND topicId=? AND deletedAt=0
        AND EXISTS(SELECT 1 FROM chat_room_topics t WHERE t.id=? AND t.roomId=? AND t.deletedAt=?)`,
      )
      .bind(now, roomId, topicId, topicId, roomId, now),
    db()
      .prepare(
        `DELETE FROM chat_room_message_reactions WHERE messageId IN(SELECT id FROM chat_room_messages WHERE roomId=? AND topicId=? AND deletedAt>0)
        AND EXISTS(SELECT 1 FROM chat_room_topics t WHERE t.id=? AND t.roomId=? AND t.deletedAt>0)`,
      )
      .bind(roomId, topicId, topicId, roomId),
    db()
      .prepare(
        `DELETE FROM chat_room_topic_reads WHERE roomId=? AND topicId=? AND EXISTS(SELECT 1 FROM chat_room_topics t WHERE t.id=? AND t.roomId=? AND t.deletedAt>0)`,
      )
      .bind(roomId, topicId, topicId, roomId),
  ]);
  changed(result);
}
// Moves a member's read position in one topic forward, never back past the
// room-wide position that older clients still update.
export async function markTopicRead(
  me: string,
  roomId: string,
  topicId: string,
  through: string,
) {
  const newer = `seen.created>m.lastReadAt OR (seen.created=m.lastReadAt AND seen.id>m.lastReadId)`;
  await db()
    .prepare(
      `INSERT INTO chat_room_topic_reads(roomId,topicId,userId,lastReadAt,lastReadId)
      SELECT seen.roomId,seen.topicId,m.userId,CASE WHEN ${newer} THEN seen.created ELSE m.lastReadAt END,CASE WHEN ${newer} THEN seen.id ELSE m.lastReadId END
      FROM chat_room_messages seen JOIN chat_room_members m ON m.roomId=seen.roomId AND m.userId=?
      WHERE seen.id=? AND seen.roomId=? AND seen.topicId=?
      AND EXISTS(SELECT 1 FROM chat_rooms r WHERE r.id=seen.roomId AND r.kind='group' AND ${access('r', 'm.userId')})
      ON CONFLICT(roomId,topicId,userId) DO UPDATE SET lastReadAt=excluded.lastReadAt,lastReadId=excluded.lastReadId
      WHERE excluded.lastReadAt>chat_room_topic_reads.lastReadAt
        OR (excluded.lastReadAt=chat_room_topic_reads.lastReadAt AND excluded.lastReadId>chat_room_topic_reads.lastReadId)`,
    )
    .bind(me, through, roomId, topicId)
    .run();
}
// Unread messages of one topic for a member (alias m), falling back to the
// room-wide read position until the topic has been opened.
export function topicUnreadSql(topic: string, room: string, member: string) {
  const at = `COALESCE((SELECT tr.lastReadAt FROM chat_room_topic_reads tr WHERE tr.roomId=${room} AND tr.topicId=${topic} AND tr.userId=${member}.userId),${member}.lastReadAt)`;
  const id = `COALESCE((SELECT tr.lastReadId FROM chat_room_topic_reads tr WHERE tr.roomId=${room} AND tr.topicId=${topic} AND tr.userId=${member}.userId),${member}.lastReadId)`;
  return `FROM chat_room_messages um WHERE um.roomId=${room} AND um.topicId=${topic} AND um.sender<>${member}.userId AND um.deletedAt=0 AND ${groupSenderVisible('um')}
    AND (um.created>${at} OR (um.created=${at} AND um.id>${id}))`;
}
// A forum's unread count in the chat list is the number of unread topics.
export function forumUnreadSql(r: string, member: string) {
  return `(EXISTS(SELECT 1 ${topicUnreadSql("''", `${r}.id`, member)})
    + (SELECT COUNT(*) FROM chat_room_topics ft WHERE ft.roomId=${r}.id AND ft.deletedAt=0 AND EXISTS(SELECT 1 ${topicUnreadSql('ft.id', `${r}.id`, member)})))`;
}
export async function readTopics(
  me: string,
  roomId: string,
): Promise<RoomTopic[]> {
  const rows = await db()
    .prepare(
      `WITH topics(id,title,color,emoji,createdBy,created,updatedAt,closedAt) AS (
        SELECT '','${GENERAL_TOPIC_TITLE}',0,'',r.ownerId,r.created,r.created,0 FROM chat_rooms r WHERE r.id=?2
        UNION ALL
        SELECT t.id,t.title,t.color,t.emoji,t.createdBy,t.created,t.updatedAt,t.closedAt FROM chat_room_topics t WHERE t.roomId=?2 AND t.deletedAt=0
      )
      SELECT tp.*,
        (SELECT json_object('id',lm.id,'text',${messageSummarySql('lm', { textLimit: 120, empty: '' })},'created',lm.created,'sender',lm.sender,'senderName',lu.name)
          FROM chat_room_messages lm JOIN users lu ON lu.id=lm.sender
          WHERE lm.roomId=?2 AND lm.topicId=tp.id AND lm.deletedAt=0 AND ${groupSenderVisible('lm')}
          ORDER BY lm.created DESC,lm.id DESC LIMIT 1) AS lastMessage,
        (SELECT COUNT(*) ${topicUnreadSql('tp.id', '?2', 'm')}) AS unread
      FROM topics tp JOIN chat_room_members m ON m.roomId=?2 AND m.userId=?1 AND m.status='active'`,
    )
    .bind(me, roomId)
    .all<Omit<RoomTopic, 'lastMessage'> & { lastMessage: string | null }>();
  return rows.results
    .map((row) => ({
      ...row,
      id: topicName(row.id),
      lastMessage: row.lastMessage ? JSON.parse(row.lastMessage) : null,
    }))
    .sort(
      (a, b) =>
        Number(b.id === GENERAL_TOPIC) - Number(a.id === GENERAL_TOPIC) ||
        (b.lastMessage?.created || b.updatedAt) -
          (a.lastMessage?.created || a.updatedAt),
    );
}
