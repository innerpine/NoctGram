import { setting } from './auth-session';
const now = "(strftime('%s','now')*1000)";
// Internal SQL expressions only. Paid intervals are independent of admin grants.
export function entitlementActive(user: string) {
  return `(EXISTS(SELECT 1 FROM premium_entitlements pe WHERE pe.userId=${user} AND pe.startsAt<=${now} AND pe.expiresAt>${now} AND pe.revokedAt=0 ${setting('NOCT_PREMIUM_TEST_MODE') === '1' ? '' : "AND pe.source<>'test'"}) OR EXISTS(SELECT 1 FROM premium_purchases pp WHERE pp.userId=${user} AND pp.startsAt<=${now} AND pp.expiresAt>${now} AND pp.revokedAt=0))`;
}
export function entitlementExpiry(user: string) {
  return `MAX(COALESCE((SELECT expiresAt FROM premium_entitlements WHERE userId=${user} AND revokedAt=0 ${setting('NOCT_PREMIUM_TEST_MODE') === '1' ? '' : "AND source<>'test'"}),0),COALESCE((SELECT MAX(expiresAt) FROM premium_purchases WHERE userId=${user} AND revokedAt=0),0))`;
}
