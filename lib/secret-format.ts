import { base64url, calculateJwkThumbprint } from 'jose';

export type SecretPublicKey = { kty: 'EC'; crv: 'P-256'; x: string; y: string };
export type SecretMember = {
  userId: string;
  publicKey: SecretPublicKey | null;
};
export type SecretEnvelopeContext = {
  roomId: string;
  messageId: string;
  senderId: string;
  members: SecretMember[];
};
export const SECRET_PROTOCOL = 'noctgram.secret.v1';
export const SECRET_TEXT_MAX_BYTES = 8000;
export const SECRET_CIPHERTEXT_MAX_LENGTH = 32768;

export type SecretErrorCode =
  | 'unsupported'
  | 'storage_unavailable'
  | 'key_missing'
  | 'key_changed'
  | 'key_corrupt'
  | 'peer_pending'
  | 'invalid_message'
  | 'session_closed'
  | 'text_too_long';
const guidance: Record<SecretErrorCode, string> = {
  unsupported:
    'Секретный чат требует HTTPS и браузер с поддержкой Web Crypto и IndexedDB.',
  storage_unavailable:
    'Браузер не смог сохранить ключ секретного чата. Разрешите хранение данных сайта и попробуйте снова.',
  key_missing:
    'Ключ этого чата остался в исходном браузере. Вернитесь в него или создайте новый секретный чат. После удаления данных сайта старую историю восстановить нельзя.',
  key_changed:
    'Ключ участника изменился. Чат заблокирован. Сверьте код безопасности с собеседником по другому каналу и создайте новый секретный чат.',
  key_corrupt:
    'Ключ этого чата повреждён или принадлежит другому аккаунту. Откройте исходный браузер или создайте новый секретный чат.',
  peer_pending: 'Собеседник должен принять секретный чат в своём браузере.',
  invalid_message: 'Не удалось проверить и расшифровать секретное сообщение.',
  session_closed: 'Секретный чат закрыт. Откройте его заново.',
  text_too_long:
    'Секретное сообщение должно содержать от 1 до 8000 байт текста.',
};
export class SecretCryptoError extends Error {
  readonly code: SecretErrorCode;
  constructor(code: SecretErrorCode) {
    super(guidance[code]);
    this.name = 'SecretCryptoError';
    this.code = code;
  }
}

function identifier(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 128 ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error('Invalid secret chat identifier.');
  }
}

function base64(value: unknown, bytes?: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value))
    return false;
  try {
    const decoded = base64url.decode(value);
    return (
      (bytes === undefined || decoded.length === bytes) &&
      base64url.encode(decoded) === value
    );
  } catch {
    return false;
  }
}

/** Strict public-only JWK; rejects private parameters and invalid curve points. */
export async function validateSecretPublicKey(
  value: unknown,
): Promise<SecretPublicKey> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid secret public key.');
  const key = value as Record<string, unknown>;
  if (
    Object.keys(key).sort().join(',') !== 'crv,kty,x,y' ||
    key.kty !== 'EC' ||
    key.crv !== 'P-256' ||
    !base64(key.x, 32) ||
    !base64(key.y, 32)
  ) {
    throw new Error('Invalid secret public key.');
  }
  const canonical: SecretPublicKey = {
    kty: 'EC',
    crv: 'P-256',
    x: key.x,
    y: key.y,
  };
  await crypto.subtle.importKey(
    'jwk',
    canonical,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  return canonical;
}

export function sameSecretPublicKey(
  a: SecretPublicKey,
  b: SecretPublicKey,
): boolean {
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;
}

/** Canonical IDs and RFC 7638 thumbprints bind both key agreement and message AAD. */
export async function secretMemberBindings(
  members: SecretMember[],
): Promise<[string, string][]> {
  if (!Array.isArray(members) || members.length !== 2)
    throw new Error('Secret chats require exactly two members.');
  const bindings = await Promise.all(
    members.map(async (member) => {
      identifier(member.userId);
      const key = await validateSecretPublicKey(member.publicKey);
      return [member.userId, await calculateJwkThumbprint(key, 'sha256')] as [
        string,
        string,
      ];
    }),
  );
  if (bindings[0][0] === bindings[1][0] || bindings[0][1] === bindings[1][1])
    throw new Error(
      'Secret chat members must have distinct identities and keys.',
    );
  return bindings.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export async function secretProtectedHeader(context: SecretEnvelopeContext) {
  identifier(context.roomId);
  identifier(context.messageId);
  identifier(context.senderId);
  const members = await secretMemberBindings(context.members);
  if (!members.some(([id]) => id === context.senderId))
    throw new Error('The sender is not a secret chat member.');
  return {
    alg: 'dir',
    enc: 'A256GCM',
    typ: 'noctgram-secret+jwe',
    v: 1,
    roomId: context.roomId,
    messageId: context.messageId,
    senderId: context.senderId,
    members,
  };
}

/** Envelope shape/context validation only. The server cannot authenticate its tag. */
export async function validateSecretEnvelope(
  value: unknown,
  context: SecretEnvelopeContext,
): Promise<string> {
  if (typeof value !== 'string' || value.length > SECRET_CIPHERTEXT_MAX_LENGTH)
    throw new Error('Invalid secret message.');
  const parts = value.split('.');
  if (
    parts.length !== 5 ||
    parts[1] !== '' ||
    !base64(parts[2], 12) ||
    !base64(parts[3]) ||
    base64url.decode(parts[3]).length > SECRET_TEXT_MAX_BYTES ||
    !base64(parts[4], 16)
  ) {
    throw new Error('Invalid secret message.');
  }
  const expected = base64url.encode(
    JSON.stringify(await secretProtectedHeader(context)),
  );
  if (parts[0] !== expected)
    throw new Error('Secret message identity or keys do not match this chat.');
  return value;
}
