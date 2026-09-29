import { db } from './storage';
import { ApiError } from './api-error';
import { visibleAccount } from './account-access';
import { appearanceColumns } from './premium-access';
import { published } from './channel-access';
import { contentPreference, personalVisibility } from './privacy';
import type { Media } from './client';
import type { Appearance } from './appearance';

export const POST_PREVIEW_LIMIT = 30;
export const POST_PREVIEW_TEXT = 400;
export type PostPreview = Appearance & {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  handle: string;
  kind: string;
  text: string;
  media: Media | null;
  mediaCount: number;
  adult: number;
  poll: boolean;
  code: boolean;
  created: number;
};

// Compact cards for feed posts shared into chats. Each viewer sees a post only
// under the same rules as in their feed; hidden posts are simply absent.
export async function readPostPreviews(
  me: string,
  input: string | null,
): Promise<PostPreview[]> {
  const ids = [...new Set((input || '').split(',').filter(Boolean))];
  if (
    !ids.length ||
    ids.length > POST_PREVIEW_LIMIT ||
    ids.some((id) => id.length > 200)
  )
    throw new ApiError(400, 'Некорректный список публикаций');
  const rows = await db()
    .prepare(`SELECT p.id,p.userId,u.name,u.avatar,COALESCE(h.handle,'') AS handle,u.kind,
      substr(p.text,1,${POST_PREVIEW_TEXT}) AS text,json_extract(p.media,'$[0]') AS media,
      json_array_length(p.media) AS mediaCount,p.adult,json_array_length(p.poll)>0 AS poll,p.code<>'' AS code,p.created,
      ${appearanceColumns('u')}
      FROM json_each(?) j JOIN posts p ON p.id=j.value JOIN users u ON u.id=p.userId
      LEFT JOIN handles h ON h.userId=u.id AND h.main=1
      WHERE ${published('p')} AND ${visibleAccount('u')} AND ${personalVisibility('u')} AND ${contentPreference('p')}`)
    .bind(JSON.stringify(ids), me, me)
    .all<
      Omit<PostPreview, 'media' | 'poll' | 'code'> & {
        media: string | null;
        poll: number;
        code: number;
      }
    >();
  return rows.results.map((row) => ({
    ...row,
    media: row.media ? (JSON.parse(row.media) as Media) : null,
    poll: !!row.poll,
    code: !!row.code,
  }));
}
