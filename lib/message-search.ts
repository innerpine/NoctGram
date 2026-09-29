import { db } from './storage';
import { ApiError } from './api-error';
import { visibleAccount } from './account-access';
import { messageVisible } from './chat-access';
import { access } from './room-access';
import { groupSenderVisible } from './antispam-access';
import {
  SEARCH_QUERY_LIMIT,
  normalizeSearch,
  searchPattern,
} from './search-text';
import { topicKey } from './room-topics';

export const SEARCH_PAGE = 30;
// Scans stay bounded: the latest messages of one chat, or of all chats.
const CHAT_SCAN = 5000;
const ALL_SCAN = 10000;
const ROOM_LIMIT = 200;
const BACKFILL_BATCH = 500;

export type SearchHit = {
  kind: 'dm' | 'room';
  id: string;
  // The other person in a direct chat, or the group.
  chatId: string;
  chatName: string;
  chatAvatar: string;
  forum?: boolean;
  // Forum topic of a group message; absent for «Общее».
  topicId?: string;
  sender: string;
  senderName: string;
  text: string;
  created: number;
};
export type SearchPage = {
  items: SearchHit[];
  next: string | null;
  // Matches in one chat, counted on the first page.
  total?: number;
};
type Cursor = { created: number; id: string };

function query(value: unknown) {
  if (typeof value !== 'string') throw new ApiError(400, 'Введите запрос');
  const raw = value.trim().replace(/\s+/g, ' ');
  const normalized = normalizeSearch(raw);
  if (!normalized || raw.length > SEARCH_QUERY_LIMIT)
    throw new ApiError(400, 'Запрос — от 1 до 100 символов');
  const capital = raw[0].toLocaleUpperCase('ru') + raw.slice(1);
  // Rows indexed before searchText existed fall back to plain LIKE in the
  // usual spellings; everything newer matches case-insensitively.
  return [
    searchPattern(normalized),
    searchPattern(raw),
    searchPattern(capital),
    searchPattern(raw.toLocaleUpperCase('ru')),
  ];
}
const matches = (alias: string, first: number) =>
  `(${alias}.searchText LIKE ?${first} ESCAPE '\\' OR (${alias}.searchText IS NULL AND (${alias}.text LIKE ?${first + 1} ESCAPE '\\' OR ${alias}.text LIKE ?${first + 2} ESCAPE '\\' OR ${alias}.text LIKE ?${first + 3} ESCAPE '\\')))`;
function cursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value.slice(0, 500)));
    if (
      Number.isSafeInteger(parsed.created) &&
      typeof parsed.id === 'string' &&
      parsed.id.length <= 250
    )
      return { created: parsed.created, id: parsed.id };
  } catch {
    /* Reported below. */
  }
  throw new ApiError(400, 'Некорректная страница поиска');
}
const before = (alias: string, first: number) =>
  `(${alias}.created<?${first} OR (${alias}.created=?${first} AND ${alias}.id<?${first + 1}))`;
function page(items: SearchHit[]): SearchPage {
  const shown = items.slice(0, SEARCH_PAGE);
  const last = shown.at(-1);
  return {
    items: shown,
    next:
      items.length > SEARCH_PAGE && last
        ? btoa(JSON.stringify({ created: last.created, id: last.id }))
        : null,
  };
}
function hit(row: SearchHit & { forum?: number | boolean; topicId?: string }) {
  const { forum, topicId, ...rest } = row;
  return {
    ...rest,
    ...(row.kind === 'room' ? { forum: !!forum } : {}),
    ...(topicId ? { topicId } : {}),
  } as SearchHit;
}

// Messages of one direct chat (including «Избранное») or one group.
export async function searchChat(
  me: string,
  params: {
    q: unknown;
    peer?: string | null;
    room?: string | null;
    topic?: string | null;
    before?: string | null;
  },
): Promise<SearchPage> {
  const patterns = query(params.q);
  const position = cursor(params.before);
  if (params.peer) {
    const peer = String(params.peer).slice(0, 100);
    const scope = `WITH scope AS (
      SELECT m.id,m.sender,m.text,m.searchText,m.created FROM messages m
      WHERE ((m.sender=?1 AND m.recipient=?2) OR (m.sender=?2 AND m.recipient=?1)) AND ${messageVisible('m', '?1')} AND m.giftReceiptId IS NULL
      ORDER BY m.created DESC,m.id DESC LIMIT ${CHAT_SCAN})`;
    const rows = await db()
      .prepare(
        `${scope} SELECT 'dm' AS kind,s.id,?2 AS chatId,peer.name AS chatName,peer.avatar AS chatAvatar,s.sender,su.name AS senderName,s.text,s.created
        FROM scope s JOIN users su ON su.id=s.sender JOIN users peer ON peer.id=?2
        WHERE ${matches('s', 3)} ${position ? 'AND ' + before('s', 7) : ''}
        ORDER BY s.created DESC,s.id DESC LIMIT ${SEARCH_PAGE + 1}`,
      )
      .bind(
        me,
        peer,
        ...patterns,
        ...(position ? [position.created, position.id] : []),
      )
      .all<SearchHit>();
    const result = page(rows.results.map(hit));
    if (!position)
      result.total =
        (
          await db()
            .prepare(
              `${scope} SELECT COUNT(*) AS n FROM scope s WHERE ${matches('s', 3)}`,
            )
            .bind(me, peer, ...patterns)
            .first<{ n: number }>()
        )?.n || 0;
    return result;
  }
  const roomId = String(params.room || '').slice(0, 100);
  if (!roomId) throw new ApiError(400, 'Выберите чат для поиска');
  const allowed = await db()
    .prepare(
      `WITH input AS (SELECT ? AS actor) SELECT r.forum FROM chat_rooms r,input i WHERE r.id=? AND r.kind='group' AND ${access('r', 'i.actor')}`,
    )
    .bind(me, roomId)
    .first<{ forum: number }>();
  if (!allowed) throw new ApiError(404, 'Чат недоступен');
  const topic = allowed.forum ? topicKey(params.topic) : null;
  const scope = `WITH scope AS (
    SELECT m.id,m.sender,m.text,m.searchText,m.created,m.topicId FROM chat_room_messages m
    WHERE m.roomId=?1 AND m.deletedAt=0 AND m.ciphertext IS NULL AND ${groupSenderVisible('m')} ${topic !== null ? 'AND m.topicId=?2' : 'AND ?2 IS NULL'}
    ORDER BY m.created DESC,m.id DESC LIMIT ${CHAT_SCAN})`;
  const rows = await db()
    .prepare(
      `${scope} SELECT 'room' AS kind,s.id,?1 AS chatId,r.name AS chatName,r.avatar AS chatAvatar,r.forum,s.topicId,s.sender,u.name AS senderName,s.text,s.created
      FROM scope s JOIN users u ON u.id=s.sender JOIN chat_rooms r ON r.id=?1
      WHERE ${matches('s', 3)} ${position ? 'AND ' + before('s', 7) : ''}
      ORDER BY s.created DESC,s.id DESC LIMIT ${SEARCH_PAGE + 1}`,
    )
    .bind(
      roomId,
      topic,
      ...patterns,
      ...(position ? [position.created, position.id] : []),
    )
    .all<SearchHit & { forum: number; topicId: string }>();
  const result = page(rows.results.map(hit));
  if (!position)
    result.total =
      (
        await db()
          .prepare(
            `${scope} SELECT COUNT(*) AS n FROM scope s WHERE ${matches('s', 3)}`,
          )
          .bind(roomId, topic, ...patterns)
          .first<{ n: number }>()
      )?.n || 0;
  return result;
}

// Messages across the viewer's direct chats and groups, newest first.
export async function searchAll(
  me: string,
  params: { q: unknown; before?: string | null },
): Promise<SearchPage> {
  const patterns = query(params.q);
  const position = cursor(params.before);
  const direct = await db()
    .prepare(
      `WITH scope AS (
        SELECT m.id,m.sender,m.recipient,m.text,m.searchText,m.created FROM messages m
        WHERE (m.sender=?1 OR m.recipient=?1) AND ${messageVisible('m', '?1')} AND m.giftReceiptId IS NULL
        ORDER BY m.created DESC,m.id DESC LIMIT ${ALL_SCAN})
      SELECT 'dm' AS kind,s.id,peer.id AS chatId,peer.name AS chatName,peer.avatar AS chatAvatar,s.sender,su.name AS senderName,s.text,s.created
      FROM scope s JOIN users peer ON peer.id=CASE WHEN s.sender=?1 THEN s.recipient ELSE s.sender END JOIN users su ON su.id=s.sender
      WHERE ${matches('s', 2)} AND ${visibleAccount('peer')} ${position ? 'AND ' + before('s', 6) : ''}
      ORDER BY s.created DESC,s.id DESC LIMIT ${SEARCH_PAGE + 1}`,
    )
    .bind(me, ...patterns, ...(position ? [position.created, position.id] : []))
    .all<SearchHit>();
  const rooms = await db()
    .prepare(
      `SELECT r.id FROM chat_rooms r JOIN chat_room_members m ON m.roomId=r.id AND m.userId=? AND m.status='active'
      WHERE r.kind='group' AND ${access('r', 'm.userId')} LIMIT ${ROOM_LIMIT}`,
    )
    .bind(me)
    .all<{ id: string }>();
  const grouped = rooms.results.length
    ? await db()
        .prepare(
          `WITH scope AS (
            SELECT m.id,m.roomId,m.sender,m.text,m.searchText,m.created,m.topicId FROM chat_room_messages m
            WHERE m.roomId IN (SELECT value FROM json_each(?1)) AND m.deletedAt=0 AND m.ciphertext IS NULL AND ${groupSenderVisible('m')}
            ORDER BY m.created DESC,m.id DESC LIMIT ${ALL_SCAN})
          SELECT 'room' AS kind,s.id,s.roomId AS chatId,r.name AS chatName,r.avatar AS chatAvatar,r.forum,s.topicId,s.sender,u.name AS senderName,s.text,s.created
          FROM scope s JOIN chat_rooms r ON r.id=s.roomId JOIN users u ON u.id=s.sender
          WHERE ${matches('s', 2)} ${position ? 'AND ' + before('s', 6) : ''}
          ORDER BY s.created DESC,s.id DESC LIMIT ${SEARCH_PAGE + 1}`,
        )
        .bind(
          JSON.stringify(rooms.results.map((room) => room.id)),
          ...patterns,
          ...(position ? [position.created, position.id] : []),
        )
        .all<SearchHit & { forum: number; topicId: string }>()
    : { results: [] };
  return page(
    [...direct.results, ...grouped.results]
      .map(hit)
      .sort((a, b) => b.created - a.created || b.id.localeCompare(a.id)),
  );
}

// Indexes messages written before searchText existed, a batch per job run.
export async function backfillSearchText() {
  let indexed = 0;
  for (const table of ['messages', 'chat_room_messages'] as const) {
    const rows = await db()
      .prepare(
        `SELECT id,text FROM ${table} WHERE searchText IS NULL LIMIT ${BACKFILL_BATCH}`,
      )
      .all<{ id: string; text: string }>();
    if (!rows.results.length) continue;
    await db()
      .prepare(
        `UPDATE ${table} SET searchText=json_extract(j.value,'$.s') FROM json_each(?) j
        WHERE ${table}.id=json_extract(j.value,'$.id') AND ${table}.searchText IS NULL`,
      )
      .bind(
        JSON.stringify(
          rows.results.map((row) => ({
            id: row.id,
            s: normalizeSearch(row.text),
          })),
        ),
      )
      .run();
    indexed += rows.results.length;
  }
  return indexed;
}
