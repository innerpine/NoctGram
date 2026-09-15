import { ApiError } from './api-error';

export const NOCT_GIFTS_AUTH_SECONDS = 3600;
const encoder = new TextEncoder();
const invalid = () =>
  new ApiError(
    401,
    'Откройте приложение заново в Telegram.',
    'TELEGRAM_AUTH_INVALID',
  );

// This token belongs to the Mini App's bot, not the existing payment bot.
// Only signed initData establishes identity; usernames and browser state do not.
export async function verifyNoctGiftsInitData(
  raw: unknown,
  botToken: string,
  now = Date.now(),
) {
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken))
    throw new ApiError(
      503,
      'Вход через Telegram пока не настроен.',
      'NOCT_GIFTS_NOT_CONFIGURED',
    );
  if (typeof raw !== 'string' || !raw || raw.length > 8192) throw invalid();
  // URLSearchParams tolerates malformed escapes and silently keeps duplicate keys.
  // Reject both before constructing the Telegram data-check-string.
  try {
    for (const part of raw.split('&')) {
      if (!part || !part.includes('=')) throw invalid();
      const at = part.indexOf('=');
      decodeURIComponent(part.slice(0, at).replaceAll('+', ' '));
      decodeURIComponent(part.slice(at + 1).replaceAll('+', ' '));
    }
  } catch {
    throw invalid();
  }
  const params = new URLSearchParams(raw);
  const keys = new Set<string>();
  for (const [key] of params) {
    if (!/^[a-z_]+$/.test(key) || keys.has(key)) throw invalid();
    keys.add(key);
  }
  const hash = params.get('hash') || '';
  const authDate = params.get('auth_date') || '';
  if (!/^[a-f0-9]{64}$/i.test(hash) || !/^[1-9]\d{0,11}$/.test(authDate))
    throw invalid();
  const authenticatedAt = Number(authDate) * 1000;
  if (
    authenticatedAt > now + 30000 ||
    authenticatedAt + NOCT_GIFTS_AUTH_SECONDS * 1000 <= now
  )
    throw new ApiError(
      401,
      'Вход устарел. Откройте приложение заново в Telegram.',
      'TELEGRAM_AUTH_EXPIRED',
    );
  params.delete('hash');
  params.sort();
  const check = Array.from(params, ([key, value]) => `${key}=${value}`).join(
    '\n',
  );
  const derivationKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secret = await crypto.subtle.sign(
    'HMAC',
    derivationKey,
    encoder.encode(botToken),
  );
  const signingKey = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signature = Uint8Array.from(hash.match(/../g)!, (byte) =>
    parseInt(byte, 16),
  );
  if (
    !(await crypto.subtle.verify(
      'HMAC',
      signingKey,
      signature,
      encoder.encode(check),
    ))
  )
    throw invalid();
  let user: Record<string, unknown>;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    throw invalid();
  }
  if (
    !user ||
    typeof user !== 'object' ||
    Array.isArray(user) ||
    !Number.isSafeInteger(user.id) ||
    Number(user.id) <= 0 ||
    user.is_bot === true
  )
    throw invalid();
  return {
    telegramId: String(user.id),
    authenticatedAt,
    authExpiresAt: authenticatedAt + NOCT_GIFTS_AUTH_SECONDS * 1000,
  };
}
