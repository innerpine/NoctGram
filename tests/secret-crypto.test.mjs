import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CompactEncrypt, decodeProtectedHeader } from 'jose';

const moduleUrls = new Map();
function compile(relative) {
  if (moduleUrls.has(relative)) return moduleUrls.get(relative);
  const source = readFileSync(
    new URL(`../lib/${relative}.ts`, import.meta.url),
    'utf8',
  );
  let compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  compiled = compiled.replace(
    /from ['"]([^'"]+)['"]/g,
    (_match, path) =>
      `from ${JSON.stringify(path.startsWith('./') ? compile(path.slice(2)) : import.meta.resolve(path))}`,
  );
  const url =
    'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64');
  moduleUrls.set(relative, url);
  return url;
}
const { ensureKey, prepareSession, encryptText, decryptText } = await import(
  compile('secret-crypto')
);
const { secretRecordId } = await import(compile('secret-key-store'));
const {
  SecretCryptoError,
  validateSecretPublicKey,
  validateSecretEnvelope,
  secretProtectedHeader,
  sameSecretPublicKey,
} = await import(compile('secret-format'));

class MemoryStorage {
  records = new Map();
  async read(accountId, roomId) {
    return structuredClone(this.records.get(secretRecordId(accountId, roomId)));
  }
  async putIfAbsent(record) {
    if (!this.records.has(record.id))
      this.records.set(record.id, structuredClone(record));
    return structuredClone(this.records.get(record.id));
  }
  async pinPeer(accountId, roomId, ownKey, peer) {
    const record = this.records.get(secretRecordId(accountId, roomId));
    if (!record || record.accountId !== accountId || record.roomId !== roomId)
      throw new SecretCryptoError('key_corrupt');
    if (
      !sameSecretPublicKey(record.publicKey, ownKey) ||
      (record.peer &&
        (record.peer.userId !== peer.userId ||
          !sameSecretPublicKey(record.peer.publicKey, peer.publicKey)))
    )
      throw new SecretCryptoError('key_changed');
    record.peer = structuredClone(peer);
    return structuredClone(record);
  }
}
const coded = (code) => (error) =>
  error instanceof SecretCryptoError && error.code === code;
const roomId = 'room-1';
const id = '8507cbd4-d4ce-4ed8-8a38-1a15399bc2f5';
async function fixture() {
  const store = new MemoryStorage();
  const aliceKey = (await ensureKey('alice', roomId, null, store)).publicKey;
  const bobKey = (await ensureKey('bob', roomId, null, store)).publicKey;
  const members = [
    { userId: 'alice', publicKey: aliceKey },
    { userId: 'bob', publicKey: bobKey },
  ];
  const alice = await prepareSession('alice', roomId, members, store);
  const bob = await prepareSession(
    'bob',
    roomId,
    [...members].reverse(),
    store,
  );
  return { store, members, alice, bob };
}

void test('both participants decrypt both directions and their own history after reload; safety codes agree', async () => {
  const { store, members, alice, bob } = await fixture();
  assert.equal(alice.safetyCode, bob.safetyCode);
  assert.match(alice.safetyCode, /^(?:[A-F0-9]{4} ){15}[A-F0-9]{4}$/);
  for (const [sender, sending] of [
    ['alice', alice],
    ['bob', bob],
  ]) {
    const text = 'Секрет 🌙 <script>test</script>\nsecond line';
    const ciphertext = await encryptText(sending, { id, sender, text });
    assert.equal(ciphertext.includes('Секрет'), false);
    assert.equal(ciphertext.split('.').length, 5);
    assert.deepEqual(Object.keys(decodeProtectedHeader(ciphertext)), [
      'alg',
      'enc',
      'typ',
      'v',
      'roomId',
      'messageId',
      'senderId',
      'members',
    ]);
    for (const session of [alice, bob])
      assert.equal(
        await decryptText(session, { id, sender, ciphertext }),
        text,
      );
    const reloaded = await prepareSession(sender, roomId, members, store);
    assert.equal(await decryptText(reloaded, { id, sender, ciphertext }), text);
  }
});

void test('envelope format binds message ID, room, sender and current keys; retries preserve bytes', async () => {
  const { members, alice, bob } = await fixture();
  const ciphertext = await encryptText(alice, {
    id,
    sender: 'alice',
    text: 'Only these two readers',
  });
  const context = { roomId, messageId: id, senderId: 'alice', members };
  assert.equal(await validateSecretEnvelope(ciphertext, context), ciphertext);
  assert.equal(await validateSecretEnvelope(ciphertext, context), ciphertext);
  for (const changed of [
    { messageId: 'other' },
    { roomId: 'other' },
    { senderId: 'bob' },
  ]) {
    await assert.rejects(
      validateSecretEnvelope(ciphertext, { ...context, ...changed }),
    );
  }
  for (const changed of [{ id: 'other' }, { sender: 'bob' }]) {
    await assert.rejects(
      decryptText(bob, { id, sender: 'alice', ciphertext, ...changed }),
      coded('invalid_message'),
    );
  }
  const header = decodeProtectedHeader(ciphertext);
  const parts = ciphertext.split('.');
  parts[0] = Buffer.from(
    JSON.stringify({ ...header, senderId: 'bob' }),
  ).toString('base64url');
  await assert.rejects(
    decryptText(bob, { id, sender: 'bob', ciphertext: parts.join('.') }),
    coded('invalid_message'),
  );
});

void test('tampered nonce, encrypted content, tag and noncanonical or algorithm-confused envelopes are refused', async () => {
  const { alice, bob } = await fixture();
  const ciphertext = await encryptText(alice, {
    id,
    sender: 'alice',
    text: 'Integrity check',
  });
  for (const index of [2, 3, 4]) {
    const parts = ciphertext.split('.');
    parts[index] =
      (parts[index][0] === 'A' ? 'B' : 'A') + parts[index].slice(1);
    await assert.rejects(
      decryptText(bob, { id, sender: 'alice', ciphertext: parts.join('.') }),
      coded('invalid_message'),
    );
  }
  for (const extra of [
    { alg: 'none' },
    { enc: 'A128GCM' },
    { zip: 'DEF' },
    { crit: ['custom'], custom: true },
    { v: 2 },
  ]) {
    const parts = ciphertext.split('.');
    parts[0] = Buffer.from(
      JSON.stringify({ ...decodeProtectedHeader(ciphertext), ...extra }),
    ).toString('base64url');
    await assert.rejects(
      decryptText(bob, { id, sender: 'alice', ciphertext: parts.join('.') }),
      coded('invalid_message'),
    );
  }
  for (const value of ['', 'plaintext', `${ciphertext}=`, 'a'.repeat(32769)]) {
    await assert.rejects(
      decryptText(bob, { id, sender: 'alice', ciphertext: value }),
      coded('invalid_message'),
    );
  }
});

void test('an outsider with all public metadata cannot forge a valid ciphertext', async () => {
  const { members, bob } = await fixture();
  const arbitraryKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const header = await secretProtectedHeader({
    roomId,
    messageId: id,
    senderId: 'alice',
    members,
  });
  const ciphertext = await new CompactEncrypt(
    new TextEncoder().encode('forged'),
  )
    .setProtectedHeader(header)
    .encrypt(arbitraryKey);
  await assert.rejects(
    decryptText(bob, { id, sender: 'alice', ciphertext }),
    coded('invalid_message'),
  );
});

void test('missing keys never silently regenerate a registered identity; only public key is returned', async () => {
  const store = new MemoryStorage();
  const first = await ensureKey('alice', roomId, null, store);
  assert.deepEqual(Object.keys(first), ['publicKey']);
  const record = store.records.get(secretRecordId('alice', roomId));
  assert.equal(record.privateKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('jwk', record.privateKey));
  assert.deepEqual(
    await ensureKey('alice', roomId, first.publicKey, store),
    first,
  );
  store.records.clear();
  await assert.rejects(
    ensureKey('alice', roomId, first.publicKey, store),
    coded('key_missing'),
  );
  assert.equal(store.records.size, 0);
});

void test('key generation is per room and first writer wins concurrent creation', async () => {
  const store = new MemoryStorage();
  const keys = await Promise.all(
    Array.from({ length: 6 }, () => ensureKey('alice', roomId, null, store)),
  );
  assert.ok(
    keys.every((key) => sameSecretPublicKey(key.publicKey, keys[0].publicKey)),
  );
  assert.equal(store.records.size, 1);
  const other = await ensureKey('alice', 'other-room', null, store);
  assert.equal(sameSecretPublicKey(other.publicKey, keys[0].publicKey), false);
  const otherAccount = await ensureKey('bob', roomId, null, store);
  assert.equal(
    sameSecretPublicKey(otherAccount.publicKey, keys[0].publicKey),
    false,
  );
});

void test('cross-account/cross-room records and mismatched private/public pairs are refused', async () => {
  const { store, members } = await fixture();
  const aliceId = secretRecordId('alice', roomId);
  const aliceRecord = structuredClone(store.records.get(aliceId));
  const bobRecord = structuredClone(
    store.records.get(secretRecordId('bob', roomId)),
  );
  for (const bad of [
    bobRecord,
    { ...aliceRecord, roomId: 'other-room' },
    { ...aliceRecord, version: 99 },
    { ...aliceRecord, privateKey: bobRecord.privateKey },
    { ...aliceRecord, privateKey: {} },
    { ...aliceRecord, peer: undefined },
  ]) {
    store.records.set(aliceId, bad);
    await assert.rejects(
      ensureKey('alice', roomId, members[0].publicKey, store),
      coded('key_corrupt'),
    );
  }
});

void test('changed self key, pinned peer key or peer identity locks the room', async () => {
  const { store, members } = await fixture();
  const attacker = (await ensureKey('mallory', 'elsewhere', null, store))
    .publicKey;
  await assert.rejects(
    ensureKey('alice', roomId, attacker, store),
    coded('key_changed'),
  );
  await assert.rejects(
    prepareSession(
      'alice',
      roomId,
      [members[0], { userId: 'bob', publicKey: attacker }],
      store,
    ),
    coded('key_changed'),
  );
  await assert.rejects(
    prepareSession(
      'alice',
      roomId,
      [members[0], { userId: 'mallory', publicKey: members[1].publicKey }],
      store,
    ),
    coded('key_changed'),
  );
  assert.equal(
    (await prepareSession('alice', roomId, members, store)).roomId,
    roomId,
  );
});

void test('first contact key substitution produces different safety codes on the two clients', async () => {
  const aliceStore = new MemoryStorage();
  const bobStore = new MemoryStorage();
  const attackerStore = new MemoryStorage();
  const a = (await ensureKey('alice', roomId, null, aliceStore)).publicKey;
  const b = (await ensureKey('bob', roomId, null, bobStore)).publicKey;
  const m = (await ensureKey('mallory', roomId, null, attackerStore)).publicKey;
  const alice = await prepareSession(
    'alice',
    roomId,
    [
      { userId: 'alice', publicKey: a },
      { userId: 'bob', publicKey: m },
    ],
    aliceStore,
  );
  const bob = await prepareSession(
    'bob',
    roomId,
    [
      { userId: 'alice', publicKey: m },
      { userId: 'bob', publicKey: b },
    ],
    bobStore,
  );
  assert.notEqual(alice.safetyCode, bob.safetyCode);
});

void test('a pending peer and malformed group membership cannot establish a session', async () => {
  const { store, members } = await fixture();
  await assert.rejects(
    prepareSession(
      'alice',
      roomId,
      [members[0], { userId: 'bob', publicKey: null }],
      store,
    ),
    coded('peer_pending'),
  );
  for (const invalid of [
    [members[0]],
    [members[0], members[0]],
    [...members, members[0]],
    [{ ...members[0], userId: 'mallory' }, members[1]],
  ]) {
    await assert.rejects(
      prepareSession('alice', roomId, invalid, store),
      coded('key_changed'),
    );
  }
});

void test('strict public JWK validation rejects secret material, extra parameters and invalid points', async () => {
  const { members } = await fixture();
  const publicKey = members[0].publicKey;
  assert.deepEqual(await validateSecretPublicKey(publicKey), publicKey);
  for (const invalid of [
    null,
    [],
    {},
    { ...publicKey, d: 'private' },
    { ...publicKey, ext: true },
    { ...publicKey, crv: 'P-384' },
    { ...publicKey, x: `${publicKey.x}=` },
    { ...publicKey, x: 'A'.repeat(43), y: 'A'.repeat(43) },
  ]) {
    await assert.rejects(validateSecretPublicKey(invalid));
  }
});

void test('UTF-8 text byte limits, sender identity and randomized nonce are enforced', async () => {
  const { alice, bob } = await fixture();
  await assert.rejects(
    encryptText(alice, { id, sender: 'bob', text: 'forged' }),
    coded('invalid_message'),
  );
  for (const text of ['', '🌙'.repeat(2001), 'a'.repeat(8001)]) {
    await assert.rejects(
      encryptText(alice, { id, sender: 'alice', text }),
      coded('text_too_long'),
    );
  }
  const text = '🌙'.repeat(2000);
  const one = await encryptText(alice, { id, sender: 'alice', text });
  const two = await encryptText(alice, { id, sender: 'alice', text });
  assert.notEqual(one.split('.')[2], two.split('.')[2]);
  assert.equal(
    await decryptText(bob, { id, sender: 'alice', ciphertext: one }),
    text,
  );
});

void test('disposing on logout or account switch cancels in-flight plaintext/ciphertext output', async () => {
  const { alice, bob } = await fixture();
  const ciphertext = await encryptText(alice, {
    id,
    sender: 'alice',
    text: 'Clear on logout',
  });
  const pendingDecrypt = decryptText(bob, { id, sender: 'alice', ciphertext });
  bob.dispose();
  await assert.rejects(pendingDecrypt, coded('session_closed'));
  await assert.rejects(
    decryptText(bob, { id, sender: 'alice', ciphertext }),
    coded('session_closed'),
  );
  const pendingEncrypt = encryptText(alice, {
    id,
    sender: 'alice',
    text: 'Never submit after logout',
  });
  alice.dispose();
  await assert.rejects(pendingEncrypt, coded('session_closed'));
  assert.equal(JSON.stringify(alice).includes('key'), false);
});

void test('server envelope validation enforces the decoded 8000-byte ciphertext limit', async () => {
  const { members, alice } = await fixture();
  const ciphertext = await encryptText(alice, {
    id,
    sender: 'alice',
    text: 'a'.repeat(8000),
  });
  const context = { roomId, messageId: id, senderId: 'alice', members };
  const parts = ciphertext.split('.');
  assert.equal(Buffer.from(parts[3], 'base64url').length, 8000);
  assert.equal(await validateSecretEnvelope(ciphertext, context), ciphertext);
  parts[3] = Buffer.alloc(8001, 0x41).toString('base64url');
  const oversized = parts.join('.');
  assert.ok(oversized.length < 32768);
  await assert.rejects(
    validateSecretEnvelope(oversized, context),
    /Invalid secret message\./,
  );
});
