import { db, ApiError } from './server';
import {
  assertAccountVisible,
  assertChannelWritable,
  assertWritable,
  visibleAccount,
} from './account-access';

export const sqlNow = "(strftime('%s','now')*1000)";
export function published(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw new Error('Invalid alias');
  return `${alias}.cancelledAt=0 AND ${alias}.publishAt<=${sqlNow}`;
}
// Alias is the channel/user being acted upon; the two bindings are actor IDs.
export function channelPermission(
  alias: string,
  permission: 'publish' | 'manage' | 'profile' | 'members' = 'publish',
) {
  if (!/^[a-z]+$/.test(alias)) throw new Error('Invalid alias');
  return `(${alias}.id=? OR ${alias}.ownerId=?${permission === 'members' ? '' : ` OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channelId=${alias}.id AND cm.userId=?${permission === 'publish' ? '' : " AND cm.role='admin'"})`})`;
}
export async function channelRights(id: string, me: string) {
  const row = await db()
    .prepare(
      `SELECT u.kind,u.ownerId,(SELECT role FROM channel_members WHERE channelId=u.id AND userId=?) AS role FROM users u WHERE u.id=?`,
    )
    .bind(me, id)
    .first<{ kind: string; ownerId: string; role: string | null }>();
  const owner = row?.ownerId === me || id === me;
  return {
    channelRole: owner ? 'owner' : row?.role || null,
    canPublish: owner || !!row?.role,
    canEditProfile: owner || row?.role === 'admin',
    canManagePosts: owner || row?.role === 'admin',
    canManageMembers: owner,
  };
}
export async function allowed(
  id: string,
  me: string,
  permission: 'publish' | 'manage' | 'profile' | 'members' = 'publish',
) {
  await assertWritable(me);
  const row = await db()
    .prepare(
      `SELECT u.id FROM users u WHERE u.id=? AND ${channelPermission('u', permission)} AND ${visibleAccount('u')}`,
    )
    .bind(id, me, me, ...(permission === 'members' ? [] : [me]))
    .first();
  if (row && id !== me) {
    await assertAccountVisible(id);
    await assertChannelWritable(id);
  }
  return !!row;
}
export async function requireChannel(
  id: string,
  me: string,
  permission: 'publish' | 'manage' | 'profile' | 'members' = 'publish',
) {
  if (!(await allowed(id, me, permission)))
    throw new ApiError(403, 'Недостаточно прав в канале');
}
export function activeActor() {
  return `NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=? AND (ar.expiresAt IS NULL OR ar.expiresAt>${sqlNow}))`;
}
export function writableTarget(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw new Error('Invalid alias');
  return `NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId IN(${alias}.id,${alias}.ownerId,?) AND (ar.expiresAt IS NULL OR ar.expiresAt>${sqlNow}))`;
}
