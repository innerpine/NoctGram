// Server-only token envelopes: authenticated encryption binds each secret to its owner and purpose.
const encoder = new TextEncoder();
function bytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
function base64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}
async function key(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret))
    throw new Error(
      'MUSIC_TOKEN_KEY must contain 32 random bytes encoded as hex',
    );
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(secret.match(/../g)!, (b) => parseInt(b, 16)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function sealMusicToken(
  value: unknown,
  secret: string,
  context: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    await key(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `v1.${base64(iv)}.${base64(new Uint8Array(sealed))}`;
}
export async function openMusicToken<T>(
  value: string,
  secret: string,
  context: string,
): Promise<T> {
  const [version, iv, payload, extra] = value.split('.');
  if (version !== 'v1' || !iv || !payload || extra || value.length > 20000)
    throw new Error('Invalid music token envelope');
  const decoded = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode(context) },
    await key(secret),
    bytes(payload),
  );
  return JSON.parse(new TextDecoder().decode(decoded)) as T;
}
export async function musicPKCE(verifier: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(verifier),
  );
  return base64(new Uint8Array(digest))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
