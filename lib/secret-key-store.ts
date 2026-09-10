import {
  SecretCryptoError,
  sameSecretPublicKey,
  type SecretPublicKey,
} from './secret-format';

export type SecretPeerPin = { userId: string; publicKey: SecretPublicKey };
export type SecretKeyRecord = {
  id: string;
  version: 1;
  accountId: string;
  roomId: string;
  publicKey: SecretPublicKey;
  privateKey: CryptoKey;
  peer: SecretPeerPin | null;
};

/** Injectable only for isolated tests; production uses structured-cloned IndexedDB CryptoKeys. */
export interface SecretKeyStorage {
  read(accountId: string, roomId: string): Promise<unknown>;
  putIfAbsent(record: SecretKeyRecord): Promise<unknown>;
  pinPeer(
    accountId: string,
    roomId: string,
    ownKey: SecretPublicKey,
    peer: SecretPeerPin,
  ): Promise<unknown>;
}

export const secretRecordId = (accountId: string, roomId: string) =>
  JSON.stringify([accountId, roomId]);

function checkScope(
  value: unknown,
  accountId: string,
  roomId: string,
): SecretKeyRecord {
  const record = value as SecretKeyRecord | undefined;
  if (
    !record ||
    record.version !== 1 ||
    record.id !== secretRecordId(accountId, roomId) ||
    record.accountId !== accountId ||
    record.roomId !== roomId ||
    !record.publicKey
  ) {
    throw new SecretCryptoError('key_corrupt');
  }
  return record;
}

/** Separate account/room key namespace. No private-key export, plaintext, or session key is persisted. */
export class IndexedDbSecretKeyStorage implements SecretKeyStorage {
  constructor(private readonly databaseName = 'noctgram-secret-keys-v1') {}

  private async transaction<T>(
    mode: IDBTransactionMode,
    action: (
      store: IDBObjectStore,
      done: (value: T) => void,
      fail: (error: unknown) => void,
    ) => void,
  ): Promise<T> {
    if (typeof indexedDB === 'undefined')
      throw new SecretCryptoError('unsupported');
    let db: IDBDatabase;
    try {
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(this.databaseName, 1);
        let settled = false;
        open.onupgradeneeded = () =>
          open.result.createObjectStore('keys', { keyPath: 'id' });
        open.onsuccess = () => {
          if (settled) open.result.close();
          else {
            settled = true;
            resolve(open.result);
          }
        };
        open.onerror = open.onblocked = () => {
          settled = true;
          reject(new SecretCryptoError('storage_unavailable'));
        };
      });
    } catch {
      throw new SecretCryptoError('storage_unavailable');
    }
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction('keys', mode);
        let result: T;
        let failure: unknown;
        const fail = (error: unknown) => {
          failure = error;
          transaction.abort();
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () =>
          reject(failure || new SecretCryptoError('storage_unavailable'));
        try {
          action(
            transaction.objectStore('keys'),
            (value) => {
              result = value;
            },
            fail,
          );
        } catch (error) {
          fail(error);
        }
      });
    } catch (error) {
      throw error instanceof SecretCryptoError
        ? error
        : new SecretCryptoError('storage_unavailable');
    } finally {
      db.close();
    }
  }

  read(accountId: string, roomId: string): Promise<unknown> {
    return this.transaction('readonly', (store, done) => {
      const request = store.get(secretRecordId(accountId, roomId));
      request.onsuccess = () => done(request.result);
    });
  }

  putIfAbsent(record: SecretKeyRecord): Promise<unknown> {
    return this.transaction('readwrite', (store, done, fail) => {
      const request = store.get(record.id);
      request.onsuccess = () => {
        try {
          if (request.result !== undefined) done(request.result);
          else {
            store.add(record);
            done(record);
          }
        } catch (error) {
          fail(error);
        }
      };
    });
  }

  pinPeer(
    accountId: string,
    roomId: string,
    ownKey: SecretPublicKey,
    peer: SecretPeerPin,
  ): Promise<unknown> {
    return this.transaction('readwrite', (store, done, fail) => {
      const request = store.get(secretRecordId(accountId, roomId));
      request.onsuccess = () => {
        try {
          const record = checkScope(request.result, accountId, roomId);
          if (!sameSecretPublicKey(record.publicKey, ownKey))
            throw new SecretCryptoError('key_changed');
          if (
            record.peer &&
            (record.peer.userId !== peer.userId ||
              !record.peer.publicKey ||
              !sameSecretPublicKey(record.peer.publicKey, peer.publicKey))
          ) {
            throw new SecretCryptoError('key_changed');
          }
          const pinned = { ...record, peer };
          store.put(pinned);
          done(pinned);
        } catch (error) {
          fail(error);
        }
      };
    });
  }
}
