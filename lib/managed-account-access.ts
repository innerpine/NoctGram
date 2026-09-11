import { db } from './storage';

// Grants use immutable profile IDs from deployment configuration, never handles
// or client-supplied identity headers. Invalid configuration grants no access.
export function managedTargets(config: string, principal: string): string[] {
  try {
    const grants: unknown = JSON.parse(config);
    if (!grants || typeof grants !== 'object' || Array.isArray(grants))
      return [];
    const targets = Object.hasOwn(grants, principal)
      ? (grants as Record<string, unknown>)[principal]
      : null;
    if (!Array.isArray(targets) || targets.length > 20) return [];
    if (
      !targets.every(
        (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id),
      )
    )
      return [];
    return [...new Set(targets)].filter((id) => id !== principal);
  } catch {
    return [];
  }
}

export async function canManageAccount(
  config: string,
  principal: string,
  target: string,
) {
  if (!managedTargets(config, principal).includes(target)) return false;
  const row = await db()
    .prepare(`SELECT 1 FROM users owner JOIN users target ON target.id=?
    WHERE owner.id=? AND owner.deletedAt=0 AND target.deletedAt=0
    AND owner.onboardingComplete=1 AND target.onboardingComplete=1
    AND owner.kind='person' AND target.kind='person'
    AND NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.userId IN(owner.id,target.id)
      AND (r.expiresAt IS NULL OR r.expiresAt>?))`)
    .bind(target, principal, Date.now())
    .first();
  return !!row;
}
