import { db } from './storage';
import { ApiError } from './api-error';
import {
  assertPostVisible,
  assertWritable,
  visibleAccount,
} from './account-access';
import { assertUnqueuedPublicWrite } from './antispam';
import { assertPremiumEmoji } from './premium-emoji-access';
import { directMessageAllowed } from './privacy';
import { messagePair, messageVisible, messageWritable } from './chat-access';
import { canSend, groupMessageReadable } from './room-access';
import { published } from './channel-access';
import { rateLimit } from './rate-limit';
import { normalizeSearch } from './search-text';

export const FORWARD_ITEM_LIMIT = 20;
export const FORWARD_TARGET_LIMIT = 10;
export const FORWARD_COMMENT_LIMIT = 4000;

export type ForwardSource =
  | { dm: { peer: string; ids: string[] } }
  | { room: { roomId: string; ids: string[] } }
  | { post: { postId: string } };
export type ForwardTarget =
  | { dm: { peer: string } }
  | { room: { roomId: string } };
export type ForwardResult =
  | { target: ForwardTarget; ok: true; ids: string[] }
  | { target: ForwardTarget; ok: false; error: string };

type Row = {
  id: string;
  text: string;
  media: string;
  forwardedName: string;
  forwardedFrom: string | null;
  forwardSourceId: string | null;
  postShareId: string | null;
  searchText?: string;
};
type SourceRow = {
  id: string;
  sender: string;
  text: string;
  media: string;
  forwardedName: string;
  forwardedFrom: string | null;
  postShareId: string | null;
  originName: string;
};
type Gate = { sql: string; bindings: (string | number)[] };

const KEY = /^[a-zA-Z0-9-]{16,80}$/;
const denied =
  'Пересылка в этот чат недоступна: проверьте доступ и настройки получателя';

function value(input: unknown, max: number) {
  if (typeof input !== 'string' || !input || input.length > max)
    throw new ApiError(400, 'Проверьте, что именно и куда пересылаете');
  return input;
}
function ids(input: unknown) {
  if (
    !Array.isArray(input) ||
    !input.length ||
    input.length > FORWARD_ITEM_LIMIT ||
    input.some((id) => typeof id !== 'string' || !id || id.length > 250) ||
    new Set(input).size !== input.length
  )
    throw new ApiError(400, 'Выберите от 1 до 20 сообщений');
  return input as string[];
}
function object(input: unknown) {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}
export function parseForwardSource(input: unknown): ForwardSource {
  const source = object(input);
  const dm = object(source?.dm),
    room = object(source?.room),
    post = object(source?.post);
  if ([dm, room, post].filter(Boolean).length !== 1)
    throw new ApiError(400, 'Выберите, что переслать');
  if (dm) return { dm: { peer: value(dm.peer, 100), ids: ids(dm.ids) } };
  if (room)
    return { room: { roomId: value(room.roomId, 100), ids: ids(room.ids) } };
  return { post: { postId: value(post!.postId, 200) } };
}
export function parseForwardTargets(input: unknown): ForwardTarget[] {
  if (
    !Array.isArray(input) ||
    !input.length ||
    input.length > FORWARD_TARGET_LIMIT
  )
    throw new ApiError(400, 'Выберите от 1 до 10 чатов');
  const seen = new Set<string>();
  return input.map((item) => {
    const target = object(item);
    const dm = object(target?.dm),
      room = object(target?.room);
    if (!dm === !room) throw new ApiError(400, 'Выберите чат для пересылки');
    const parsed: ForwardTarget = dm
      ? { dm: { peer: value(dm.peer, 100) } }
      : { room: { roomId: value(room!.roomId, 100) } };
    const key =
      'dm' in parsed ? 'dm:' + parsed.dm.peer : 'room:' + parsed.room.roomId;
    if (seen.has(key)) throw new ApiError(400, 'Чат выбран дважды');
    seen.add(key);
    return parsed;
  });
}

// Room message ids are UUIDs. A forwarded copy gets a stable name-based UUID,
// so a retried request writes the same ids instead of duplicates.
export async function forwardRoomMessageId(seed: string) {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)),
  );
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = Array.from(hash.slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Every attachment must still be a ready upload that moderation has not removed.
const mediaUsable = (
  media: string,
) => `NOT EXISTS(SELECT 1 FROM json_each(${media}) a WHERE NOT EXISTS(
    SELECT 1 FROM uploads up WHERE up.id=json_extract(a.value,'$.id') AND up.state='ready'
      AND NOT EXISTS(SELECT 1 FROM moderated_uploads mu WHERE mu.uploadId=up.id)))`;

// Reads the source messages in the requested order and returns a gate that the
// write statements repeat, so a message deleted meanwhile stops the copy.
async function readSource(me: string, source: ForwardSource) {
  if ('post' in source) {
    await assertPostVisible(source.post.postId, me);
    return {
      rows: [
        {
          text: '',
          media: '[]',
          forwardedName: '',
          forwardedFrom: null,
          forwardSourceId: null,
          postShareId: source.post.postId,
        },
      ],
      gate: {
        sql: `AND EXISTS(SELECT 1 FROM posts sp WHERE sp.id=? AND ${published('sp')})`,
        bindings: [source.post.postId],
      } as Gate,
    };
  }
  const list = 'dm' in source ? source.dm.ids : source.room.ids,
    json = JSON.stringify(list);
  const found =
    'dm' in source
      ? await db()
          .prepare(`SELECT src.id,src.sender,src.text,src.media,src.forwardedName,src.forwardedFrom,src.postShareId,origin.name AS originName
          FROM json_each(?) j JOIN messages src ON src.id=j.value JOIN users origin ON origin.id=src.sender
          WHERE ${messagePair('src', '?', '?')} AND ${messageVisible('src', '?')} AND src.giftReceiptId IS NULL AND ${mediaUsable('src.media')}
          ORDER BY j.key`)
          .bind(json, me, source.dm.peer, source.dm.peer, me, me)
          .all<SourceRow>()
      : await db()
          .prepare(`WITH input AS (SELECT ? AS actor)
          SELECT src.id,src.sender,src.text,src.media,src.forwardedName,src.forwardedFrom,src.postShareId,origin.name AS originName
          FROM input i,json_each(?) j JOIN chat_room_messages src ON src.id=j.value JOIN users origin ON origin.id=src.sender
          WHERE src.roomId=? AND src.giveawayId IS NULL AND ${groupMessageReadable('src', 'i.actor')} AND ${mediaUsable('src.media')}
          ORDER BY j.key`)
          .bind(me, json, source.room.roomId)
          .all<SourceRow>();
  if (found.results.length !== list.length)
    throw new ApiError(403, 'Некоторые сообщения недоступны для пересылки');
  const rows = found.results.map((row) => {
    // A shared post keeps pointing at the post; a forwarded copy keeps its
    // original author, not the person who forwarded it last.
    const shared = row.postShareId !== null && !row.text && row.media === '[]';
    const forwarded = row.forwardedName !== '';
    return {
      text: row.text,
      media: row.media,
      forwardedName: shared
        ? ''
        : forwarded
          ? row.forwardedName
          : row.originName,
      forwardedFrom: shared ? null : forwarded ? row.forwardedFrom : row.sender,
      forwardSourceId: 'dm' in source ? row.id : null,
      postShareId: row.postShareId,
    };
  });
  const gate: Gate =
    'dm' in source
      ? {
          sql: `AND (SELECT COUNT(*) FROM messages src,json_each(?) req WHERE src.id=req.value AND ${messagePair('src', 's.id', '?')} AND ${messageVisible('src', 's.id')})=?`,
          bindings: [json, source.dm.peer, source.dm.peer, list.length],
        }
      : {
          sql: `AND (SELECT COUNT(*) FROM chat_room_messages src,json_each(?) req WHERE src.id=req.value AND src.roomId=? AND ${groupMessageReadable('src', 's.id')})=?`,
          bindings: [json, source.room.roomId, list.length],
        };
  return { rows, gate };
}

const column = (name: string) => `json_extract(j.value,'$.${name}')`;
const copyColumns = `${column('id')},${column('text')},${column('searchText')},json(${column('media')})`;
const noModeratedMedia = `NOT EXISTS(SELECT 1 FROM json_each(${column('media')}) a JOIN moderated_uploads mu ON mu.uploadId=json_extract(a.value,'$.id'))`;

function directStatements(
  me: string,
  peer: string,
  rows: Row[],
  gate: Gate,
  now: number,
) {
  const json = JSON.stringify(rows),
    idList = JSON.stringify(rows.map((row) => row.id));
  return [
    db()
      .prepare(`INSERT INTO messages(id,text,searchText,media,sender,recipient,created,forwardedName,forwardedFrom,forwardSourceId,postShareId,read)
      SELECT ${copyColumns},s.id,r.id,?+CAST(j.key AS INTEGER),${column('forwardedName')},${column('forwardedFrom')},
        ${column('forwardSourceId')},${column('postShareId')},CASE WHEN s.id=r.id THEN 1 ELSE 0 END
      FROM json_each(?) j,users s,users r
      WHERE s.id=? AND r.id=? AND s.kind='person' AND r.kind='person' AND r.id<>'noctgram'
      AND ${visibleAccount('s')} AND ${visibleAccount('r')} AND ${messageWritable('s.id')} AND ${directMessageAllowed}
      AND ${noModeratedMedia} ${gate.sql}
      AND NOT EXISTS(SELECT 1 FROM messages WHERE id IN (SELECT value FROM json_each(?)))
      ON CONFLICT(id) DO NOTHING`)
      .bind(now, json, me, peer, ...gate.bindings, idList),
    db()
      .prepare(
        `INSERT OR IGNORE INTO notifications(id,userId,actorId,kind,targetId,created) SELECT 'message:'||id,recipient,sender,'message',id,created FROM messages WHERE id IN (SELECT value FROM json_each(?)) AND deletedAt=0 AND recipient<>sender`,
      )
      .bind(idList),
  ];
}
function roomStatement(
  me: string,
  roomId: string,
  rows: Row[],
  gate: Gate,
  now: number,
) {
  return db()
    .prepare(`INSERT INTO chat_room_messages(id,text,searchText,media,roomId,sender,ciphertext,replyTo,created,forwardedName,forwardedFrom,postShareId)
    SELECT ${copyColumns},r.id,s.id,NULL,NULL,
      MAX(?,COALESCE((SELECT MAX(previous.created)+1 FROM chat_room_messages previous WHERE previous.roomId=r.id),0))+CAST(j.key AS INTEGER),
      ${column('forwardedName')},${column('forwardedFrom')},${column('postShareId')}
    FROM json_each(?) j,chat_rooms r,users s
    WHERE r.id=? AND s.id=? AND r.kind='group' AND ${canSend('r', 's.id')}
    AND ${noModeratedMedia} ${gate.sql}
    AND NOT EXISTS(SELECT 1 FROM chat_room_messages WHERE id IN (SELECT value FROM json_each(?)))
    ON CONFLICT(id) DO NOTHING`)
    .bind(
      now,
      JSON.stringify(rows),
      roomId,
      me,
      ...gate.bindings,
      JSON.stringify(rows.map((row) => row.id)),
    );
}
// Earlier attempts with the same key count as success only for the same chat.
async function delivered(target: ForwardTarget, me: string, list: string[]) {
  const row =
    'dm' in target
      ? await db()
          .prepare(
            'SELECT COUNT(*) AS n,SUM(recipient=?) AS same FROM messages WHERE id IN (SELECT value FROM json_each(?)) AND sender=?',
          )
          .bind(target.dm.peer, JSON.stringify(list), me)
          .first<{ n: number; same: number | null }>()
      : await db()
          .prepare(
            'SELECT COUNT(*) AS n,SUM(roomId=?) AS same FROM chat_room_messages WHERE id IN (SELECT value FROM json_each(?)) AND sender=?',
          )
          .bind(target.room.roomId, JSON.stringify(list), me)
          .first<{ n: number; same: number | null }>();
  if (!row?.n) return false;
  if (row.n !== list.length || row.same !== list.length)
    throw new ApiError(409, 'Этот запрос уже использован для другой пересылки');
  return true;
}

// Forwards chat messages or a feed post to up to ten chats at once, including
// «Избранное» (a chat with yourself) and groups. The optional comment is sent
// first as an ordinary message. Each chat succeeds or fails on its own.
export async function forwardToChats(
  me: string,
  body: Record<string, unknown>,
) {
  await assertWritable(me);
  const { key } = body;
  if (typeof key !== 'string' || !KEY.test(key))
    throw new ApiError(400, 'Некорректный запрос пересылки');
  const source = parseForwardSource(body.source);
  const targets = parseForwardTargets(body.targets);
  const comment = body.comment ?? '';
  if (typeof comment !== 'string' || comment.length > FORWARD_COMMENT_LIMIT)
    throw new ApiError(400, 'Комментарий — до 4000 символов');
  const note = comment.trim();
  if (note) await assertPremiumEmoji(me, note);
  await rateLimit('forward', me, 20, 60);
  const { rows: items, gate } = await readSource(me, source);
  if (targets.some((target) => 'room' in target))
    await assertUnqueuedPublicWrite(
      me,
      [note, ...items.map((item) => item.text)].join('\n'),
    );
  const now = Date.now();
  const results: ForwardResult[] = [];
  let failure: ApiError | null = null;
  for (const [t, target] of targets.entries()) {
    const seeds = [
      ...(note ? ['c'] : []),
      ...items.map((_, i) => String(i)),
    ].map((suffix) => `forward:${me}:${key}-${t}:${suffix}`);
    const list =
      'dm' in target
        ? seeds
        : await Promise.all(seeds.map((seed) => forwardRoomMessageId(seed)));
    const rows: Row[] = [
      ...(note
        ? [
            {
              id: list[0],
              text: note,
              media: '[]',
              forwardedName: '',
              forwardedFrom: null,
              forwardSourceId: null,
              postShareId: null,
            },
          ]
        : []),
      ...items.map((item, i) => ({ ...item, id: list[i + (note ? 1 : 0)] })),
    ];
    for (const row of rows) row.searchText = normalizeSearch(row.text);
    try {
      if (await delivered(target, me, list)) {
        results.push({ target, ok: true, ids: list });
        continue;
      }
      const [inserted] = await db().batch(
        'dm' in target
          ? directStatements(me, target.dm.peer, rows, gate, now)
          : [roomStatement(me, target.room.roomId, rows, gate, now)],
      );
      if (
        inserted.meta.changes === rows.length ||
        (await delivered(target, me, list))
      )
        results.push({ target, ok: true, ids: list });
      else throw new ApiError(403, denied);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      failure = error;
      results.push({ target, ok: false, error: error.message });
    }
  }
  if (!results.some((result) => result.ok))
    throw results.length === 1 && failure ? failure : new ApiError(403, denied);
  return { results };
}
