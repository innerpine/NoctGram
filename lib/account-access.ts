import { premiumActive } from './premium-access';
import { published } from './channel-access';
import {
  personalVisibility,
  contentPreference,
  assertCanInteract,
} from './privacy';
import { db, ApiError } from './server';
export type Restriction = {
  userId: string;
  eventId: string;
  mode: 'read_only' | 'blocked';
  reason: string;
  expiresAt: number | null;
  created: number;
};
// Alias arguments are internal SQL identifiers; values always use bindings.
export function visibleAccount(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw new Error('Invalid SQL alias');
  return `${alias}.deletedAt=0 AND ${alias}.onboardingComplete=1 AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId IN (${alias}.id,${alias}.ownerId) AND ar.mode='blocked' AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))`;
}
export async function restriction(id: string) {
  return db()
    .prepare(
      'SELECT * FROM account_restrictions WHERE userId=? AND (expiresAt IS NULL OR expiresAt>?)',
    )
    .bind(id, Date.now())
    .first<Restriction>();
}
export async function blockingRestriction(id: string) {
  return db()
    .prepare(
      "SELECT r.* FROM account_restrictions r JOIN users u ON r.userId=u.id OR r.userId=u.ownerId WHERE u.id=? AND r.mode='blocked' AND (r.expiresAt IS NULL OR r.expiresAt>?) LIMIT 1",
    )
    .bind(id, Date.now())
    .first<Restriction>();
}
export async function isModerator(id: string) {
  return !!(await db()
    .prepare(
      'SELECT userId FROM moderators WHERE userId=? UNION SELECT userId FROM administrators WHERE userId=?',
    )
    .bind(id, id)
    .first());
}
export async function assertReadable(id: string) {
  if ((await restriction(id))?.mode === 'blocked')
    throw new ApiError(403, 'Аккаунт заблокирован', 'ACCOUNT_BLOCKED');
}
export async function assertWritable(id: string) {
  const r = await restriction(id);
  if (r)
    throw new ApiError(
      403,
      r.mode === 'blocked'
        ? 'Аккаунт заблокирован'
        : 'Для аккаунта включён режим только чтения',
      r.mode === 'blocked' ? 'ACCOUNT_BLOCKED' : 'READ_ONLY',
    );
}
export async function assertChannelWritable(id: string) {
  const r = await restriction(id);
  if (r)
    throw new ApiError(
      403,
      r.mode === 'blocked'
        ? 'Канал заблокирован'
        : 'Публикация и редактирование канала временно ограничены',
      r.mode === 'blocked' ? 'CHANNEL_BLOCKED' : 'CHANNEL_READ_ONLY',
    );
}
export async function assertUploadAvailable(id: string) {
  if (
    await db()
      .prepare('SELECT uploadId FROM moderated_uploads WHERE uploadId=?')
      .bind(id)
      .first()
  )
    throw new ApiError(404, 'Файл удалён модератором');
  // A shared file stays accessible through a visible post/profile. A channel-only
  // file must not bypass a channel block through the uploader's personal account.
  const uses = await db()
    .prepare(`WITH uses AS (
    SELECT u.id,u.ownerId,u.onboardingComplete,u.deletedAt FROM posts p JOIN users u ON u.id=p.userId
      WHERE EXISTS(SELECT 1 FROM json_each(p.media) m WHERE json_extract(m.value,'$.id')=?)
    UNION SELECT u.id,u.ownerId,u.onboardingComplete,u.deletedAt FROM stories s JOIN users u ON u.id=s.userId WHERE s.mediaId=? AND s.deletedAt=0 AND s.expiresAt>strftime('%s','now')*1000
    UNION SELECT u.id,u.ownerId,u.onboardingComplete,u.deletedAt FROM profile_appearance pa JOIN users u ON u.id=pa.userId WHERE pa.avatarMotion=? AND ${premiumActive('u.id')}
    UNION SELECT u.id,u.ownerId,u.onboardingComplete,u.deletedAt FROM users u WHERE u.avatar=? OR u.cover=?
  ) SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN ${visibleAccount('u')} THEN 1 ELSE 0 END),0) AS visible FROM uses u`)
    .bind(id, id, '/api/media/' + id, '/api/media/' + id, '/api/media/' + id)
    .first<{ total: number; visible: number }>();
  if (uses?.total && !uses.visible) throw new ApiError(404, 'Файл недоступен');
}
export async function requireModerator(id: string) {
  if (!(await isModerator(id)))
    throw new ApiError(403, 'Доступ только для модератора');
  await assertWritable(id);
}
export async function assertAccountVisible(id: string) {
  if (
    !(await db()
      .prepare('SELECT id FROM users WHERE id=? AND onboardingComplete=1')
      .bind(id)
      .first())
  )
    throw new ApiError(404, 'Профиль не найден');
  if (await blockingRestriction(id))
    throw new ApiError(403, 'Аккаунт заблокирован', 'ACCOUNT_UNAVAILABLE');
}
export async function assertPostVisible(id: string, me?: string) {
  const post = await db()
    .prepare(
      'SELECT u.id FROM posts p JOIN users u ON u.id=p.userId WHERE p.id=? AND ' +
        published('p') +
        ' AND ' +
        visibleAccount('u') +
        (me
          ? ' AND ' + personalVisibility('u') + ' AND ' + contentPreference('p')
          : ''),
    )
    .bind(id, ...(me ? [me, me] : []))
    .first();
  if (!post) throw new ApiError(404, 'Публикация недоступна');
  if (me) await assertCanInteract(me, String(post.id));
}
