# Secret chat cryptography, version 1

This is browser-based end-to-end encryption for text in an immutable two-person room. The server stores ciphertext and public keys. It does not receive private keys, derived session keys, or message plaintext through this protocol. This application protocol has not undergone an independent security audit. It is not Signal, has no double ratchet, and does not provide forward secrecy or post-compromise recovery.

## Protocol and wire contract

Each account/browser creates a separate P-256 ECDH key pair for each secret room using Web Crypto. The private `CryptoKey` is non-extractable and stored by structured clone in IndexedDB. Only `{kty:'EC',crv:'P-256',x,y}` is sent to the room key registration endpoint. Registration is immutable, account-authorized, and idempotent only for the identical key. The other participant must explicitly accept the room in their own browser before sending is enabled.

Each browser computes P-256 ECDH with its private key and the peer's registered public key. Web Crypto HKDF-SHA256 derives a non-extractable AES-256-GCM key. HKDF salt is SHA256 of UTF-8 `noctgram.secret.v1/hkdf-salt`; HKDF info is UTF-8 JSON of `["noctgram.secret.v1",roomId,bindings]`. `bindings` is the two `[userId,RFC7638-SHA256-public-JWK-thumbprint]` arrays sorted by user ID using JavaScript string order. Both members derive the same room key, so each can decrypt incoming messages and their own history.

`jose` 6.2.12 creates compact JWE with `alg:dir`, `enc:A256GCM` and a fresh random 96-bit IV. It handles authenticated encryption and decryption; this module implements no cryptographic primitive. The complete protected header, in canonical insertion order, is:

```json
{
  "alg": "dir",
  "enc": "A256GCM",
  "typ": "noctgram-secret+jwe",
  "v": 1,
  "roomId": "server-room-id",
  "messageId": "stable-client-uuid",
  "senderId": "authenticated-account-id",
  "members": [["first-user-id", "first-thumbprint"], ["second-user-id", "second-thumbprint"]]
}
```

The backend and client use `validateSecretEnvelope` to require this exact header, empty encrypted-key segment, a 12-byte IV, a 16-byte authentication tag, canonical base64url, 1–8000 decoded ciphertext bytes, and at most 32768 characters total. With uncompressed AES-GCM and its authentication tag stored separately, ciphertext length equals plaintext length, so the server enforces the text byte limit without decrypting. This server validation checks shape and context; the server cannot verify the GCM authentication tag. Only the receiving browser authenticates/decrypts. The client permits 1–8000 UTF-8 bytes of text. A valid room always has exactly two distinct account IDs and public keys.

Send request: `{id:roomId,key:messageId,ciphertext}`. The backend stores the client message ID unchanged for secret messages, verifies `senderId` against the authenticated account, and permits only byte-identical retries for a given message ID. It must reject plaintext, files, media, polls, or other payload fields in a secret send. The UI generates the UUID once, encrypts once, and retains that ciphertext for all retries. Encrypting again generates a different IV; do not use re-encryption as a retry mechanism. Stable IDs and server uniqueness handle duplicate delivery; cryptography alone does not enforce ordering or prevent replay of the exact same message.

## Browser integration

```ts
import { ensureKey, prepareSession, encryptText, decryptText } from './secret-crypto';

// Only when creating/explicitly accepting. Pass the current registered self key or null.
const { publicKey } = await ensureKey(accountId, roomId, selfMember.publicKey);
await registerPublicKey(roomId, publicKey);
// Refresh membership from the server after registration; both keys must be present.
const session = await prepareSession(accountId, roomId, members);
const id = crypto.randomUUID();
const ciphertext = await encryptText(session, { id, sender: accountId, text });
await send({ id: roomId, key: id, ciphertext });
const textToRender = await decryptText(session, { id: row.id, sender: row.sender, ciphertext: row.ciphertext });
// On room close, account switch, or logout:
session.dispose();
```

Members are `{userId:string,publicKey:SecretPublicKey|null}`. `session.safetyCode` is a shared full SHA-256 fingerprint, grouped into four hexadecimal characters for comparison. `SecretCryptoError.code` distinguishes unsupported crypto/storage, missing or corrupted device keys, changed keys, pending peers, malformed messages, closed sessions, and excessive text. Messages contain actionable Russian UI guidance.

No private key is returned from `ensureKey`. Its storage record is scoped by the JSON-encoded `[accountId,roomId]` and checked against both fields. A fresh ECDH challenge confirms that the persisted private CryptoKey actually corresponds to its public JWK; another account's or corrupted record is refused. Transactional first-writer-wins creation handles concurrent tabs. The first observed peer ID/key is atomically pinned and later changes are refused. No automatic rotation or silent recovery exists for a registered key.

Logout preserves IndexedDB device keys for a later login, but must call `dispose()` and clear rendered plaintext, composer state, message lists, and pending network sends. Disposal rejects crypto output completing after it has been called. The UI must also cancel/ignore a pending `prepareSession` or `ensureKey` result after account/room changes: those functions complete before a disposable session exists. Never persist decrypted text, plaintext drafts, logs, push previews, analytics payloads, or exports for secret messages. Membership/key metadata and ciphertext fetches should use authenticated `no-store` responses.

## Verification and limits

The safety code is SHA256 of UTF-8 JSON `["noctgram.secret.v1","safety",roomId,bindings]`. Both people should compare the entire code through an independently trusted channel, ideally in person. Do not label a room "verified" merely because encryption succeeded or the UI displayed a code. A local trust-on-first-use pin catches later key substitutions, but an active server can substitute keys at the very first contact. Comparing codes detects that initial man-in-the-middle attack, assuming both browsers are running this unmodified client and the comparison channel is authentic.

Browser-delivered code remains trusted: a malicious deployment, XSS, privileged extension, or compromised device can read displayed text or ask the non-extractable key to decrypt. Non-extractable does not mean hardware-backed or protection from same-origin JavaScript. Browser storage is not a security boundary between people sharing one OS/browser profile. Namespace validation prevents accidental cross-account key reuse, not a local attacker controlling the browser.

Clearing site data, browser eviction, a different browser/profile, a new origin, or losing the device can permanently remove access to that room's history. There is no cloud recovery, private-key export, or multi-device synchronization. Create a new secret room when the original browser key is unavailable; existing keys stay immutable. Compromising either participant's static room private key can expose all recorded messages for that room. Either participant can also construct messages under the shared symmetric key; the protocol provides no signatures, non-repudiation, or proof against the other participant.

The server still sees both participants, room IDs, timing, message IDs/senders, delivery/read metadata, public keys/fingerprints, ciphertext length, and traffic patterns. It can drop or delay messages. This feature does not hide metadata, provide disappearing messages, prevent screenshots/copying, or encrypt group/ordinary chats. Per-room public keys avoid cryptographic key reuse across rooms, but the server already knows the account identities.

## Validation and primary references

`tests/secret-crypto.test.mjs` runs actual Node Web Crypto and the installed jose implementation with an injected structured-clone memory store. It covers both-party history, tampering, context binding, outsider forgery, first-contact safety-code mismatch, missing/changed/corrupt keys, per-room/account isolation, concurrent key creation, text limits, randomized IVs, and disposal. A separate synthetic browser harness validates real IndexedDB storage; it uses no real accounts.

- [Web Cryptography specification: key storage, security considerations, ECDH, HKDF, AES-GCM](https://www.w3.org/TR/WebCryptoAPI/)
- [RFC 7516: JWE authenticated encryption and protected header](https://www.rfc-editor.org/rfc/rfc7516.html)
- [RFC 5869: HKDF and context binding through info](https://www.rfc-editor.org/rfc/rfc5869.html)
- [RFC 7638: canonical public JWK thumbprints](https://www.rfc-editor.org/rfc/rfc7638.html)
- [jose CompactEncrypt API](https://github.com/panva/jose/blob/main/docs/jwe/compact/encrypt/classes/CompactEncrypt.md)
- [jose compactDecrypt API](https://github.com/panva/jose/blob/main/docs/jwe/compact/decrypt/functions/compactDecrypt.md)

Primary specifications and current upstream documentation checked 2026-09-09. Recheck dependencies and obtain independent protocol/application review before making stronger security claims.
