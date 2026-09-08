import { ApiError } from './api-error';

export type CallIceConfiguration = {
  iceServers: RTCIceServer[];
  relayConfigured: boolean;
  expiresAt: number;
};
const ttl = 10800;
export async function turnConfiguration(
  setting: (name: string) => string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<CallIceConfiguration> {
  const stun = (setting('NOCT_STUN_URLS') || 'stun:stun.cloudflare.com:3478')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => /^stuns?:[^\s]+$/.test(v));
  const base: CallIceConfiguration = {
    iceServers: stun.length ? [{ urls: stun }] : [],
    relayConfigured: false,
    expiresAt: now + ttl * 1000,
  };
  const provider =
    setting('NOCT_TURN_PROVIDER') ||
    (setting('NOCT_TURN_SECRET') ? 'coturn' : 'none');
  if (provider === 'none') return base;
  if (provider === 'cloudflare') {
    const id = setting('NOCT_CF_TURN_KEY_ID'),
      token = setting('NOCT_CF_TURN_API_TOKEN');
    if (!id && !token) return base;
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id) || !token)
      throw new ApiError(503, 'Сервис звонков ещё настраивается');
    try {
      const response = await fetcher(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(7000),
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('TURN provider refused');
      }
      const data = (await response.json()) as { iceServers?: unknown };
      if (!Array.isArray(data.iceServers))
        throw new Error('Invalid TURN response');
      const iceServers: RTCIceServer[] = [];
      for (const entry of data.iceServers) {
        if (!entry || typeof entry !== 'object') continue;
        const raw = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
        // Browser-safe endpoints only. In particular, port 53 is blocked by browsers.
        const urls = raw.filter(
          (url: unknown): url is string =>
            typeof url === 'string' &&
            /^(?:stun:stun\.cloudflare\.com:3478|turn:turn\.cloudflare\.com:(?:3478|80)\?transport=(?:udp|tcp)|turns:turn\.cloudflare\.com:(?:5349|443)\?transport=tcp)$/.test(
              url,
            ),
        );
        if (!urls.length) continue;
        if (urls.some((u: string) => u.startsWith('turn'))) {
          if (
            typeof entry.username !== 'string' ||
            !entry.username ||
            entry.username.length > 2048 ||
            typeof entry.credential !== 'string' ||
            !entry.credential ||
            entry.credential.length > 4096 ||
            entry.credential === token
          )
            throw new Error('Invalid TURN credential');
          iceServers.push({
            urls,
            username: entry.username,
            credential: entry.credential,
          });
        } else iceServers.push({ urls });
      }
      if (
        !iceServers.some((s) =>
          (s.urls as string[]).some((u) => u.startsWith('turn')),
        )
      )
        throw new Error('Missing relay');
      return { iceServers, relayConfigured: true, expiresAt: now + ttl * 1000 };
    } catch {
      throw new ApiError(
        503,
        'Не удалось подготовить соединение. Попробуйте позвонить немного позже.',
      );
    }
  }
  if (provider !== 'coturn')
    throw new ApiError(503, 'Сервис звонков ещё настраивается');
  const urls = setting('NOCT_TURN_URLS')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => /^turns?:[^\s]+$/.test(v)),
    secret = setting('NOCT_TURN_SECRET');
  if (!urls.length || !secret) return base;
  // Opaque username: do not disclose NoctGram account IDs to a relay service.
  const username = Math.floor(now / 1000 + ttl) + ':' + crypto.randomUUID();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username)),
  );
  return {
    ...base,
    iceServers: [
      ...base.iceServers,
      { urls, username, credential: btoa(String.fromCharCode(...signature)) },
    ],
    relayConfigured: true,
  };
}
