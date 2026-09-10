import { CompactEncrypt, compactDecrypt } from 'jose';
import {
  SECRET_PROTOCOL,
  SECRET_TEXT_MAX_BYTES,
  SecretCryptoError,
  sameSecretPublicKey,
  secretMemberBindings,
  secretProtectedHeader,
  validateSecretEnvelope,
  validateSecretPublicKey,
  type SecretMember,
  type SecretPublicKey,
} from './secret-format';
import {
  IndexedDbSecretKeyStorage,
  secretRecordId,
  type SecretKeyRecord,
  type SecretKeyStorage,
} from './secret-key-store';

export { SecretCryptoError } from './secret-format';
export type { SecretMember, SecretPublicKey } from './secret-format';
const defaultStorage = new IndexedDbSecretKeyStorage();
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function requireCrypto() {
  if (
    globalThis.isSecureContext === false ||
    !globalThis.crypto?.subtle ||
    !globalThis.crypto?.getRandomValues
  ) {
    throw new SecretCryptoError('unsupported');
  }
}

function scope(accountId: string, roomId: string) {
  if (
    ![accountId, roomId].every(
      (id) =>
        typeof id === 'string' &&
        id.length > 0 &&
        id.length <= 128 &&
        !Array.from(id).some((character) => character.charCodeAt(0) < 32),
    )
  ) {
    throw new SecretCryptoError('key_corrupt');
  }
}

async function publicFrom(key: CryptoKey): Promise<SecretPublicKey> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return validateSecretPublicKey({
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
  });
}

/** Check the private CryptoKey really belongs to the public JWK, including after structured clone. */
async function validateRecord(
  value: unknown,
  accountId: string,
  roomId: string,
): Promise<SecretKeyRecord> {
  try {
    const record = value as SecretKeyRecord;
    if (
      !record ||
      record.version !== 1 ||
      record.id !== secretRecordId(accountId, roomId) ||
      record.accountId !== accountId ||
      record.roomId !== roomId
    )
      throw new Error();
    const key = record.privateKey;
    const algorithm = key.algorithm as EcKeyAlgorithm;
    if (
      key.type !== 'private' ||
      key.extractable ||
      algorithm.name !== 'ECDH' ||
      algorithm.namedCurve !== 'P-256' ||
      key.usages.length !== 1 ||
      key.usages[0] !== 'deriveBits'
    )
      throw new Error();
    const publicKey = await validateSecretPublicKey(record.publicKey);
    if (record.peer !== null) {
      if (
        !record.peer ||
        typeof record.peer.userId !== 'string' ||
        !record.peer.userId ||
        record.peer.userId === accountId
      )
        throw new Error();
      await validateSecretPublicKey(record.peer.publicKey);
    }
    const imported = await crypto.subtle.importKey(
      'jwk',
      publicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const probe = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const actual = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'ECDH', public: probe.publicKey },
        key,
        256,
      ),
    );
    const expected = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'ECDH', public: imported },
        probe.privateKey,
        256,
      ),
    );
    const equal = actual.every((byte, index) => byte === expected[index]);
    actual.fill(0);
    expected.fill(0);
    if (!equal) throw new Error();
    return { ...record, publicKey };
  } catch {
    throw new SecretCryptoError('key_corrupt');
  }
}

async function loadKey(
  accountId: string,
  roomId: string,
  registeredPublicKey: SecretPublicKey | null,
  storage: SecretKeyStorage,
): Promise<SecretKeyRecord> {
  requireCrypto();
  scope(accountId, roomId);
  let value = await storage.read(accountId, roomId);
  if (value === undefined || value === null) {
    if (registeredPublicKey !== null)
      throw new SecretCryptoError('key_missing');
    try {
      const pair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveBits'],
      );
      const record: SecretKeyRecord = {
        id: secretRecordId(accountId, roomId),
        version: 1,
        accountId,
        roomId,
        publicKey: await publicFrom(pair.publicKey),
        privateKey: pair.privateKey,
        peer: null,
      };
      // Transactional first-writer wins also protects concurrent tabs from generating conflicting identities.
      value = await storage.putIfAbsent(record);
    } catch (error) {
      throw error instanceof SecretCryptoError
        ? error
        : new SecretCryptoError('unsupported');
    }
  }
  const record = await validateRecord(value, accountId, roomId);
  if (registeredPublicKey !== null) {
    let registered: SecretPublicKey;
    try {
      registered = await validateSecretPublicKey(registeredPublicKey);
    } catch {
      throw new SecretCryptoError('key_changed');
    }
    if (!sameSecretPublicKey(record.publicKey, registered))
      throw new SecretCryptoError('key_changed');
  }
  return record;
}

/** Call only after the user creates/accepts this secret room. Upload publicKey only. */
export async function ensureKey(
  accountId: string,
  roomId: string,
  registeredPublicKey: SecretPublicKey | null,
  storage: SecretKeyStorage = defaultStorage,
): Promise<{ publicKey: SecretPublicKey }> {
  const record = await loadKey(accountId, roomId, registeredPublicKey, storage);
  return { publicKey: { ...record.publicKey } };
}

export type SecretSession = Readonly<{
  accountId: string;
  roomId: string;
  safetyCode: string;
  /** Cancels in-flight output and drops the in-memory session key; persistent device keys remain. */
  dispose(): void;
}>;
type SessionState = { key: CryptoKey | null; members: SecretMember[] };
const states = new WeakMap<SecretSession, SessionState>();

function stateOf(session: SecretSession): SessionState & { key: CryptoKey } {
  const state = states.get(session);
  if (!state?.key) throw new SecretCryptoError('session_closed');
  return state as SessionState & { key: CryptoKey };
}

export async function prepareSession(
  accountId: string,
  roomId: string,
  members: SecretMember[],
  storage: SecretKeyStorage = defaultStorage,
): Promise<SecretSession> {
  requireCrypto();
  scope(accountId, roomId);
  if (
    !Array.isArray(members) ||
    members.length !== 2 ||
    !members.some((member) => member.userId === accountId)
  )
    throw new SecretCryptoError('key_changed');
  if (members.some((member) => !member.publicKey))
    throw new SecretCryptoError('peer_pending');
  // Snapshot server metadata before the first await so callers cannot accidentally change it mid-operation.
  const snapshot = members.map((member) => ({
    userId: member.userId,
    publicKey: { ...member.publicKey! },
  }));
  let bindings: [string, string][];
  try {
    bindings = await secretMemberBindings(snapshot);
  } catch {
    throw new SecretCryptoError('key_changed');
  }
  const self = snapshot.find((member) => member.userId === accountId)!;
  const peer = snapshot.find((member) => member.userId !== accountId)!;
  const record = await loadKey(accountId, roomId, self.publicKey, storage);
  // Atomic TOFU pin. Once observed, another key or another member is refused in every later session.
  await storage.pinPeer(accountId, roomId, record.publicKey, peer);
  const peerKey = await crypto.subtle.importKey(
    'jwk',
    peer.publicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  let shared: Uint8Array<ArrayBuffer> | undefined;
  let key: CryptoKey;
  try {
    shared = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'ECDH', public: peerKey },
        record.privateKey,
        256,
      ),
    );
    const material = await crypto.subtle.importKey(
      'raw',
      shared,
      'HKDF',
      false,
      ['deriveKey'],
    );
    const salt = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(`${SECRET_PROTOCOL}/hkdf-salt`),
    );
    key = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: encoder.encode(
          JSON.stringify([SECRET_PROTOCOL, roomId, bindings]),
        ),
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new SecretCryptoError('unsupported');
  } finally {
    shared?.fill(0);
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(
        JSON.stringify([SECRET_PROTOCOL, 'safety', roomId, bindings]),
      ),
    ),
  );
  const safetyCode = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, '0'),
  )
    .join('')
    .toUpperCase()
    .match(/.{4}/g)!
    .join(' ');
  const state: SessionState = { key, members: snapshot };
  const session: SecretSession = Object.freeze({
    accountId,
    roomId,
    safetyCode,
    dispose() {
      state.key = null;
    },
  });
  states.set(session, state);
  return session;
}

function contextFor(
  session: SecretSession,
  id: string,
  sender: string,
  state: SessionState,
) {
  return {
    roomId: session.roomId,
    messageId: id,
    senderId: sender,
    members: state.members,
  };
}

/** Keep the returned ciphertext with its original id for every network retry. */
export async function encryptText(
  session: SecretSession,
  message: { id: string; sender: string; text: string },
): Promise<string> {
  const state = stateOf(session);
  if (message.sender !== session.accountId)
    throw new SecretCryptoError('invalid_message');
  if (typeof message.text !== 'string')
    throw new SecretCryptoError('invalid_message');
  const bytes = encoder.encode(message.text);
  if (!bytes.length || bytes.length > SECRET_TEXT_MAX_BYTES)
    throw new SecretCryptoError('text_too_long');
  try {
    const header = await secretProtectedHeader(
      contextFor(session, message.id, message.sender, state),
    );
    stateOf(session);
    const ciphertext = await new CompactEncrypt(bytes)
      .setProtectedHeader(header)
      .encrypt(state.key);
    stateOf(session);
    return ciphertext;
  } catch (error) {
    throw error instanceof SecretCryptoError
      ? error
      : new SecretCryptoError('invalid_message');
  } finally {
    bytes.fill(0);
  }
}

/** No plaintext cache: caller clears rendered text on room close, logout, and account switch. */
export async function decryptText(
  session: SecretSession,
  message: { id: string; sender: string; ciphertext: string },
): Promise<string> {
  const state = stateOf(session);
  let plaintext: Uint8Array | undefined;
  try {
    await validateSecretEnvelope(
      message.ciphertext,
      contextFor(session, message.id, message.sender, state),
    );
    stateOf(session);
    const result = await compactDecrypt(message.ciphertext, state.key, {
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    plaintext = result.plaintext;
    if (!plaintext.length || plaintext.length > SECRET_TEXT_MAX_BYTES)
      throw new Error();
    const text = decoder.decode(plaintext);
    stateOf(session);
    return text;
  } catch (error) {
    throw error instanceof SecretCryptoError
      ? error
      : new SecretCryptoError('invalid_message');
  } finally {
    plaintext?.fill(0);
  }
}
