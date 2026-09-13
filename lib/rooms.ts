import { assertPremiumEmoji } from './premium-emoji-access';
import { db } from './storage';
import { COMMUNITY_ROOM_ID } from './community-group';
import { ApiError } from './api-error';
import {
  validateSecretPublicKey,
  validateSecretEnvelope,
} from './secret-format';
import type {
  RoomDetail,
  RoomMember,
  RoomMessage,
  RoomPreview,
  RoomRole,
  RoomSummary,
} from './rooms-types';

const PAGE_SIZE = 100;
const LIMIT = 200;
const clockSql = "strftime('%s','now')*1000";
// Arguments to these predicates are internal SQL expressions, never user input.
const readable = (
  u: string,
) => `${u}.kind='person' AND ${u}.deletedAt=0 AND ${u}.onboardingComplete=1
  AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=${u}.id AND ar.mode='blocked' AND (ar.expiresAt IS NULL OR ar.expiresAt>${clockSql}))`;
const writable = (u: string) =>
  `${readable(u)} AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=${u}.id AND (ar.expiresAt IS NULL OR ar.expiresAt>${clockSql}))`;
const unblocked = (a: string, b: string) =>
  `NOT EXISTS(SELECT 1 FROM user_blocks ub WHERE (ub.blocker=${a} AND ub.blocked=${b}) OR (ub.blocker=${b} AND ub.blocked=${a}))`;
const accepts = (
  sender: string,
  recipient: string,
) => `${unblocked(sender, recipient)} AND
  (COALESCE((SELECT messagePolicy FROM user_privacy WHERE userId=${recipient}),'everyone')='everyone'
  OR ((SELECT messagePolicy FROM user_privacy WHERE userId=${recipient})='following' AND EXISTS(SELECT 1 FROM follows WHERE follower=${recipient} AND following=${sender})))`;
const visibleRoom = (
  r: string,
  actor: string,
) => `${r}.deletedAt=0 AND EXISTS(SELECT 1 FROM users owner WHERE owner.id=${r}.ownerId AND ${readable('owner')})
  AND EXISTS(SELECT 1 FROM users viewu WHERE viewu.id=${actor} AND ${readable('viewu')})
  AND ${unblocked(actor, `${r}.ownerId`)}
  AND (${r}.kind<>'secret' OR NOT EXISTS(SELECT 1 FROM chat_room_members sm JOIN users peer ON peer.id=sm.userId WHERE sm.roomId=${r}.id AND (sm.status<>'active' OR NOT (${readable('peer')}) OR NOT (${unblocked(actor, 'peer.id')}))))`;
const access = (
  r: string,
  actor: string,
  write = false,
  roles?: string[],
) => `${visibleRoom(r, actor)}
  AND EXISTS(SELECT 1 FROM chat_room_members accessm JOIN users accessu ON accessu.id=accessm.userId
  WHERE accessm.roomId=${r}.id AND accessm.userId=${actor} AND accessm.status='active'
  ${roles ? `AND accessm.role IN (${roles.map((role) => `'${role}'`).join(',')})` : ''}
  AND ${write ? writable('accessu') : readable('accessu')})`;
const canSend = (
  r: string,
  actor: string,
) => `${access(r, actor, true)} AND (${r}.kind='group' OR
  ((SELECT COUNT(*) FROM chat_room_members km WHERE km.roomId=${r}.id AND km.status='active' AND km.publicKey<>'')=2
  AND NOT EXISTS(SELECT 1 FROM chat_room_members pm WHERE pm.roomId=${r}.id AND pm.userId<>${actor} AND NOT (${accepts(actor, 'pm.userId')}))))`;
const memberCount = (r: string) =>
  `(SELECT COUNT(*) FROM chat_room_members countm WHERE countm.roomId=${r}.id AND countm.status='active')`;
// The shared community admits every registered person. Ordinary groups retain
// their existing cap, including for explicit joins and invitations.
const hasCapacity = (r: string) =>
  `(${r}.id='${COMMUNITY_ROOM_ID}' OR ${memberCount(r)}<${LIMIT})`;
const columns =
  'r.id,r.kind,r.ownerId,r.name,r.description,r.avatar,r.visibility,r.username,r.created,r.updatedAt';
// Secret room storage stays generic; each participant sees the other person's
// current profile in their own list/header, while kind still carries the lock.
const summaryColumns = (actor: string) => `r.id,r.kind,r.ownerId,
  CASE WHEN r.kind='secret' THEN COALESCE((SELECT peer.name FROM chat_room_members pm JOIN users peer ON peer.id=pm.userId WHERE pm.roomId=r.id AND pm.userId<>${actor} AND pm.status='active' LIMIT 1),'Секретный чат') ELSE r.name END AS name,
  r.description,
  CASE WHEN r.kind='secret' THEN COALESCE((SELECT peer.avatar FROM chat_room_members pm JOIN users peer ON peer.id=pm.userId WHERE pm.roomId=r.id AND pm.userId<>${actor} AND pm.status='active' LIMIT 1),'') ELSE r.avatar END AS avatar,
  r.visibility,r.username,r.created,r.updatedAt`;

async function keyedRoomId(actor: string, key: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(['room-create-v1', actor, key])),
    ),
  );
  return (
    'room:' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  );
}

// Access predicates reuse the viewer many times. Numbered parameters bind it
// once and keep the SQL/argument contract stable when a predicate grows.
function viewerQuery(sql: string, me: string) {
  const count = (sql.match(/\?/g) || []).length;
  let index = 0;
  const query = sql.replace(/\?|:viewer/g, (part) =>
    part === ':viewer' ? `?${count + 1}` : `?${++index}`,
  );
  return {
    bind: (...values: (string | number | null)[]) =>
      db()
        .prepare(query)
        .bind(...values, me),
  };
}

function string(value: unknown, max: number, required = true): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new ApiError(400, 'Проверьте введённые данные');
  return value.trim();
}
function id(value: unknown) {
  return string(value, 100);
}
function username(value: unknown) {
  const result = string(value, 25).replace(/^@/, '').toLowerCase();
  if (!/^[a-z][a-z0-9_]{3,23}$/.test(result))
    throw new ApiError(
      400,
      'Ник группы: 4–24 латинские буквы, цифры или _, начиная с буквы',
    );
  return result;
}
function uuid(value: unknown) {
  const result = string(value, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  )
    throw new ApiError(400, 'Некорректный ключ сообщения');
  return result;
}
function changed(result: { meta: { changes?: number } }) {
  if (!result.meta.changes)
    throw new ApiError(
      403,
      'Действие недоступно. Обновите чат и проверьте права',
    );
}
function conflict(error: unknown): never {
  if (
    error instanceof Error &&
    /UNIQUE constraint failed: chat_rooms.username/i.test(error.message)
  )
    throw new ApiError(409, 'Этот ник группы уже занят');
  throw error;
}
async function actorAllowed(me: string, write = false) {
  if (
    !(await db()
      .prepare(
        `SELECT 1 FROM users u WHERE u.id=? AND ${write ? writable('u') : readable('u')}`,
      )
      .bind(me)
      .first())
  )
    throw new ApiError(
      403,
      write ? 'Для аккаунта недоступна запись' : 'Аккаунт недоступен',
    );
}
function preview(row: RoomPreview & { joined: number | boolean }): RoomPreview {
  return {
    ...row,
    joined: !!row.joined,
    label: row.kind === 'group' ? 'Группа' : 'Секретный чат',
  };
}
async function roomRow(me: string, roomId: string): Promise<RoomSummary> {
  const row = await db()
    .prepare(`SELECT ${summaryColumns('m.userId')},m.role,m.archivedAt,${memberCount('r')} AS memberCount,
    (SELECT COUNT(*) FROM chat_room_messages unreadm WHERE unreadm.roomId=r.id AND unreadm.sender<>m.userId AND (unreadm.created>m.lastReadAt OR (unreadm.created=m.lastReadAt AND unreadm.id>m.lastReadId)) AND unreadm.deletedAt=0) AS unread
    FROM chat_rooms r JOIN chat_room_members m ON m.roomId=r.id AND m.userId=? WHERE r.id=? AND ${access('r', 'm.userId')}`)
    .bind(me, roomId)
    .first<RoomSummary>();
  if (!row) throw new ApiError(404, 'Чат недоступен');
  return {
    ...row,
    label: row.kind === 'group' ? 'Группа' : 'Секретный чат',
    lastMessage: null,
  };
}
export async function listRooms(
  me: string,
  archived = false,
): Promise<{ rooms: RoomSummary[] }> {
  await actorAllowed(me);
  const result = await db()
    .prepare(`SELECT ${summaryColumns('m.userId')},m.role,m.archivedAt,${memberCount('r')} AS memberCount,
    (SELECT COUNT(*) FROM chat_room_messages unreadm WHERE unreadm.roomId=r.id AND unreadm.sender<>m.userId AND (unreadm.created>m.lastReadAt OR (unreadm.created=m.lastReadAt AND unreadm.id>m.lastReadId)) AND unreadm.deletedAt=0) AS unread,
    (SELECT json_object('id',lastm.id,'text',CASE WHEN r.kind='secret' THEN '' ELSE lastm.text END,'created',lastm.created,'sender',lastm.sender)
    FROM chat_room_messages lastm WHERE lastm.roomId=r.id AND lastm.deletedAt=0 ORDER BY lastm.created DESC,lastm.id DESC LIMIT 1) AS lastMessage
    FROM chat_rooms r JOIN chat_room_members m ON m.roomId=r.id WHERE m.userId=? AND (m.archivedAt>0)=? AND ${access('r', 'm.userId')}
    ORDER BY MAX(r.updatedAt,COALESCE((SELECT MAX(created) FROM chat_room_messages latest WHERE latest.roomId=r.id),0)) DESC,r.id LIMIT 100`)
    .bind(me, archived ? 1 : 0)
    .all<Omit<RoomSummary, 'lastMessage'> & { lastMessage: string | null }>();
  return {
    rooms: result.results.map((r) => ({
      ...r,
      label: r.kind === 'group' ? 'Группа' : 'Секретный чат',
      lastMessage: r.lastMessage ? JSON.parse(r.lastMessage) : null,
    })),
  };
}
export async function searchRooms(
  me: string,
  query: string,
): Promise<{ rooms: RoomPreview[] }> {
  await actorAllowed(me);
  const q = string(query, 100, false).replace(/^@/, '');
  if (!q) return { rooms: [] };
  const term = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  const rows = await viewerQuery(
    `SELECT ${columns},${memberCount('r')} AS memberCount,
    EXISTS(SELECT 1 FROM chat_room_members jm WHERE jm.roomId=r.id AND jm.userId=? AND jm.status='active') AS joined
    FROM chat_rooms r WHERE r.kind='group' AND r.visibility='public' AND ${visibleRoom('r', ':viewer')}
    AND NOT EXISTS(SELECT 1 FROM chat_room_members bm WHERE bm.roomId=r.id AND bm.userId=? AND bm.status='banned')
    AND (r.username LIKE ? ESCAPE '\\' OR r.name LIKE ? ESCAPE '\\') ORDER BY r.username LIMIT 30`,
    me,
  )
    .bind(me, me, term, term)
    .all<RoomPreview & { joined: number }>();
  return { rooms: rows.results.map(preview) };
}
export async function resolveGroup(
  me: string,
  handle: string,
): Promise<{ room: RoomPreview }> {
  await actorAllowed(me);
  const row = await viewerQuery(
    `SELECT ${columns},${memberCount('r')} AS memberCount,
    EXISTS(SELECT 1 FROM chat_room_members jm WHERE jm.roomId=r.id AND jm.userId=? AND jm.status='active') AS joined
    FROM chat_rooms r WHERE r.kind='group' AND r.visibility='public' AND r.username=? AND ${visibleRoom('r', ':viewer')}
    AND NOT EXISTS(SELECT 1 FROM chat_room_members bm WHERE bm.roomId=r.id AND bm.userId=? AND bm.status='banned')`,
    me,
  )
    .bind(me, username(handle), me)
    .first<RoomPreview & { joined: number }>();
  if (!row) throw new ApiError(404, 'Группа не найдена');
  return { room: preview(row) };
}
async function tokenHash(value: unknown) {
  const token = string(value, 64);
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new ApiError(404, 'Приглашение недействительно');
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function resolveRoomInvite(
  me: string,
  token: string,
): Promise<{ room: RoomPreview }> {
  await actorAllowed(me);
  const hash = await tokenHash(token);
  const row = await viewerQuery(
    `SELECT ${columns},${memberCount('r')} AS memberCount,
    EXISTS(SELECT 1 FROM chat_room_members jm WHERE jm.roomId=r.id AND jm.userId=? AND jm.status='active') AS joined
    FROM chat_rooms r JOIN chat_room_invites i ON i.roomId=r.id WHERE i.tokenHash=? AND r.kind='group' AND r.visibility='private' AND ${visibleRoom('r', ':viewer')}
    AND NOT EXISTS(SELECT 1 FROM chat_room_members bm WHERE bm.roomId=r.id AND bm.userId=? AND bm.status='banned')`,
    me,
  )
    .bind(me, hash, me)
    .first<RoomPreview & { joined: number }>();
  if (!row) throw new ApiError(404, 'Приглашение отозвано или недоступно');
  return { room: preview(row) };
}
export async function readRoom(
  me: string,
  roomId: string,
  before?: string | null,
): Promise<RoomDetail> {
  const row = await roomRow(me, id(roomId));
  let cursor: { created: number; id: string } | null = null;
  if (before) {
    try {
      const value = JSON.parse(atob(string(before, 500)));
      if (
        !Number.isSafeInteger(value.created) ||
        value.created < 0 ||
        typeof value.id !== 'string' ||
        value.id.length > 100
      )
        throw new Error();
      cursor = { created: value.created, id: value.id };
    } catch {
      throw new ApiError(400, 'Некорректная страница истории');
    }
  }
  const members = await viewerQuery(
    `SELECT m.userId,u.name,u.avatar,COALESCE((SELECT h.handle FROM handles h WHERE h.userId=u.id AND h.main=1),'') AS handle,
    m.role,m.status,m.publicKey,m.joinedAt FROM chat_room_members m JOIN users u ON u.id=m.userId JOIN chat_rooms r ON r.id=m.roomId
    WHERE m.roomId=? AND m.status='active' AND ${access('r', ':viewer')}
    ORDER BY CASE WHEN m.userId=:viewer THEN 0 WHEN m.role='owner' THEN 1 WHEN m.role='admin' THEN 2 ELSE 3 END,m.joinedAt,m.userId LIMIT ${LIMIT}`,
    me,
  )
    .bind(roomId)
    .all<Omit<RoomMember, 'publicKey'> & { publicKey: string }>();
  const messages = await viewerQuery(
    `SELECT msg.id,msg.roomId,msg.sender,u.name AS senderName,u.avatar AS senderAvatar,msg.text,msg.ciphertext,msg.replyTo,msg.created,msg.deletedAt,msg.giveawayId
    FROM chat_room_messages msg JOIN users u ON u.id=msg.sender JOIN chat_rooms r ON r.id=msg.roomId
    WHERE msg.roomId=? AND ${access('r', ':viewer')} ${cursor ? 'AND (msg.created<? OR (msg.created=? AND msg.id<?))' : ''}
    ORDER BY msg.created DESC,msg.id DESC LIMIT ${PAGE_SIZE + 1}`,
    me,
  )
    .bind(
      roomId,
      ...(cursor ? [cursor.created, cursor.created, cursor.id] : []),
    )
    .all<RoomMessage>();
  const permission = await viewerQuery(
    `SELECT 1 FROM chat_rooms r WHERE r.id=? AND ${canSend('r', ':viewer')}`,
    me,
  )
    .bind(roomId)
    .first();
  const page = messages.results.slice(0, PAGE_SIZE);
  const oldest = page.at(-1);
  return {
    ...row,
    me,
    members: members.results.map((m) => ({
      ...m,
      publicKey: m.publicKey ? JSON.parse(m.publicKey) : null,
    })),
    messages: page.reverse(),
    canSend: !!permission,
    nextCursor:
      messages.results.length > PAGE_SIZE && oldest
        ? btoa(JSON.stringify({ created: oldest.created, id: oldest.id }))
        : null,
  };
}

async function avatarValue(me: string, input: unknown) {
  const avatar = string(input ?? '', 200, false);
  if (!avatar) return '';
  if (!/^\/api\/media\/[a-zA-Z0-9_-]+$/.test(avatar))
    throw new ApiError(400, 'Выберите загруженное изображение');
  const uploadId = avatar.slice('/api/media/'.length);
  if (
    !(await db()
      .prepare(`SELECT 1 FROM uploads u WHERE u.id=? AND u.userId=? AND u.type IN ('image/jpeg','image/png','image/webp','image/gif') AND u.state='ready'
    AND NOT EXISTS(SELECT 1 FROM chat_uploads c WHERE c.uploadId=u.id) AND NOT EXISTS(SELECT 1 FROM moderated_uploads m WHERE m.uploadId=u.id)`)
      .bind(uploadId, me)
      .first())
  )
    throw new ApiError(400, 'Изображение недоступно');
  return avatar;
}
const avatarGuard = `(?='' OR EXISTS(SELECT 1 FROM uploads av WHERE '/api/media/'||av.id=? AND av.userId=? AND av.state='ready' AND av.type IN ('image/jpeg','image/png','image/webp','image/gif') AND NOT EXISTS(SELECT 1 FROM chat_uploads ca WHERE ca.uploadId=av.id) AND NOT EXISTS(SELECT 1 FROM moderated_uploads ma WHERE ma.uploadId=av.id)))`;

export async function changeRoom(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
): Promise<
  | RoomDetail
  | { id: string }
  | { ok: true }
  | { token: string; inviteUrl: string }
> {
  const action = string(body.action, 30);
  await actorAllowed(
    me,
    action !== 'read' && action !== 'leave' && action !== 'archive',
  );
  if (action === 'create') {
    const kind = body.kind ?? 'group';
    if (kind !== 'group' && kind !== 'secret')
      throw new ApiError(400, 'Неизвестный тип чата');
    const secret = kind === 'secret';
    if (secret && body.publicKey !== undefined)
      throw new ApiError(
        400,
        'Открытый ключ регистрируется после создания чата',
      );
    if (
      secret &&
      (body.username ||
        body.visibility === 'public' ||
        body.description ||
        body.avatar ||
        body.memberIds)
    )
      throw new ApiError(400, 'Секретный чат доступен только двум участникам');
    const name = secret ? 'Секретный чат' : string(body.name, 100);
    const description = secret
      ? ''
      : string(body.description ?? '', 500, false);
    const avatar = secret ? '' : await avatarValue(me, body.avatar);
    const visibility = body.visibility ?? 'private';
    if (visibility !== 'private' && visibility !== 'public')
      throw new ApiError(400, 'Проверьте видимость группы');
    const handle = visibility === 'public' ? username(body.username) : null;
    const rawMembers = secret ? [id(body.peerId)] : (body.memberIds ?? []);
    if (!Array.isArray(rawMembers) || rawMembers.length > LIMIT - 1)
      throw new ApiError(400, 'В группе может быть до 200 участников');
    const memberIds = [...new Set(rawMembers.map(id))];
    if (memberIds.includes(me)) throw new ApiError(400, 'Вы уже участник чата');
    const membersJson = JSON.stringify(memberIds);
    const createKey =
      body.key === undefined ? null : uuid(body.key).toLowerCase();
    const roomId = createKey
      ? await keyedRoomId(me, createKey)
      : crypto.randomUUID();
    const expected = {
      kind,
      ownerId: me,
      name,
      description,
      avatar,
      visibility,
      username: handle,
    };
    const expectedMembers = JSON.stringify([me, ...memberIds].sort());
    // Reusing a key never rewrites the first room or restores its membership.
    // A changed payload/current configuration, closed room, or transferred
    // owner yields 409; the caller must open a fresh creation attempt/key.
    const existingCreation = async (): Promise<RoomDetail | null> => {
      const saved = await db()
        .prepare('SELECT * FROM chat_rooms WHERE id=?')
        .bind(roomId)
        .first<Record<string, unknown>>();
      if (!saved) return null;
      if (
        saved.deletedAt ||
        Object.entries(expected).some(
          ([field, value]) => saved[field] !== value,
        )
      )
        throw new ApiError(
          409,
          'Этот запрос уже создал другой или изменённый чат. Откройте создание заново.',
        );
      const members = await db()
        .prepare(
          "SELECT userId FROM chat_room_members WHERE roomId=? AND status='active' ORDER BY userId",
        )
        .bind(roomId)
        .all<{ userId: string }>();
      if (
        JSON.stringify(
          members.results.map((member) => member.userId).sort(),
        ) !== expectedMembers
      )
        throw new ApiError(
          409,
          'Состав созданного чата уже изменился. Откройте создание заново.',
        );
      return readRoom(me, roomId);
    };
    if (createKey) {
      const saved = await existingCreation();
      if (saved) return saved;
    }
    // Initial member checks are part of the room INSERT: no partial creation if
    // a target changes privacy, is blocked, or disappears while creating.
    try {
      // The first INSERT deliberately fails on an existing room ID. Its atomic
      // batch must stop before either member INSERT, including conflicting
      // simultaneous retries; ON CONFLICT DO NOTHING here could inject members.
      const result = await db().batch([
        db()
          .prepare(`INSERT INTO chat_rooms(id,kind,ownerId,name,description,avatar,visibility,username,created,updatedAt)
          SELECT ?,?,u.id,?,?,?,?,?,?,? FROM users u WHERE u.id=? AND ${writable('u')} AND ${avatarGuard}
          AND (SELECT COUNT(*) FROM chat_rooms owned WHERE owned.ownerId=u.id AND owned.deletedAt=0)<100
          AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM users peer WHERE peer.id=j.value AND peer.id<>u.id AND ${readable('peer')} AND ${accepts('u.id', 'peer.id')}))`)
          .bind(
            roomId,
            kind,
            name,
            description,
            avatar,
            visibility,
            handle,
            now,
            now,
            me,
            avatar,
            avatar,
            me,
            membersJson,
          ),
        db()
          .prepare(`INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt,lastReadAt)
          SELECT id,ownerId,'owner','active',created,created FROM chat_rooms WHERE id=?`)
          .bind(roomId),
        db()
          .prepare(`INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt,lastReadAt)
          SELECT r.id,j.value,'member','active',r.created,r.created FROM chat_rooms r,json_each(?) j WHERE r.id=?`)
          .bind(membersJson, roomId),
      ]);
      changed(result[0]);
    } catch (error) {
      if (
        createKey &&
        error instanceof Error &&
        /UNIQUE constraint failed:/i.test(error.message)
      ) {
        const saved = await existingCreation();
        if (saved) return saved;
      }
      conflict(error);
    }
    return readRoom(me, roomId);
  }
  if (action === 'join') {
    const hash = body.token === undefined ? null : await tokenHash(body.token);
    const handle = body.username === undefined ? null : username(body.username);
    const roomId = body.id === undefined ? null : id(body.id);
    if (!hash && !handle && !roomId) throw new ApiError(400, 'Выберите группу');
    const gate = hash
      ? "r.visibility='private' AND EXISTS(SELECT 1 FROM chat_room_invites i WHERE i.roomId=r.id AND i.tokenHash=?)"
      : handle
        ? "r.visibility='public' AND r.username=?"
        : "r.visibility='public' AND r.id=?";
    const target = hash ?? handle ?? roomId;
    const result = await db()
      .prepare(`INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt,lastReadAt)
      SELECT r.id,u.id,'member','active',?,? FROM chat_rooms r,users u WHERE u.id=? AND ${writable('u')} AND r.kind='group' AND ${visibleRoom('r', 'u.id')}
      AND ${gate} AND (${hasCapacity('r')} OR EXISTS(SELECT 1 FROM chat_room_members existing WHERE existing.roomId=r.id AND existing.userId=u.id AND existing.status='active'))
      AND NOT EXISTS(SELECT 1 FROM chat_room_members old WHERE old.roomId=r.id AND old.userId=u.id AND old.status='banned')
      ON CONFLICT(roomId,userId) DO UPDATE SET status='active',role=CASE WHEN chat_room_members.status='active' THEN chat_room_members.role ELSE 'member' END,
      joinedAt=CASE WHEN chat_room_members.status='active' THEN chat_room_members.joinedAt ELSE excluded.joinedAt END,
      lastReadAt=CASE WHEN chat_room_members.status='active' THEN chat_room_members.lastReadAt ELSE excluded.lastReadAt END
      WHERE chat_room_members.status<>'banned' RETURNING roomId`)
      .bind(now, now, me, target)
      .first<{ roomId: string }>();
    if (!result)
      throw new ApiError(
        403,
        'Не удалось вступить: приглашение отозвано, нет доступа или группа заполнена',
      );
    return readRoom(me, result.roomId);
  }
  const roomId = id(body.id);
  const row = await roomRow(me, roomId);
  if (action === 'archive') {
    if (typeof body.archived !== 'boolean')
      throw new ApiError(400, 'Некорректный запрос');
    const changed = await db()
      .prepare(
        `UPDATE chat_room_members SET archivedAt=? WHERE roomId=? AND userId=? AND EXISTS(SELECT 1 FROM chat_rooms r WHERE r.id=chat_room_members.roomId AND ${access('r', 'chat_room_members.userId')})`,
      )
      .bind(body.archived ? Date.now() : 0, roomId, me)
      .run();
    if (!changed.meta.changes) throw new ApiError(404, 'Чат недоступен');
    return { ok: true };
  }
  if (action === 'read') {
    if (body.through === undefined) return { ok: true };
    const through = id(body.through);
    await db()
      .prepare(`UPDATE chat_room_members SET lastReadAt=(SELECT created FROM chat_room_messages WHERE id=? AND roomId=chat_room_members.roomId),lastReadId=?
      WHERE roomId=? AND userId=? AND EXISTS(SELECT 1 FROM chat_rooms r WHERE r.id=chat_room_members.roomId AND ${access('r', 'chat_room_members.userId')})
      AND EXISTS(SELECT 1 FROM chat_room_messages seen WHERE seen.id=? AND seen.roomId=chat_room_members.roomId AND (seen.created>lastReadAt OR (seen.created=lastReadAt AND seen.id>lastReadId)))`)
      .bind(through, through, roomId, me, through)
      .run();
    return { ok: true };
  }
  if (action === 'acceptSecret') {
    if (row.kind !== 'secret') throw new ApiError(400, 'Это обычная группа');
    let publicKey;
    try {
      publicKey = await validateSecretPublicKey(body.publicKey);
    } catch {
      throw new ApiError(400, 'Некорректный открытый ключ');
    }
    const encoded = JSON.stringify(publicKey);
    const result = await db()
      .prepare(`UPDATE chat_room_members SET publicKey=? WHERE roomId=? AND userId=? AND (publicKey='' OR publicKey=?)
      AND NOT EXISTS(SELECT 1 FROM chat_room_members other WHERE other.roomId=chat_room_members.roomId AND other.userId<>chat_room_members.userId AND other.publicKey=?)
      AND EXISTS(SELECT 1 FROM chat_rooms r WHERE r.id=chat_room_members.roomId AND r.kind='secret' AND ${access('r', 'chat_room_members.userId', true)})`)
      .bind(encoded, roomId, me, encoded, encoded)
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        409,
        'Ключ этого устройства уже закреплён или доступ изменился. Создайте новый секретный чат',
      );
    return readRoom(me, roomId);
  }
  if (action === 'send') {
    const key = uuid(body.key ?? body.messageId);
    let text = '',
      ciphertext: string | null = null,
      replyTo: string | null = null;
    if (row.kind === 'secret') {
      if (
        'text' in body ||
        'media' in body ||
        'attachments' in body ||
        'replyTo' in body
      )
        throw new ApiError(
          400,
          'Секретные сообщения принимаются только в зашифрованном виде',
        );
      const detail = await readRoom(me, roomId);
      try {
        ciphertext = await validateSecretEnvelope(body.ciphertext, {
          roomId,
          messageId: key,
          senderId: me,
          members: detail.members,
        });
      } catch {
        throw new ApiError(
          400,
          'Некорректное зашифрованное сообщение или ключи участников',
        );
      }
    } else {
      if ('ciphertext' in body || 'media' in body || 'attachments' in body)
        throw new ApiError(400, 'В группе поддерживаются текстовые сообщения');
      text = string(body.text, 4000);
      await assertPremiumEmoji(me, text);
      replyTo = body.replyTo == null ? null : id(body.replyTo);
    }
    const result = await db()
      .prepare(`INSERT INTO chat_room_messages(id,roomId,sender,text,ciphertext,replyTo,created)
      SELECT ?,r.id,u.id,?,?,?,MAX(?,COALESCE((SELECT MAX(previous.created)+1 FROM chat_room_messages previous WHERE previous.roomId=r.id),0))
      FROM chat_rooms r,users u WHERE r.id=? AND u.id=? AND ${canSend('r', 'u.id')}
      AND r.kind=? AND (? IS NULL OR EXISTS(SELECT 1 FROM chat_room_messages rp WHERE rp.id=? AND rp.roomId=r.id AND rp.deletedAt=0))
      ON CONFLICT(id) DO NOTHING`)
      .bind(
        key,
        text,
        ciphertext,
        replyTo,
        now,
        roomId,
        me,
        row.kind,
        replyTo,
        replyTo,
      )
      .run();
    if (!result.meta.changes) {
      const saved = await db()
        .prepare(
          `SELECT msg.* FROM chat_room_messages msg JOIN chat_rooms r ON r.id=msg.roomId WHERE msg.id=? AND msg.sender=? AND ${canSend('r', 'msg.sender')}`,
        )
        .bind(key, me)
        .first<RoomMessage>();
      if (
        !saved ||
        saved.roomId !== roomId ||
        saved.text !== text ||
        saved.ciphertext !== ciphertext ||
        saved.replyTo !== replyTo ||
        saved.deletedAt
      )
        throw new ApiError(
          saved ? 409 : 403,
          saved
            ? 'Этот ключ уже использован для другого сообщения'
            : 'Отправка недоступна. Проверьте участников и настройки приватности',
        );
    }
    return { id: key };
  }
  if (action === 'deleteMessage') {
    const messageId = id(body.messageId);
    const result = await db()
      .prepare(`UPDATE chat_room_messages SET text='',ciphertext=NULL,deletedAt=? WHERE id=? AND roomId=?
      AND EXISTS(SELECT 1 FROM chat_rooms r JOIN chat_room_members a ON a.roomId=r.id AND a.userId=? WHERE r.id=chat_room_messages.roomId
      AND ${access('r', 'a.userId', true)} AND (chat_room_messages.sender=a.userId OR (r.kind='group' AND a.role IN ('owner','admin'))))`)
      .bind(now, messageId, roomId, me)
      .run();
    changed(result);
    return { ok: true };
  }
  if (action === 'leave') {
    if (
      row.kind === 'secret' ||
      (row.role === 'owner' && row.memberCount === 1)
    ) {
      const result = await viewerQuery(
        `UPDATE chat_rooms SET deletedAt=?,updatedAt=?,username=NULL,visibility='private' WHERE id=? AND ${access('chat_rooms', ':viewer')}
        AND (kind='secret' OR (ownerId=? AND ${memberCount('chat_rooms')}=1))`,
        me,
      )
        .bind(now, now, roomId, me)
        .run();
      changed(result);
    } else {
      if (row.role === 'owner')
        throw new ApiError(
          409,
          'Перед выходом передайте владение другому участнику',
        );
      const result = await db()
        .prepare(`UPDATE chat_room_members SET status='left',role='member' WHERE roomId=? AND userId=? AND role<>'owner'
        AND EXISTS(SELECT 1 FROM chat_rooms r WHERE r.id=chat_room_members.roomId AND r.kind='group' AND ${access('r', 'chat_room_members.userId')})`)
        .bind(roomId, me)
        .run();
      changed(result);
    }
    return { ok: true };
  }
  if (row.kind !== 'group')
    throw new ApiError(400, 'Состав и настройки секретного чата неизменны');
  if (!['owner', 'admin'].includes(row.role))
    throw new ApiError(403, 'Нужны права администратора группы');
  if (action === 'invite') {
    if (row.visibility !== 'private')
      throw new ApiError(400, 'У публичной группы есть ссылка с её ником');
    if (body.revoke !== undefined && typeof body.revoke !== 'boolean')
      throw new ApiError(400, 'Проверьте приглашение');
    if (body.revoke) {
      await viewerQuery(
        `DELETE FROM chat_room_invites WHERE roomId=? AND EXISTS(SELECT 1 FROM chat_rooms r WHERE r.id=chat_room_invites.roomId AND ${access('r', ':viewer', true, ['owner', 'admin'])})`,
        me,
      )
        .bind(roomId)
        .run();
      return { ok: true };
    }
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('');
    const hash = await tokenHash(token);
    const result = await viewerQuery(
      `INSERT INTO chat_room_invites(roomId,tokenHash,createdBy,created) SELECT r.id,?,?,? FROM chat_rooms r
      WHERE r.id=? AND r.kind='group' AND r.visibility='private' AND ${access('r', ':viewer', true, ['owner', 'admin'])}
      ON CONFLICT(roomId) DO UPDATE SET tokenHash=excluded.tokenHash,createdBy=excluded.createdBy,created=excluded.created`,
      me,
    )
      .bind(hash, me, now, roomId)
      .run();
    changed(result);
    return { token, inviteUrl: '/?invite=' + token };
  }
  if (action === 'update') {
    const name = body.name === undefined ? row.name : string(body.name, 100);
    const description =
      body.description === undefined
        ? row.description
        : string(body.description, 500, false);
    const avatar =
      body.avatar === undefined
        ? row.avatar
        : await avatarValue(me, body.avatar);
    const visibility = body.visibility ?? row.visibility;
    if (visibility !== 'public' && visibility !== 'private')
      throw new ApiError(400, 'Проверьте видимость группы');
    const handle =
      visibility === 'public' ? username(body.username ?? row.username) : null;
    try {
      const results = await db().batch([
        viewerQuery(
          `UPDATE chat_rooms SET name=?,description=?,avatar=?,visibility=?,username=?,updatedAt=? WHERE id=?
          AND ${access('chat_rooms', ':viewer', true, ['owner', 'admin'])} ${body.avatar === undefined ? '' : `AND ${avatarGuard}`}`,
          me,
        ).bind(
          name,
          description,
          avatar,
          visibility,
          handle,
          now,
          roomId,
          ...(body.avatar === undefined ? [] : [avatar, avatar, me]),
        ),
        viewerQuery(
          `DELETE FROM chat_room_invites WHERE roomId=? AND EXISTS(SELECT 1 FROM chat_rooms r WHERE r.id=chat_room_invites.roomId AND r.visibility<>? AND ${access('r', ':viewer', true, ['owner', 'admin'])})`,
          me,
        ).bind(roomId, row.visibility),
      ]);
      changed(results[0]);
    } catch (error) {
      conflict(error);
    }
  } else if (action === 'addMember') {
    const target = id(body.userId);
    const result = await db()
      .prepare(`INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt,lastReadAt)
      SELECT r.id,target.id,'member','active',?,? FROM chat_rooms r,users target,users actor WHERE r.id=? AND actor.id=? AND target.id=?
      AND ${access('r', 'actor.id', true, ['owner', 'admin'])} AND ${readable('target')} AND ${accepts('actor.id', 'target.id')}
      AND ${unblocked('target.id', 'r.ownerId')} AND (${hasCapacity('r')} OR EXISTS(SELECT 1 FROM chat_room_members existing WHERE existing.roomId=r.id AND existing.userId=target.id AND existing.status='active')) AND target.id<>r.ownerId
      AND NOT EXISTS(SELECT 1 FROM chat_room_members old WHERE old.roomId=r.id AND old.userId=target.id AND old.status='banned')
      ON CONFLICT(roomId,userId) DO UPDATE SET status='active',role=CASE WHEN chat_room_members.status='active' THEN chat_room_members.role ELSE 'member' END,
      joinedAt=CASE WHEN chat_room_members.status='active' THEN chat_room_members.joinedAt ELSE excluded.joinedAt END
      WHERE chat_room_members.status<>'banned'`)
      .bind(now, now, roomId, me, target)
      .run();
    changed(result);
  } else if (action === 'removeMember') {
    const target = id(body.userId);
    const result = await db()
      .prepare(`UPDATE chat_room_members SET status='banned',role='member' WHERE roomId=? AND userId=? AND userId<>? AND role<>'owner'
      AND EXISTS(SELECT 1 FROM chat_rooms r JOIN chat_room_members actor ON actor.roomId=r.id AND actor.userId=? WHERE r.id=chat_room_members.roomId
      AND ${access('r', 'actor.userId', true, ['owner', 'admin'])} AND (actor.role='owner' OR chat_room_members.role='member'))`)
      .bind(roomId, target, me, me)
      .run();
    changed(result);
  } else if (action === 'role') {
    if (row.role !== 'owner')
      throw new ApiError(403, 'Роли назначает владелец группы');
    const target = id(body.userId);
    const role = body.role as RoomRole;
    if (!['owner', 'admin', 'member'].includes(role) || target === me)
      throw new ApiError(400, 'Выберите роль другого участника');
    if (role === 'owner') {
      const results = await db().batch([
        db()
          .prepare(`UPDATE chat_rooms SET ownerId=?,updatedAt=? WHERE id=? AND ownerId=? AND ${access('chat_rooms', 'chat_rooms.ownerId', true, ['owner'])}
          AND EXISTS(SELECT 1 FROM chat_room_members next JOIN users u ON u.id=next.userId WHERE next.roomId=chat_rooms.id AND next.userId=? AND next.status='active' AND ${writable('u')})`)
          .bind(target, now, roomId, me, target),
        db()
          .prepare(
            `UPDATE chat_room_members SET role='admin' WHERE roomId=? AND userId=? AND role='owner' AND EXISTS(SELECT 1 FROM chat_rooms r WHERE r.id=chat_room_members.roomId AND r.ownerId=?)`,
          )
          .bind(roomId, me, target),
        db()
          .prepare(
            `UPDATE chat_room_members SET role='owner' WHERE roomId=? AND userId=? AND status='active' AND EXISTS(SELECT 1 FROM chat_rooms r WHERE r.id=chat_room_members.roomId AND r.ownerId=?)`,
          )
          .bind(roomId, target, target),
      ]);
      changed(results[0]);
    } else {
      const result = await db()
        .prepare(`UPDATE chat_room_members SET role=? WHERE roomId=? AND userId=? AND role<>'owner' AND status='active'
        AND EXISTS(SELECT 1 FROM chat_rooms r WHERE r.id=chat_room_members.roomId AND r.ownerId=? AND ${access('r', 'r.ownerId', true, ['owner'])})`)
        .bind(role, roomId, target, me)
        .run();
      changed(result);
    }
  } else throw new ApiError(400, 'Неизвестное действие');
  return readRoom(me, roomId);
}

// Export only ordinary group data that the requester can currently read. Each
// streamed page repeats membership/account checks; secret rooms, keys and
// ciphertext are deliberately absent from the server-side account archive.
export function groupRoomExportSections(
  me: string,
): import('./account-export').ExportSection[] {
  const queries = [
    [
      'groups',
      `SELECT ${columns},m.role FROM chat_rooms r JOIN chat_room_members m ON m.roomId=r.id
      WHERE m.userId=? AND r.kind='group' AND ${access('r', 'm.userId')} AND r.id>? ORDER BY r.id LIMIT 100`,
    ],
    [
      'groupMessages',
      `SELECT msg.id,msg.roomId,msg.sender,msg.text,msg.replyTo,msg.created FROM chat_room_messages msg
      JOIN chat_rooms r ON r.id=msg.roomId JOIN chat_room_members m ON m.roomId=r.id
      WHERE m.userId=? AND r.kind='group' AND msg.ciphertext IS NULL AND msg.deletedAt=0
      AND ${access('r', 'm.userId')} AND msg.id>? ORDER BY msg.id LIMIT 100`,
    ],
  ] as const;
  return queries.map(([name, sql]) => ({
    name,
    async page(after) {
      const { results } = await db()
        .prepare(sql)
        .bind(me, after)
        .all<Record<string, unknown>>();
      return {
        rows: results,
        next:
          results.length === 100
            ? String(results[results.length - 1].id)
            : null,
      };
    },
  }));
}
