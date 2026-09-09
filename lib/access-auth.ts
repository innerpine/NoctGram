import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type AccessSettings = {
  NOCT_AUTH_MODE?: string;
  NOCT_ACCESS_TEAM_DOMAIN?: string;
  NOCT_ACCESS_AUD?: string;
  NOCT_ACCESS_USERS?: string;
};
type Member = { userId: string; name?: string };
const keySets = new Map<string, JWTVerifyGetKey>();

export function accessConfiguration(settings: AccessSettings) {
  const domain = settings.NOCT_ACCESS_TEAM_DOMAIN || '';
  const audience = settings.NOCT_ACCESS_AUD || '';
  if (
    settings.NOCT_AUTH_MODE !== 'access' ||
    !/^https:\/\/[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(domain) ||
    !/^[a-f0-9]{64}$/.test(audience)
  )
    return null;
  try {
    const entries = Object.entries(
      JSON.parse(settings.NOCT_ACCESS_USERS || '{}'),
    );
    // A deliberately small, explicit list for this private test environment.
    if (!entries.length || entries.length > 3) return null;
    const users = new Map<string, Member>();
    const ids = new Set<string>();
    for (const [email, value] of entries) {
      const member = value as Member;
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email !== email.toLowerCase() ||
        !member ||
        typeof member !== 'object' ||
        typeof member.userId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(member.userId) ||
        ids.has(member.userId) ||
        (member.name !== undefined &&
          (typeof member.name !== 'string' || member.name.length > 100))
      )
        return null;
      users.set(email, member);
      ids.add(member.userId);
    }
    return { domain, audience, users };
  } catch {
    return null;
  }
}

export async function accessIdentity(
  headers: Pick<Headers, 'get'>,
  settings: AccessSettings,
  // Injected only by isolated tests, never selected by request data.
  testKeys?: JWTVerifyGetKey,
) {
  const config = accessConfiguration(settings);
  const token = headers.get('cf-access-jwt-assertion');
  if (!config || !token || token.length > 16384) return null;
  try {
    let keys = testKeys || keySets.get(config.domain);
    if (!keys) {
      keys = createRemoteJWKSet(
        new URL(`${config.domain}/cdn-cgi/access/certs`),
        { timeoutDuration: 5000 },
      );
      if (keySets.size >= 4) keySets.clear();
      keySets.set(config.domain, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.domain,
      audience: config.audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email', 'type'],
    });
    if (
      payload.type !== 'app' ||
      typeof payload.email !== 'string' ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.iat !== 'number' ||
      payload.iat > Date.now() / 1000 + 30
    )
      return null;
    const member = config.users.get(payload.email.trim().toLowerCase());
    return member
      ? {
          userId: member.userId,
          fullName: member.name || null,
          source: 'access' as const,
        }
      : null;
  } catch {
    return null;
  }
}
