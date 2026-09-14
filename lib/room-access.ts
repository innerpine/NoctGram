const clockSql = "strftime('%s','now')*1000";
// Arguments to these predicates are internal SQL expressions, never user input.
export const readable = (
  u: string,
) => `${u}.kind='person' AND ${u}.deletedAt=0 AND ${u}.onboardingComplete=1
  AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=${u}.id AND ar.mode='blocked' AND (ar.expiresAt IS NULL OR ar.expiresAt>${clockSql}))`;
export const writable = (u: string) =>
  `${readable(u)} AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=${u}.id AND (ar.expiresAt IS NULL OR ar.expiresAt>${clockSql}))`;
export const unblocked = (a: string, b: string) =>
  `NOT EXISTS(SELECT 1 FROM user_blocks ub WHERE (ub.blocker=${a} AND ub.blocked=${b}) OR (ub.blocker=${b} AND ub.blocked=${a}))`;
export const accepts = (
  sender: string,
  recipient: string,
) => `${unblocked(sender, recipient)} AND
  (COALESCE((SELECT messagePolicy FROM user_privacy WHERE userId=${recipient}),'everyone')='everyone'
  OR ((SELECT messagePolicy FROM user_privacy WHERE userId=${recipient})='following' AND EXISTS(SELECT 1 FROM follows WHERE follower=${recipient} AND following=${sender})))`;
export const visibleRoom = (
  r: string,
  actor: string,
) => `${r}.deletedAt=0 AND EXISTS(SELECT 1 FROM users owner WHERE owner.id=${r}.ownerId AND ${readable('owner')})
  AND EXISTS(SELECT 1 FROM users viewu WHERE viewu.id=${actor} AND ${readable('viewu')})
  AND ${unblocked(actor, `${r}.ownerId`)}
  AND (${r}.kind<>'secret' OR NOT EXISTS(SELECT 1 FROM chat_room_members sm JOIN users peer ON peer.id=sm.userId WHERE sm.roomId=${r}.id AND (sm.status<>'active' OR NOT (${readable('peer')}) OR NOT (${unblocked(actor, 'peer.id')}))))`;
export const access = (
  r: string,
  actor: string,
  write = false,
  roles?: string[],
) => `${visibleRoom(r, actor)}
  AND EXISTS(SELECT 1 FROM chat_room_members accessm JOIN users accessu ON accessu.id=accessm.userId
  WHERE accessm.roomId=${r}.id AND accessm.userId=${actor} AND accessm.status='active'
  ${roles ? `AND accessm.role IN (${roles.map((role) => `'${role}'`).join(',')})` : ''}
  AND ${write ? writable('accessu') : readable('accessu')})`;
export const canSend = (
  r: string,
  actor: string,
) => `${access(r, actor, true)} AND (${r}.kind='group' OR
  ((SELECT COUNT(*) FROM chat_room_members km WHERE km.roomId=${r}.id AND km.status='active' AND km.publicKey<>'')=2
  AND NOT EXISTS(SELECT 1 FROM chat_room_members pm WHERE pm.roomId=${r}.id AND pm.userId<>${actor} AND NOT (${accepts(actor, 'pm.userId')}))))`;
