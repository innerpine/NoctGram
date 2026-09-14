import { ApiError } from './api-error';

export const DEVICE_COOKIE = '__Host-noct_device';
export const ACCESS_HISTORY_MS = 30 * 86400000;
const observed = new Map<string, number>();
const OBSERVE_INTERVAL = 15 * 60000;
export function accessCookie(headers: Headers, name: string) {
  return (
    headers
      .get('cookie')
      ?.split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(name + '='))
      ?.slice(name.length + 1) || ''
  );
}
export async function accessHash(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function normalizeClientIp(value: string | null) {
  if (
    !value ||
    value.length > 64 ||
    /[\s,%/\]]/.test(value) ||
    value.includes('[')
  )
    return '';
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    const parts = value.split('.').map(Number);
    return parts.every((p) => p <= 255) ? parts.join('.') : '';
  }
  if (!value.includes(':')) return '';
  try {
    const ip = new URL('http://[' + value + ']').hostname.slice(1, -1);
    const mapped = ip.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
    if (mapped) {
      const a = parseInt(mapped[1], 16),
        b = parseInt(mapped[2], 16);
      return [a >> 8, a & 255, b >> 8, b & 255].join('.');
    }
    return ip;
  } catch {
    return '';
  }
}
export function accessIp(headers: Headers) {
  // Only Cloudflare's edge headers; never X-Forwarded-For or client-supplied identity.
  return (
    normalizeClientIp(headers.get('cf-connecting-ipv6')) ||
    normalizeClientIp(headers.get('cf-connecting-ip'))
  );
}
function deviceLabel(agent: string) {
  const os = /iPhone|iPad|iPod/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Macintosh/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'Устройство';
  const browser = /Edg/.test(agent)
    ? 'Edge'
    : /Firefox|FxiOS/.test(agent)
      ? 'Firefox'
      : /Chrome|CriOS/.test(agent)
        ? 'Chrome'
        : /Safari/.test(agent)
          ? 'Safari'
          : 'Браузер';
  return browser + ' · ' + os;
}
export function prepareAccessRequest(request: Request) {
  let device = accessCookie(request.headers, DEVICE_COOKIE);
  let setCookie = '';
  if (!/^[a-f0-9]{64}$/.test(device)) {
    device = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const headers = new Headers(request.headers);
    const cookies = (headers.get('cookie') || '')
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith(DEVICE_COOKIE + '='));
    headers.set(
      'cookie',
      [...cookies, DEVICE_COOKIE + '=' + device].join('; '),
    );
    request = new Request(request, { headers });
    setCookie = `${DEVICE_COOKIE}=${device}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
  }
  return { request, setCookie };
}
export async function accessPrincipal(
  d: D1Database,
  headers: Headers,
  now: number,
) {
  const token = accessCookie(headers, 'noct_session');
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return d
    .prepare(`SELECT s.userId,
    EXISTS(SELECT 1 FROM administrators WHERE userId=s.userId) AS administrator
    FROM auth_sessions s JOIN users u ON u.id=s.userId
    WHERE s.tokenHash=? AND s.expiresAt>? AND u.deletedAt=0`)
    .bind(await accessHash(token), now)
    .first<{ userId: string; administrator: number }>();
}
export async function checkAccessRequest(
  d: D1Database,
  request: Request,
  now = Date.now(),
) {
  const ip = accessIp(request.headers);
  const device = accessCookie(request.headers, DEVICE_COOKIE);
  const ipHash = ip ? await accessHash('ip:' + ip) : '';
  const deviceHash = /^[a-f0-9]{64}$/.test(device)
    ? await accessHash('device:' + device)
    : '';
  const principal = await accessPrincipal(d, request.headers, now);
  // A verified administrator can always reach the controls needed to undo a block.
  if (!principal?.administrator) {
    const denied = await d
      .prepare(`SELECT id FROM access_blocks WHERE targetId=? AND revokedAt=0
      UNION ALL SELECT b.id FROM access_block_rules r JOIN access_blocks b ON b.id=r.blockId
        WHERE r.kind='ip' AND r.valueHash=? AND b.revokedAt=0
      UNION ALL SELECT b.id FROM access_block_rules r JOIN access_blocks b ON b.id=r.blockId
        WHERE r.kind='device' AND r.valueHash=? AND b.revokedAt=0 LIMIT 1`)
      .bind(principal?.userId || '', ipHash, deviceHash)
      .first();
    if (denied)
      throw new ApiError(
        403,
        'Доступ к Noctgram заблокирован администратором.',
        'ACCESS_BLOCKED',
      );
  }
  if (!principal) return;
  const entries = [
    ...(ipHash ? [{ kind: 'ip', hash: ipHash, label: ip }] : []),
    ...(deviceHash
      ? [
          {
            kind: 'device',
            hash: deviceHash,
            label: deviceLabel(request.headers.get('user-agent') || ''),
          },
        ]
      : []),
  ].filter(
    (entry) =>
      (observed.get(principal.userId + ':' + entry.hash) || 0) <
      now - OBSERVE_INTERVAL,
  );
  if (!entries.length) return;
  await d.batch(
    entries.map((entry) =>
      d
        .prepare(`INSERT INTO access_observations
    (id,userId,kind,valueHash,label,firstSeen,lastSeen) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(userId,kind,valueHash) DO UPDATE SET lastSeen=excluded.lastSeen,label=excluded.label
      WHERE access_observations.lastSeen<?`)
        .bind(
          crypto.randomUUID(),
          principal.userId,
          entry.kind,
          entry.hash,
          entry.label,
          now,
          now,
          now - OBSERVE_INTERVAL,
        ),
    ),
  );
  if (observed.size > 2048) observed.clear();
  for (const entry of entries)
    observed.set(principal.userId + ':' + entry.hash, now);
}

export async function cleanAccessHistory(d: D1Database, now = Date.now()) {
  await d
    .prepare(`DELETE FROM access_observations WHERE id IN
    (SELECT id FROM access_observations WHERE lastSeen<? ORDER BY lastSeen LIMIT 500)`)
    .bind(now - ACCESS_HISTORY_MS)
    .run();
}
