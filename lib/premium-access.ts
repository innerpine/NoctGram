import { entitlementActive } from './premium-predicate';
import { activeBoosts, boostChannelActive, channelLevel } from './boost-access';
import { boostRules } from './boost-rules';
// Expressions are internal SQL fragments, never request values.
export function premiumActive(user: string) {
  return entitlementActive(user);
}
export function animatedAvatarActive(alias: string) {
  // This predicate is nested in media writes. Avoid the level CASE/MIN/CAST here
  // to stay within D1's expression-depth limit while checking the same unlock.
  return `(${premiumActive(alias + '.id')} OR (${boostChannelActive(alias)} AND ${activeBoosts(alias + '.id')}>=${5 * boostRules.perLevel}))`;
}
export function appearanceColumns(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw new Error('Invalid appearance alias');
  const active = premiumActive(alias + '.id');
  const level = channelLevel(alias);
  const field = (column: string, fallback: string, required = 1) =>
    `COALESCE((SELECT pa.${column} FROM profile_appearance pa WHERE pa.userId=${alias}.id AND (${active} OR (${alias}.kind='channel' AND ${level}>=${required}))),${fallback})`;
  return `${alias}.verified AS verified,${active} AS premium,${level} AS boostLevel,${field('theme', "'iris'")} AS profileTheme,${field('nameGradient', '0', 2)} AS nameGradient,${field('ringText', "''", 4)} AS ringText,${field('chromeFlow', '0', 3)} AS chromeFlow,${field('chromeTempo', '11', 3)} AS chromeTempo,${field('avatarMotion', "''", 5)} AS avatarMotion,${field('avatarMotionType', "''", 5)} AS avatarMotionType`;
}
export function appearanceFrom(row: Record<string, unknown>) {
  return {
    verified: row.verified,
    premium: row.premium,
    boostLevel: row.boostLevel,
    profileTheme: row.profileTheme,
    nameGradient: row.nameGradient,
    ringText: row.ringText,
    chromeFlow: row.chromeFlow,
    chromeTempo: row.chromeTempo,
    avatarMotion: row.avatarMotion,
    avatarMotionType: row.avatarMotionType,
  };
}
