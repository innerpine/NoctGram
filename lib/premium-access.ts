import { sqlNow } from './channel-access';
// Expressions are internal SQL fragments, never request values.
export function premiumActive(user: string) {
  return `EXISTS(SELECT 1 FROM premium_entitlements pe WHERE pe.userId=${user} AND pe.startsAt<=${sqlNow} AND pe.expiresAt>${sqlNow} AND pe.revokedAt=0)`;
}
export function appearanceColumns(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw new Error('Invalid appearance alias');
  const active = premiumActive(alias + '.id');
  const field = (column: string, fallback: string) =>
    `COALESCE((SELECT pa.${column} FROM profile_appearance pa WHERE pa.userId=${alias}.id AND ${active}),${fallback})`;
  return `${active} AS premium,${field('theme', "'iris'")} AS profileTheme,${field('nameGradient', '0')} AS nameGradient,${field('ringText', "''")} AS ringText,${field('chromeFlow', '0')} AS chromeFlow,${field('chromeTempo', '11')} AS chromeTempo,${field('avatarMotion', "''")} AS avatarMotion,${field('avatarMotionType', "''")} AS avatarMotionType`;
}
export function appearanceFrom(row: Record<string, unknown>) {
  return {
    premium: row.premium,
    profileTheme: row.profileTheme,
    nameGradient: row.nameGradient,
    ringText: row.ringText,
    chromeFlow: row.chromeFlow,
    chromeTempo: row.chromeTempo,
    avatarMotion: row.avatarMotion,
    avatarMotionType: row.avatarMotionType,
  };
}
