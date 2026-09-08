// Arguments are internal SQL expressions, never request values.
export function messageVisible(alias: string, actor: string) {
  return `${alias}.deletedAt=0 AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.messageId=${alias}.id AND hm.userId=${actor})`;
}
export function messagePair(alias: string, actor: string, peer: string) {
  return `((${alias}.sender=${actor} AND ${alias}.recipient=${peer}) OR (${alias}.sender=${peer} AND ${alias}.recipient=${actor}))`;
}
export function messageWritable(actor: string) {
  return `NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=${actor} AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))`;
}
