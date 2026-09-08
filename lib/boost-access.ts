import { boostRules } from './boost-rules';
const now = "(strftime('%s','now')*1000)";
// Internal SQL expressions only; no request values are interpolated here.
export function boostPersonActive(alias: string) {
  return `${alias}.kind='person' AND ${alias}.deletedAt=0 AND ${alias}.onboardingComplete=1
    AND NOT EXISTS(SELECT 1 FROM account_restrictions br WHERE br.userId=${alias}.id AND (br.expiresAt IS NULL OR br.expiresAt>${now}))`;
}
export function boostChannelActive(alias: string) {
  return `${alias}.kind='channel' AND ${alias}.deletedAt=0 AND ${alias}.onboardingComplete=1
    AND EXISTS(SELECT 1 FROM users bo WHERE bo.id=${alias}.ownerId AND ${boostPersonActive('bo')})
    AND NOT EXISTS(SELECT 1 FROM account_restrictions br WHERE br.userId=${alias}.id AND (br.expiresAt IS NULL OR br.expiresAt>${now}))`;
}
export function activeBoosts(channelId: string) {
  return `(SELECT COUNT(*) FROM channel_boost_slots bs JOIN users bu ON bu.id=bs.userId
    JOIN premium_entitlements bp ON bp.userId=bu.id
    WHERE bs.channelId=${channelId} AND ${boostPersonActive('bu')}
    AND bp.startsAt<=${now} AND bp.expiresAt>${now} AND bp.revokedAt=0)`;
}
export function channelLevel(alias: string) {
  return `(CASE WHEN ${boostChannelActive(alias)} THEN MIN(${boostRules.maxLevel},CAST(${activeBoosts(alias + '.id')}/${boostRules.perLevel} AS INTEGER)) ELSE 0 END)`;
}
export function channelCanAct(alias: string, actor: string, manage = false) {
  return `(${alias}.ownerId=${actor} OR EXISTS(SELECT 1 FROM channel_members bcm WHERE bcm.channelId=${alias}.id AND bcm.userId=${actor}${manage ? " AND bcm.role='admin'" : ''}))`;
}
