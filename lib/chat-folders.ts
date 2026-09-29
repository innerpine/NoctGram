import { db } from './storage';
import { ApiError } from './api-error';
import { assertReadable } from './account-access';
import { premiumActive } from './premium-access';
import {
  FOLDER_LIMIT,
  FOLDER_PEER_LIMIT,
  FOLDER_PEER_PREMIUM_LIMIT,
  FOLDER_PREMIUM_LIMIT,
  FOLDER_TITLE_LIMIT,
  type ChatFolder,
} from './chat-folders-filter';

type Row = Omit<
  ChatFolder,
  | 'includePersonal'
  | 'includeGroups'
  | 'includeSecret'
  | 'excludeRead'
  | 'excludeArchived'
  | 'includePeers'
  | 'excludePeers'
> & {
  includePersonal: number;
  includeGroups: number;
  includeSecret: number;
  excludeRead: number;
  excludeArchived: number;
  includePeers: string;
  excludePeers: string;
};
const view = (row: Row): ChatFolder => ({
  ...row,
  includePersonal: !!row.includePersonal,
  includeGroups: !!row.includeGroups,
  includeSecret: !!row.includeSecret,
  excludeRead: !!row.excludeRead,
  excludeArchived: !!row.excludeArchived,
  includePeers: JSON.parse(row.includePeers),
  excludePeers: JSON.parse(row.excludePeers),
});
async function premium(me: string) {
  const row = await db()
    .prepare(
      `SELECT ${premiumActive('u.id')} AS premium FROM users u WHERE u.id=?`,
    )
    .bind(me)
    .first<{ premium: number }>();
  return !!row?.premium;
}
export async function listFolders(me: string) {
  const rows = await db()
    .prepare(
      `SELECT id,title,emoji,position,includePersonal,includeGroups,includeSecret,excludeRead,excludeArchived,includePeers,excludePeers
      FROM chat_folders WHERE userId=? ORDER BY position,created,id`,
    )
    .bind(me)
    .all<Row>();
  return {
    folders: rows.results.map(view),
    limit: (await premium(me)) ? FOLDER_PREMIUM_LIMIT : FOLDER_LIMIT,
  };
}
function flag(value: unknown) {
  if (value === undefined) return 0;
  if (typeof value !== 'boolean')
    throw new ApiError(400, 'Проверьте настройки папки');
  return value ? 1 : 0;
}
function peers(value: unknown, limit: number) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (peer) =>
        typeof peer !== 'string' ||
        peer.length > 110 ||
        !/^(person|room):[^\s]+$/.test(peer),
    )
  )
    throw new ApiError(400, 'Проверьте список чатов папки');
  const unique = [...new Set(value as string[])];
  if (unique.length > limit)
    throw new ApiError(
      400,
      limit === FOLDER_PEER_LIMIT
        ? 'В папке можно отметить до 100 чатов, с Premium — до 200'
        : 'В папке можно отметить до 200 чатов',
    );
  return unique;
}
// Folders are personal organisation, so read-only accounts keep them too.
export async function saveFolder(me: string, body: Record<string, unknown>) {
  await assertReadable(me);
  const title =
    typeof body.title === 'string'
      ? body.title.trim().replace(/\s+/g, ' ')
      : '';
  if (!title || title.length > FOLDER_TITLE_LIMIT)
    throw new ApiError(400, 'Название папки — от 1 до 12 символов');
  const emoji = body.emoji === undefined ? '' : body.emoji;
  if (typeof emoji !== 'string' || emoji.length > 16 || /\s/.test(emoji))
    throw new ApiError(400, 'Выберите значок папки');
  const extended = await premium(me);
  const limit = extended ? FOLDER_PEER_PREMIUM_LIMIT : FOLDER_PEER_LIMIT;
  const include = peers(body.includePeers, limit),
    exclude = peers(body.excludePeers, limit);
  if (include.some((peer) => exclude.includes(peer)))
    throw new ApiError(400, 'Чат не может быть и в папке, и в исключениях');
  const values = [
    title,
    emoji,
    flag(body.includePersonal),
    flag(body.includeGroups),
    flag(body.includeSecret),
    flag(body.excludeRead),
    flag(body.excludeArchived),
    JSON.stringify(include),
    JSON.stringify(exclude),
  ];
  if (!values[2] && !values[3] && !values[4] && !include.length)
    throw new ApiError(400, 'Выберите типы чатов или отдельные чаты для папки');
  const now = Date.now();
  if (body.id !== undefined) {
    if (typeof body.id !== 'string' || body.id.length > 100)
      throw new ApiError(400, 'Папка не найдена');
    const result = await db()
      .prepare(
        `UPDATE chat_folders SET title=?,emoji=?,includePersonal=?,includeGroups=?,includeSecret=?,excludeRead=?,excludeArchived=?,includePeers=?,excludePeers=?,updated=?
        WHERE id=? AND userId=?`,
      )
      .bind(...values, now, body.id, me)
      .run();
    if (!result.meta.changes) throw new ApiError(404, 'Папка не найдена');
    return { id: body.id };
  }
  const id = crypto.randomUUID();
  const result = await db()
    .prepare(
      `INSERT INTO chat_folders(id,userId,title,emoji,includePersonal,includeGroups,includeSecret,excludeRead,excludeArchived,includePeers,excludePeers,position,created,updated)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT MAX(position)+1 FROM chat_folders WHERE userId=?),0),?,?
      WHERE (SELECT COUNT(*) FROM chat_folders WHERE userId=?)<?`,
    )
    .bind(
      id,
      me,
      ...values,
      me,
      now,
      now,
      me,
      extended ? FOLDER_PREMIUM_LIMIT : FOLDER_LIMIT,
    )
    .run();
  if (!result.meta.changes)
    throw new ApiError(
      400,
      extended
        ? 'Можно создать до 20 папок'
        : 'Можно создать до 10 папок, с Premium — до 20',
    );
  return { id };
}
export async function deleteFolder(me: string, id: unknown) {
  await assertReadable(me);
  if (typeof id !== 'string' || id.length > 100)
    throw new ApiError(400, 'Папка не найдена');
  const result = await db()
    .prepare('DELETE FROM chat_folders WHERE id=? AND userId=?')
    .bind(id, me)
    .run();
  if (!result.meta.changes) throw new ApiError(404, 'Папка не найдена');
  return { ok: true };
}
export async function reorderFolders(me: string, ids: unknown) {
  await assertReadable(me);
  if (
    !Array.isArray(ids) ||
    ids.length > FOLDER_PREMIUM_LIMIT ||
    ids.some((id) => typeof id !== 'string' || id.length > 100) ||
    new Set(ids).size !== ids.length
  )
    throw new ApiError(400, 'Проверьте порядок папок');
  await db()
    .prepare(
      `UPDATE chat_folders SET position=(SELECT CAST(j.key AS INTEGER) FROM json_each(?) j WHERE j.value=chat_folders.id)
      WHERE userId=? AND id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids), me, JSON.stringify(ids))
    .run();
  return { ok: true };
}
