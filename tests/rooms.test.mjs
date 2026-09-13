import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { build } = require('esbuild');
const sourceRoot = process.env.ROOMS_TEST_SOURCE_ROOT || process.cwd();
const sqlite = new DatabaseSync(':memory:');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const entry of journal.entries)
  sqlite.exec(await readFile(`drizzle/${entry.tag}.sql`, 'utf8'));
// During isolated proposal review the migration does not exist yet. Once the
// real append migration is generated, these tests use its actual tables.
if (
  !sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='chat_rooms'").get()
) {
  sqlite.exec(
    await readFile(
      path.join(sourceRoot, 'tests/fixtures/rooms-schema.sql'),
      'utf8',
    ),
  );
}
sqlite.exec(
  "INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1),('dave','Dave',1),('eve','Eve',1)",
);
sqlite.exec(
  "INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bob','bob',1),('carol','carol',1),('dave','dave',1),('eve','eve',1)",
);
let beforeWrite = null;
function statement(sql) {
  let values = [];
  const execute = (mode) => {
    if (/^(INSERT|UPDATE|DELETE)/.test(sql.trim()) && beforeWrite) {
      const hook = beforeWrite;
      beforeWrite = null;
      hook(sql);
    }
    try {
      return sqlite.prepare(sql)[mode](...values);
    } catch (error) {
      error.message += '\nSQL: ' + sql + '\nBinding count: ' + values.length;
      throw error;
    }
  };
  return {
    bind(...args) {
      values = args;
      return this;
    },
    async first() {
      return execute('get') || null;
    },
    async all() {
      return { results: execute('all') };
    },
    async run() {
      return { meta: { changes: Number(execute('run').changes) } };
    },
  };
}
globalThis.__roomsDb = {
  prepare: statement,
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const item of statements) results.push(await item.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};
const compiled = await build({
  entryPoints: [
    path.join(sourceRoot, 'lib/rooms.ts'),
    path.join(sourceRoot, 'lib/secret-format.ts'),
    path.join(sourceRoot, 'lib/account-removal.ts'),
  ],
  outdir: 'unused',
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  nodePaths: [path.join(process.cwd(), 'node_modules')],
  plugins: [
    {
      name: 'rooms-sqlite',
      setup(build) {
        build.onResolve({ filter: /^\.\/auth-session$/ }, () => ({
          path: 'auth',
          namespace: 'fixture-settings',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture-settings' }, () => ({
          contents: "export const setting=()=> '1';",
        }));
        build.onResolve({ filter: /^\.\/storage$/ }, () => ({
          path: 'storage',
          namespace: 'fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const db = () => globalThis.__roomsDb;',
        }));
      },
    },
  ],
});
const imported = async (name) =>
  import(
    'data:text/javascript;base64,' +
      Buffer.from(
        compiled.outputFiles.find((file) => file.path.endsWith(name + '.js'))
          .text,
      ).toString('base64')
  );
const api = await imported('rooms');
const format = await imported('secret-format');
const removal = await imported('account-removal');
let now = Date.now();
const change = (me, body) => api.changeRoom(me, body, ++now);
const deny = (promise, status = 403) =>
  assert.rejects(promise, (error) => error.status === status);
const send = (me, room, text, extra = {}) =>
  change(me, {
    action: 'send',
    id: room,
    key: crypto.randomUUID(),
    text,
    ...extra,
  });
const restrict = (user, mode = 'read_only') => {
  const event = crypto.randomUUID();
  sqlite
    .prepare(
      'INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,?,?,?,?)',
    )
    .run(event, user, 'alice', mode, 'test', now);
  sqlite
    .prepare(
      'INSERT OR REPLACE INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,?,?,?)',
    )
    .run(user, event, mode, 'test', now);
};
const unrestrict = (user) =>
  sqlite.prepare('DELETE FROM account_restrictions WHERE userId=?').run(user);

const group = await change('alice', {
  action: 'create',
  kind: 'group',
  name: 'Night group',
  description: 'Friends',
  memberIds: ['bob'],
});
assert.equal(group.members.length, 2);
assert.equal(group.canSend, true);
assert.equal(group.kind, 'group');
assert.equal((await api.listRooms('bob')).rooms.length, 1);
await deny(api.readRoom('carol', group.id), 404);
await deny(send('carol', group.id, 'foreign'), 404);
await deny(change('bob', { action: 'update', id: group.id, name: 'stolen' }));
await deny(change('bob', { action: 'invite', id: group.id }));
const first = await send('alice', group.id, 'hello');
await send('bob', group.id, 'reply', { replyTo: first.id });
assert.equal((await api.readRoom('bob', group.id)).messages.length, 2);
assert.equal((await api.listRooms('bob')).rooms[0].unread, 1);
await change('bob', { action: 'read', id: group.id, through: first.id });
assert.equal((await api.listRooms('bob')).rooms[0].unread, 0);
const later = await send('alice', group.id, 'arrived after fetch');
await change('bob', { action: 'read', id: group.id, through: first.id });
assert.equal(
  (await api.listRooms('bob')).rooms[0].unread,
  1,
  'Stale read acknowledgement preserves later unread messages',
);
await change('alice', {
  action: 'send',
  id: group.id,
  key: later.id,
  text: 'arrived after fetch',
});
await deny(
  change('alice', {
    action: 'send',
    id: group.id,
    key: later.id,
    text: 'different',
  }),
  409,
);
const sameClockA = crypto.randomUUID(),
  sameClockB = crypto.randomUUID();
await api.changeRoom(
  'alice',
  { action: 'send', id: group.id, key: sameClockA, text: 'same clock A' },
  now,
);
await change('bob', { action: 'read', id: group.id, through: sameClockA });
await api.changeRoom(
  'alice',
  { action: 'send', id: group.id, key: sameClockB, text: 'same clock B' },
  now - 10,
);
assert.equal(
  (await api.listRooms('bob')).rooms[0].unread,
  1,
  'Commit-time message ordering preserves unread messages under clock skew',
);
const other = await change('carol', {
  action: 'create',
  name: 'Other',
  memberIds: ['dave'],
});
await deny(
  send('alice', group.id, 'foreign reply', {
    replyTo: (await send('carol', other.id, 'private')).id,
  }),
);
await deny(
  change('bob', { action: 'deleteMessage', id: group.id, messageId: first.id }),
);
await change('alice', {
  action: 'deleteMessage',
  id: group.id,
  messageId: first.id,
});
assert.equal((await api.readRoom('bob', group.id)).messages[0].text, '');

const invite = await change('alice', { action: 'invite', id: group.id });
assert.match(invite.token, /^[a-f0-9]{64}$/);
assert.notEqual(
  sqlite
    .prepare('SELECT tokenHash FROM chat_room_invites WHERE roomId=?')
    .get(group.id).tokenHash,
  invite.token,
);
assert.equal(
  (await api.resolveRoomInvite('carol', invite.token)).room.id,
  group.id,
);
assert.equal(
  (await change('carol', { action: 'join', token: invite.token })).id,
  group.id,
);
const rotated = await change('alice', { action: 'invite', id: group.id });
await deny(api.resolveRoomInvite('dave', invite.token), 404);
await deny(change('dave', { action: 'join', token: invite.token }));
await change('alice', {
  action: 'removeMember',
  id: group.id,
  userId: 'carol',
});
await deny(change('carol', { action: 'join', token: rotated.token }));
await deny(
  change('alice', { action: 'addMember', id: group.id, userId: 'carol' }),
);
await deny(api.readRoom('carol', group.id), 404);
await change('alice', { action: 'invite', id: group.id, revoke: true });
await deny(api.resolveRoomInvite('dave', rotated.token), 404);
await change('alice', {
  action: 'update',
  id: group.id,
  visibility: 'public',
  username: 'night_group',
});
assert.equal(
  (await api.resolveGroup('dave', '@Night_Group')).room.label,
  'Группа',
);
assert.equal((await api.searchRooms('dave', 'night')).rooms[0].id, group.id);
assert.equal(
  (await api.searchRooms('dave', '_')).rooms.length,
  1,
  'Search underscores are literal',
);
await deny(
  change('carol', {
    action: 'create',
    name: 'Duplicate',
    visibility: 'public',
    username: 'NIGHT_GROUP',
  }),
  409,
);
assert.equal(
  (await change('dave', { action: 'join', username: 'night_group' })).id,
  group.id,
);
await deny(change('carol', { action: 'join', id: group.id }));
await change('alice', {
  action: 'role',
  id: group.id,
  userId: 'bob',
  role: 'admin',
});
await change('bob', {
  action: 'update',
  id: group.id,
  description: 'Edited by admin',
});
await deny(
  change('bob', {
    action: 'role',
    id: group.id,
    userId: 'dave',
    role: 'admin',
  }),
);
await deny(
  change('bob', { action: 'removeMember', id: group.id, userId: 'alice' }),
);
await change('alice', {
  action: 'role',
  id: group.id,
  userId: 'dave',
  role: 'admin',
});
await deny(
  change('bob', { action: 'removeMember', id: group.id, userId: 'dave' }),
);
await deny(change('alice', { action: 'leave', id: group.id }), 409);

restrict('bob');
assert.equal((await api.readRoom('bob', group.id)).canSend, false);
await deny(send('bob', group.id, 'read-only'));
await deny(
  change('bob', { action: 'update', id: group.id, name: 'read-only' }),
);
await change('bob', { action: 'leave', id: group.id });
unrestrict('bob');
await change('bob', { action: 'join', id: group.id });
assert.equal(
  (await api.readRoom('bob', group.id)).role,
  'member',
  'Leaving relinquishes administrative rights',
);
await change('alice', {
  action: 'role',
  id: group.id,
  userId: 'bob',
  role: 'admin',
});
restrict('dave', 'blocked');
await deny(api.listRooms('dave'));
await deny(api.readRoom('dave', group.id), 404);
unrestrict('dave');

// Mutations re-check live authority in the actual SQLite statement.
beforeWrite = () => restrict('bob');
await deny(send('bob', group.id, 'restriction race'));
unrestrict('bob');
beforeWrite = () =>
  sqlite
    .prepare(
      "UPDATE chat_room_members SET role='member' WHERE roomId=? AND userId='bob'",
    )
    .run(group.id);
await deny(
  change('bob', { action: 'update', id: group.id, name: 'demotion race' }),
);
assert.equal((await api.readRoom('alice', group.id)).name, 'Night group');
beforeWrite = () =>
  sqlite
    .prepare(
      "UPDATE chat_room_members SET status='banned' WHERE roomId=? AND userId='bob'",
    )
    .run(group.id);
await deny(send('bob', group.id, 'kick race'));
sqlite
  .prepare(
    "UPDATE chat_room_members SET status='active',role='admin' WHERE roomId=? AND userId='bob'",
  )
  .run(group.id);
const privateRace = await change('alice', {
  action: 'create',
  name: 'Invite race',
});
const raceInvite = await change('alice', {
  action: 'invite',
  id: privateRace.id,
});
beforeWrite = () =>
  sqlite
    .prepare('DELETE FROM chat_room_invites WHERE roomId=?')
    .run(privateRace.id);
await deny(change('eve', { action: 'join', token: raceInvite.token }));
sqlite
  .prepare(
    "INSERT INTO user_privacy(userId,messagePolicy) VALUES('eve','nobody')",
  )
  .run();
await deny(
  change('alice', { action: 'addMember', id: group.id, userId: 'eve' }),
);
await deny(
  change('alice', { action: 'create', kind: 'secret', peerId: 'eve' }),
);
sqlite.prepare("DELETE FROM user_privacy WHERE userId='eve'").run();
beforeWrite = () =>
  sqlite
    .prepare(
      "INSERT INTO user_privacy(userId,messagePolicy) VALUES('eve','nobody')",
    )
    .run();
await deny(
  change('alice', { action: 'create', kind: 'secret', peerId: 'eve' }),
);
sqlite.prepare("DELETE FROM user_privacy WHERE userId='eve'").run();

await change('alice', {
  action: 'role',
  id: group.id,
  userId: 'bob',
  role: 'owner',
});
const transferred = await api.readRoom('bob', group.id);
assert.equal(transferred.ownerId, 'bob');
assert.equal(transferred.role, 'owner');
assert.equal(transferred.members.filter((m) => m.role === 'owner').length, 1);
await change('alice', { action: 'leave', id: group.id });
await deny(api.readRoom('alice', group.id), 404);

const secret = await change('carol', {
  action: 'create',
  kind: 'secret',
  peerId: 'eve',
});
assert.equal(secret.members.length, 2);
assert.equal(secret.canSend, false);
assert.equal((await api.readRoom('eve', secret.id)).messages.length, 0);
await deny(send('carol', secret.id, 'must not store plaintext'), 400);
await deny(change('carol', { action: 'invite', id: secret.id }), 400);
await deny(
  change('carol', { action: 'addMember', id: secret.id, userId: 'alice' }),
  400,
);
assert.ok(!(await api.searchRooms('alice', 'Секретный')).rooms.length);
const keyFor = async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y };
};
const carolKey = await keyFor(),
  eveKey = await keyFor();
await change('carol', {
  action: 'acceptSecret',
  id: secret.id,
  publicKey: carolKey,
});
await change('carol', {
  action: 'acceptSecret',
  id: secret.id,
  publicKey: carolKey,
});
await deny(
  change('carol', {
    action: 'acceptSecret',
    id: secret.id,
    publicKey: await keyFor(),
  }),
  409,
);
await deny(
  change('eve', {
    action: 'acceptSecret',
    id: secret.id,
    publicKey: { ...eveKey, d: 'private' },
  }),
  400,
);
await deny(
  change('eve', { action: 'acceptSecret', id: secret.id, publicKey: carolKey }),
  409,
);
await change('eve', {
  action: 'acceptSecret',
  id: secret.id,
  publicKey: eveKey,
});
const ready = await api.readRoom('carol', secret.id);
assert.equal(ready.canSend, true);
const secretId = crypto.randomUUID();
const header = await format.secretProtectedHeader({
  roomId: secret.id,
  messageId: secretId,
  senderId: 'carol',
  members: ready.members,
});
// The server deliberately has no decryption key. Shape validation is separate
// from client AEAD authentication, which is covered by crypto-specific tests.
const ciphertext = [
  Buffer.from(JSON.stringify(header)).toString('base64url'),
  '',
  Buffer.alloc(12, 1).toString('base64url'),
  Buffer.from('ciphertext').toString('base64url'),
  Buffer.alloc(16, 2).toString('base64url'),
].join('.');
await change('carol', {
  action: 'send',
  id: secret.id,
  key: secretId,
  ciphertext,
});
await change('carol', {
  action: 'send',
  id: secret.id,
  key: secretId,
  ciphertext,
});
assert.equal(
  (await api.readRoom('eve', secret.id)).messages[0].ciphertext,
  ciphertext,
);
assert.equal(
  (await api.listRooms('eve')).rooms.find((r) => r.id === secret.id).lastMessage
    .text,
  '',
);
await deny(
  change('carol', {
    action: 'send',
    id: secret.id,
    key: crypto.randomUUID(),
    ciphertext,
  }),
  400,
);
await deny(
  change('carol', {
    action: 'send',
    id: secret.id,
    key: secretId,
    ciphertext,
    text: '',
  }),
  400,
);
sqlite
  .prepare(
    "INSERT INTO user_privacy(userId,messagePolicy) VALUES('eve','nobody')",
  )
  .run();
assert.equal((await api.readRoom('carol', secret.id)).canSend, false);
await deny(
  change('carol', { action: 'send', id: secret.id, key: secretId, ciphertext }),
);
sqlite.prepare("DELETE FROM user_privacy WHERE userId='eve'").run();
beforeWrite = () =>
  sqlite
    .prepare(
      "INSERT INTO user_blocks(blocker,blocked,created) VALUES('eve','carol',?)",
    )
    .run(now);
await deny(
  change('carol', { action: 'send', id: secret.id, key: secretId, ciphertext }),
);
sqlite.prepare("DELETE FROM user_blocks WHERE blocker='eve'").run();
await change('eve', { action: 'leave', id: secret.id });
await deny(api.readRoom('carol', secret.id), 404);
await deny(change('eve', { action: 'join', id: secret.id }));

// Limit and cursor checks operate on realistic independent member/message rows.
const full = await change('alice', {
  action: 'create',
  name: 'Full',
  visibility: 'public',
  username: 'full_room',
});
for (let index = 0; index < 199; index++) {
  sqlite
    .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
    .run('guest' + index, 'Guest', now);
  sqlite
    .prepare(
      "INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt) VALUES(?,?,'member','active',?)",
    )
    .run(full.id, 'guest' + index, now);
}
await deny(change('eve', { action: 'join', id: full.id }));
await deny(
  change('alice', { action: 'addMember', id: full.id, userId: 'eve' }),
);
for (let index = 0; index < 105; index++)
  await send('alice', full.id, 'Message ' + index);
const page = await api.readRoom('alice', full.id);
assert.equal(page.messages.length, 100);
assert.ok(page.nextCursor);
const older = await api.readRoom('alice', full.id, page.nextCursor);
assert.equal(older.messages.length, 5);
assert.equal(older.nextCursor, null);
assert.ok(older.messages.at(-1).created < page.messages[0].created);
assert.equal(
  sqlite.prepare('SELECT COUNT(*) AS count FROM messages').get().count,
  0,
  'Legacy direct message table is untouched',
);

const exportSections = api.groupRoomExportSections('guest0');
assert.deepEqual(
  exportSections.map((s) => s.name),
  ['groups', 'groupMessages', 'groupMessageReactions'],
);
const exportPage = await exportSections[1].page('');
assert.equal(exportPage.rows.length, 100);
assert.ok(
  exportPage.rows.every(
    (message) =>
      message.roomId === full.id &&
      !('ciphertext' in message) &&
      !('publicKey' in message),
  ),
);
sqlite
  .prepare(
    "UPDATE chat_room_members SET status='left' WHERE roomId=? AND userId='guest0'",
  )
  .run(full.id);
assert.equal(
  (await exportSections[1].page(exportPage.next)).rows.length,
  0,
  'Export repeats membership checks on every streamed page',
);
sqlite
  .prepare(
    "UPDATE chat_room_members SET status='active' WHERE roomId=? AND userId='guest0'",
  )
  .run(full.id);

sqlite
  .prepare(
    "INSERT INTO users(id,name,created) VALUES('delete-me','Delete account',?)",
  )
  .run(now);
sqlite
  .prepare(
    "INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) VALUES('delete-session','delete-me',?,?,?)",
  )
  .run(now, now + 86400000, now);
const survivor = await change('carol', {
  action: 'create',
  name: 'Survives member deletion',
  memberIds: ['delete-me'],
});
await send('delete-me', survivor.id, 'Erase this authored message');
await send('carol', survivor.id, 'Keep the other member message');
const sharedOwned = await change('delete-me', {
  action: 'create',
  name: 'Transfer before deletion',
  memberIds: ['carol'],
});
const onlyOwned = await change('delete-me', {
  action: 'create',
  name: 'Solo owner',
  visibility: 'public',
  username: 'released_after_deletion',
});
const privateOwned = await change('delete-me', {
  action: 'create',
  name: 'Solo private',
});
await change('delete-me', { action: 'invite', id: privateOwned.id });
const ownedSecret = await change('delete-me', {
  action: 'create',
  kind: 'secret',
  peerId: 'eve',
});
const invitedSecret = await change('dave', {
  action: 'create',
  kind: 'secret',
  peerId: 'delete-me',
});
for (const room of [ownedSecret, invitedSecret]) {
  sqlite
    .prepare(
      "UPDATE chat_room_members SET publicKey='retained public key' WHERE roomId=?",
    )
    .run(room.id);
  sqlite
    .prepare(
      "INSERT INTO chat_room_messages(id,roomId,sender,ciphertext,created) VALUES(?,?,?,'retained ciphertext',?)",
    )
    .run(crypto.randomUUID(), room.id, room.ownerId, now);
}
const archive = await api.groupRoomExportSections('delete-me')[0].page('');
assert.ok(archive.rows.every((room) => room.kind === 'group'));
assert.ok(!JSON.stringify(archive).includes(ownedSecret.id));
await assert.rejects(
  removal.deleteAccount('delete-me', 'delete-session', false),
  (error) => error.status === 409 && error.code === 'GROUP_OWNERSHIP_REQUIRED',
);
assert.equal(
  sqlite.prepare("SELECT deletedAt FROM users WHERE id='delete-me'").get()
    .deletedAt,
  0,
);
await change('delete-me', {
  action: 'role',
  id: sharedOwned.id,
  userId: 'carol',
  role: 'owner',
});
beforeWrite = () =>
  sqlite
    .prepare(
      "INSERT INTO chat_room_members(roomId,userId,joinedAt) VALUES(?,'eve',?)",
    )
    .run(onlyOwned.id, now);
await deny(removal.deleteAccount('delete-me', 'delete-session', false), 409);
assert.equal(
  sqlite
    .prepare(
      "SELECT COUNT(*) n FROM account_deletions WHERE userId='delete-me'",
    )
    .get().n,
  0,
  'Joining before the account deletion commit blocks the entire deletion',
);
assert.equal(
  sqlite
    .prepare('SELECT COUNT(*) n FROM chat_room_messages WHERE roomId=?')
    .get(ownedSecret.id).n,
  1,
  'A denied deletion cannot purge secret data',
);
sqlite
  .prepare("DELETE FROM chat_room_members WHERE roomId=? AND userId='eve'")
  .run(onlyOwned.id);
await removal.deleteAccount('delete-me', 'delete-session', false);
assert.ok(
  sqlite.prepare("SELECT deletedAt FROM users WHERE id='delete-me'").get()
    .deletedAt > 0,
);
assert.equal(
  sqlite
    .prepare(
      "SELECT COUNT(*) n FROM chat_room_members WHERE userId='delete-me'",
    )
    .get().n,
  0,
);
assert.equal(
  sqlite
    .prepare(
      "SELECT COUNT(*) n FROM chat_room_messages WHERE sender='delete-me'",
    )
    .get().n,
  0,
);
assert.equal(
  sqlite
    .prepare(
      "SELECT COUNT(*) n FROM chat_room_invites WHERE createdBy='delete-me'",
    )
    .get().n,
  0,
);
for (const room of [ownedSecret, invitedSecret, onlyOwned, privateOwned]) {
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) n FROM chat_rooms WHERE id=?').get(room.id)
      .n,
    0,
  );
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) n FROM chat_room_messages WHERE roomId=?')
      .get(room.id).n,
    0,
  );
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) n FROM chat_room_members WHERE roomId=?')
      .get(room.id).n,
    0,
  );
}
assert.equal((await api.readRoom('carol', survivor.id)).messages.length, 1);
assert.equal((await api.readRoom('carol', sharedOwned.id)).ownerId, 'carol');
await change('dave', {
  action: 'create',
  name: 'Released username',
  visibility: 'public',
  username: 'released_after_deletion',
});
// Personal archive keeps membership, unread markers and history intact.
await change('carol', { action: 'archive', id: survivor.id, archived: true });
await change('carol', { action: 'archive', id: survivor.id, archived: true });
assert.equal(
  (await api.listRooms('carol')).rooms.some((r) => r.id === survivor.id),
  false,
);
assert.equal(
  (await api.listRooms('carol', true)).rooms.some((r) => r.id === survivor.id),
  true,
);
assert.equal((await api.readRoom('carol', survivor.id)).messages.length, 1);
await change('carol', { action: 'archive', id: survivor.id, archived: false });
assert.equal(
  (await api.listRooms('carol')).rooms.some((r) => r.id === survivor.id),
  true,
);
// Reply navigation stays bounded even when the target is far outside the current page.
const navigationRoom = await change('alice', {
  action: 'create',
  name: 'Navigation',
  memberIds: ['bob'],
});
const insertHistory = sqlite.prepare(
  'INSERT INTO chat_room_messages(id,roomId,sender,text,created,replyTo) VALUES(?,?,?,?,?,?)',
);
for (let i = 0; i < 230; i++)
  insertHistory.run(
    'navigation-' + String(i).padStart(3, '0'),
    navigationRoom.id,
    'alice',
    'Message ' + i,
    now,
    i === 229 ? 'navigation-005' : null,
  );
const recent = await api.readRoom('bob', navigationRoom.id);
assert.equal(recent.messages.length, 100);
assert.equal(recent.messages.at(-1).replyText, 'Message 5');
assert.equal(recent.messages.at(-1).replyUnavailable, false);
const centered = await api.readRoom(
  'bob',
  navigationRoom.id,
  null,
  'navigation-080',
);
assert.equal(centered.messages.length, 100);
assert.ok(centered.messages.some((m) => m.id === 'navigation-080'));
assert.ok(centered.nextCursor);
assert.ok(centered.pageCursor);
assert.deepEqual(
  (
    await api.readRoom('bob', navigationRoom.id, centered.pageCursor)
  ).messages.map((m) => m.id),
  centered.messages.map((m) => m.id),
);
assert.equal(
  (await api.readRoom('bob', navigationRoom.id, null, 'navigation-229'))
    .pageCursor,
  null,
);
await deny(
  api.readRoom('carol', navigationRoom.id, null, 'navigation-080'),
  404,
);
await deny(api.readRoom('alice', survivor.id, null, 'navigation-080'), 404);
await deny(
  api.readRoom('bob', navigationRoom.id, centered.pageCursor, 'navigation-080'),
  400,
);
sqlite
  .prepare("UPDATE chat_room_messages SET deletedAt=1,text='' WHERE id=?")
  .run('navigation-005');
await deny(api.readRoom('bob', navigationRoom.id, null, 'navigation-005'), 404);
assert.equal(
  (await api.readRoom('bob', navigationRoom.id)).messages.at(-1)
    .replyUnavailable,
  true,
);
assert.equal(
  (await api.readRoom('bob', navigationRoom.id)).messages.at(-1).replyText,
  null,
);
// Muting belongs to one member, persists, and never acknowledges unread history.
const memberBefore = sqlite
  .prepare('SELECT * FROM chat_room_members WHERE roomId=? AND userId=?')
  .get(navigationRoom.id, 'bob');
const mute = (muted, extra = {}) =>
  api.saveRoomNotifications('bob', {
    actor: 'bob',
    id: navigationRoom.id,
    muted,
    ...extra,
  });
assert.equal(
  (await api.readRoomNotifications('bob', navigationRoom.id)).muted,
  false,
);
await mute(true);
assert.equal(
  (await api.listRooms('bob')).rooms.find((r) => r.id === navigationRoom.id)
    .muted,
  true,
);
assert.equal(
  (await api.readRoomNotifications('alice', navigationRoom.id)).muted,
  false,
);
assert.equal((await api.readRoom('bob', navigationRoom.id)).unread, 229);
assert.deepEqual(
  {
    ...sqlite
      .prepare('SELECT * FROM chat_room_members WHERE roomId=? AND userId=?')
      .get(navigationRoom.id, 'bob'),
    muted: 0,
  },
  { ...memberBefore },
);
restrict('bob');
await mute(false);
assert.equal(
  (await api.readRoomNotifications('bob', navigationRoom.id)).muted,
  false,
);
unrestrict('bob');
await deny(mute('true'), 400);
await deny(mute(true, { actor: 'alice' }), 401);
await deny(
  api.saveRoomNotifications('carol', {
    actor: 'carol',
    id: navigationRoom.id,
    muted: true,
  }),
  404,
);
beforeWrite = () =>
  sqlite
    .prepare(
      "UPDATE chat_room_members SET status='banned' WHERE roomId=? AND userId='bob'",
    )
    .run(navigationRoom.id);
await deny(mute(true), 404);
assert.equal(
  sqlite
    .prepare(
      "SELECT muted FROM chat_room_members WHERE roomId=? AND userId='bob'",
    )
    .get(navigationRoom.id).muted,
  0,
);
console.log(
  'Room integration passed: membership, roles, invites, discovery, privacy, restrictions, races, secret envelopes, limits and pagination.',
);
sqlite.close();
delete globalThis.__roomsDb;
