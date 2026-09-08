import { db } from './storage';
import { ApiError } from './api-error';
import {
  assertReadable,
  assertWritable,
  visibleAccount,
} from './account-access';
import { messageAllowed } from './privacy';
import {
  DEFAULT_CHAT_THEME,
  isChatTheme,
  type ChatThemeState,
} from './chat-themes';

function pair(me: string, peer: unknown) {
  if (typeof peer !== 'string' || !peer || peer.length > 100 || peer === me)
    throw new ApiError(400, 'Выбери собеседника');
  return {
    ids: [me, peer].sort(),
    own: me < peer ? 'firstTheme' : 'secondTheme',
  };
}
export async function readChatTheme(
  me: string,
  peer: string,
): Promise<ChatThemeState> {
  const { ids, own } = pair(me, peer);
  const row = await db()
    .prepare(`SELECT sharedTheme AS shared, ${own} AS personal, revision
    FROM chat_themes WHERE firstId=? AND secondId=?`)
    .bind(...ids)
    .first<ChatThemeState>();
  return row
    ? {
        shared: isChatTheme(row.shared) ? row.shared : 'noct',
        personal: isChatTheme(row.personal) ? row.personal : null,
        revision: row.revision,
      }
    : DEFAULT_CHAT_THEME;
}
export async function saveChatTheme(me: string, body: Record<string, unknown>) {
  const { ids, own } = pair(me, body.peer);
  const { scope, theme } = body;
  if (
    (scope !== 'personal' && scope !== 'shared') ||
    !(isChatTheme(theme) || (scope === 'personal' && theme === null))
  )
    throw new ApiError(400, 'Выбери тему и кому её показать');
  await assertReadable(me);
  if (scope === 'shared') await assertWritable(me);
  // The authenticated viewer can only change their own override or the shared
  // theme. The other participant's override is never accepted from the client.
  const shared = scope === 'shared';
  const result = await db()
    .prepare(`INSERT INTO chat_themes(firstId,secondId,sharedTheme,${own},revision)
    SELECT ?,?,?,?,1 FROM users s,users r
    WHERE s.id=? AND r.id=? AND s.kind='person' AND r.kind='person'
      AND ${visibleAccount('s')} AND ${visibleAccount('r')}
      ${
        shared
          ? `AND ${messageAllowed}
        AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=s.id AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))`
          : ''
      }
    ON CONFLICT(firstId,secondId) DO UPDATE SET
      ${shared ? 'sharedTheme=excluded.sharedTheme,' : ''}
      ${own}=excluded.${own},revision=chat_themes.revision+1`)
    .bind(...ids, shared ? theme : 'noct', shared ? null : theme, me, body.peer)
    .run();
  if (!result.meta.changes)
    throw new ApiError(403, 'Изменение темы недоступно для этого диалога');
  return readChatTheme(me, body.peer as string);
}
