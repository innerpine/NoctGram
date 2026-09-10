import { db } from './storage';
import { ApiError } from './api-error';
import { assertAccountVisible } from './account-access';
import { messagePair, messageVisible } from './chat-access';
import {
  chatLinks,
  chatLibraryKinds,
  type ChatLibraryKind,
  type ChatLibraryPage,
  type ChatLibraryStats,
} from './chat-library';
import type { ChatAttachment } from './chat-files';

const scope = `WITH visible AS (
  SELECT m.* FROM messages m WHERE ${messagePair('m', '?', '?')} AND ${messageVisible('m', '?')}
), attachments AS (
  SELECT m.id AS messageId,m.sender,m.created,CAST(j.key AS INTEGER) AS part,j.value AS file,
    CASE json_extract(j.value,'$.kind') WHEN 'image' THEN 'photos' WHEN 'video' THEN 'videos'
      ELSE CASE WHEN json_extract(j.value,'$.type') LIKE 'audio/%' THEN 'audio' ELSE 'files' END END AS category
  FROM visible m,json_each(m.media) j
  WHERE NOT EXISTS(SELECT 1 FROM moderated_uploads u WHERE u.uploadId=json_extract(j.value,'$.id'))
)`;
type Cursor = { created: number; id: string; part: number };
function cursor(value: string): Cursor | null {
  if (!value) return null;
  try {
    const result = JSON.parse(value);
    if (
      value.length <= 500 &&
      Number.isSafeInteger(result.created) &&
      result.created >= 0 &&
      typeof result.id === 'string' &&
      result.id.length > 0 &&
      result.id.length <= 250 &&
      Number.isInteger(result.part) &&
      result.part >= 0 &&
      result.part < 10
    )
      return result;
  } catch {
    /* Return a consistent client error for invalid cursors. */
  }
  throw new ApiError(400, 'Не удалось прочитать страницу материалов');
}
export async function readChatLibrary(
  me: string,
  peer: string,
  kind = '',
  before = '',
): Promise<ChatLibraryStats | ChatLibraryPage> {
  if (!peer || peer.length > 100 || peer === me)
    throw new ApiError(400, 'Выбери собеседника');
  await assertAccountVisible(peer);
  const args = [me, peer, peer, me, me];
  if (!kind) {
    const row = await db()
      .prepare(`${scope}
      SELECT COUNT(*) AS messages,COALESCE(SUM(sender=?),0) AS sent,
        COALESCE(SUM(sender<>?),0) AS received,MIN(created) AS first,
        (SELECT COUNT(*) FROM attachments WHERE category='photos') AS photos,
        (SELECT COUNT(*) FROM attachments WHERE category='videos') AS videos,
        (SELECT COUNT(*) FROM attachments WHERE category='files') AS files,
        (SELECT COUNT(*) FROM attachments WHERE category='audio') AS audio FROM visible`)
      .bind(...args, me, me)
      .first<ChatLibraryStats>();
    return row!;
  }
  if (!chatLibraryKinds.includes(kind as ChatLibraryKind))
    throw new ApiError(400, 'Неизвестный раздел материалов');
  const position = cursor(before);
  if (kind === 'links') {
    const rows = await db()
      .prepare(`${scope} SELECT id,sender,created,text FROM visible
      WHERE (text LIKE '%https://%' OR text LIKE '%http://%' OR text LIKE '%www.%')
        ${position ? 'AND (created,id)<(?,?)' : ''}
      ORDER BY created DESC,id DESC LIMIT 31`)
      .bind(...args, ...(position ? [position.created, position.id] : []))
      .all<{ id: string; sender: string; created: number; text: string }>();
    const chosen = rows.results.slice(0, 30),
      last = chosen.at(-1);
    return {
      items: chosen.flatMap((row) =>
        chatLinks(row.text).map((url, index) => ({
          id: row.id + ':link:' + index,
          messageId: row.id,
          sender: row.sender,
          created: row.created,
          url,
          text: row.text,
        })),
      ),
      next:
        rows.results.length > 30 && last
          ? JSON.stringify({ created: last.created, id: last.id, part: 0 })
          : null,
    };
  }
  const rows = await db()
    .prepare(`${scope} SELECT * FROM attachments WHERE category=?
    ${position ? 'AND (created,messageId,part)<(?,?,?)' : ''}
    ORDER BY created DESC,messageId DESC,part DESC LIMIT 31`)
    .bind(
      ...args,
      kind,
      ...(position ? [position.created, position.id, position.part] : []),
    )
    .all<{
      messageId: string;
      sender: string;
      created: number;
      part: number;
      file: string;
    }>();
  const chosen = rows.results.slice(0, 30),
    last = chosen.at(-1);
  return {
    items: chosen.map((row) => ({
      id: row.messageId + ':' + row.part,
      messageId: row.messageId,
      sender: row.sender,
      created: row.created,
      file: JSON.parse(row.file) as ChatAttachment,
    })),
    next:
      rows.results.length > 30 && last
        ? JSON.stringify({
            created: last.created,
            id: last.messageId,
            part: last.part,
          })
        : null,
  };
}
