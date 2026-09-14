import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const roomId = 'room:noctgram-community';
const migrationTag = '0043_default_community_group';
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
const migrationIndex = journal.entries.find(
  (entry) => entry.tag === migrationTag,
)?.idx;
assert.ok(
  Number.isInteger(migrationIndex),
  'Community migration must be in the journal',
);
const previousMigrations = await Promise.all(
  journal.entries
    .filter((entry) => entry.idx < migrationIndex)
    .map((entry) => readFile(`drizzle/${entry.tag}.sql`, 'utf8')),
);
const migration = await readFile(`drizzle/${migrationTag}.sql`, 'utf8');
const laterMigrations = await Promise.all(
  journal.entries
    .filter((entry) => entry.idx > migrationIndex)
    .map((entry) => readFile(`drizzle/${entry.tag}.sql`, 'utf8')),
);
const upgraded = new WeakSet();
function migrate(sqlite) {
  sqlite.exec(migration);
  if (!upgraded.has(sqlite)) {
    for (const sql of laterMigrations) sqlite.exec(sql);
    upgraded.add(sqlite);
  }
}

// Run the production room API against a real, isolated SQLite database. The
// shim replaces only the D1 transport and deployment settings, not room logic.
const compiled = await build({
  entryPoints: [path.join(root, 'lib/rooms.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'community-test-storage',
      setup(build) {
        build.onResolve({ filter: /^\.\/storage$/ }, () => ({
          path: 'storage',
          namespace: 'community-test-storage',
        }));
        build.onLoad(
          { filter: /.*/, namespace: 'community-test-storage' },
          () => ({
            contents: 'export const db = () => globalThis.__communityTestDb;',
          }),
        );
        build.onResolve({ filter: /^\.\/auth-session$/ }, () => ({
          path: 'settings',
          namespace: 'community-test-settings',
        }));
        build.onLoad(
          { filter: /.*/, namespace: 'community-test-settings' },
          () => ({
            contents: "export const setting = () => '1'; export const tokenHash=async value=>value;",
          }),
        );
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const sql of previousMigrations) sqlite.exec(sql);
  const statement = (sql) => {
    let values = [];
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      async run() {
        return {
          meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
        };
      },
    };
  };
  globalThis.__communityTestDb = {
    prepare: statement,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const query of statements) result.push(await query.run());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return sqlite;
}
async function withFixture(callback) {
  const sqlite = fixture();
  try {
    await callback(sqlite);
  } finally {
    sqlite.close();
    delete globalThis.__communityTestDb;
  }
}
function person(sqlite, id, options = {}) {
  sqlite
    .prepare(`INSERT INTO users(id,name,kind,onboardingComplete,deletedAt,created)
    VALUES(?,?,?,?,?,?)`)
    .run(
      id,
      id,
      options.kind ?? 'person',
      options.complete ?? 1,
      options.deletedAt ?? 0,
      options.created ?? 1,
    );
}
const grantAdmin = (sqlite, id, created = 1) =>
  sqlite
    .prepare('INSERT INTO administrators(userId,created) VALUES(?,?)')
    .run(id, created);
const member = (sqlite, id) =>
  sqlite
    .prepare('SELECT * FROM chat_room_members WHERE roomId=? AND userId=?')
    .get(roomId, id);
const room = (sqlite) =>
  sqlite.prepare('SELECT * FROM chat_rooms WHERE id=?').get(roomId);
const members = (sqlite) =>
  sqlite
    .prepare(
      'SELECT userId FROM chat_room_members WHERE roomId=? ORDER BY userId',
    )
    .all(roomId)
    .map((row) => row.userId);
const deny = (promise, status = 403) =>
  assert.rejects(promise, (error) => error.status === status);

await test('migration backfills every completed person and uses a real administrator as owner', async () => {
  await withFixture(async (sqlite) => {
    person(sqlite, 'local_seedy');
    person(sqlite, 'other-admin');
    person(sqlite, 'root-impostor');
    sqlite
      .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
      .run('root', 'root-impostor');
    grantAdmin(sqlite, 'other-admin', 1);
    grantAdmin(sqlite, 'local_seedy', 2);
    for (let index = 0; index < 205; index++)
      person(sqlite, `existing-${index}`);
    person(sqlite, 'incomplete', { complete: 0 });
    person(sqlite, 'deleted', { deletedAt: 5 });
    person(sqlite, 'channel', { kind: 'channel' });
    person(sqlite, 'noctgram');

    migrate(sqlite);
    const created = room(sqlite);
    assert.equal(created.name, 'Noctgram | Общение');
    assert.equal(created.ownerId, 'local_seedy');
    assert.equal(created.kind, 'group');
    assert.equal(created.visibility, 'private');
    assert.equal(created.username, null);
    assert.equal(created.avatar, '/assets/noctgram-logo.png');
    assert.equal(created.deletedAt, 0);
    assert.equal(member(sqlite, 'local_seedy').role, 'owner');
    assert.equal(member(sqlite, 'root-impostor').role, 'member');
    const expected = sqlite
      .prepare(`SELECT id FROM users WHERE kind='person'
      AND deletedAt=0 AND onboardingComplete=1 AND id<>'noctgram' ORDER BY id`)
      .all()
      .map((row) => row.id);
    assert.deepEqual(members(sqlite), expected);
    assert.ok(expected.length > 200);

    const listed = (await api.listRooms('existing-0')).rooms;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, roomId);
    assert.equal(listed[0].memberCount, expected.length);
    assert.equal((await api.readRoom('existing-0', roomId)).canSend, true);
    const detail = await api.readRoom('existing-204', roomId);
    assert.equal(detail.memberCount, expected.length);
    assert.equal(detail.members.length, 200);
    assert.ok(detail.members.some((item) => item.userId === 'existing-204'));
    assert.ok(
      detail.members.some(
        (item) => item.userId === 'local_seedy' && item.role === 'owner',
      ),
    );
    await deny(api.readRoom('incomplete', roomId), 404);
    await deny(api.readRoom('deleted', roomId), 404);
    await deny(api.readRoom('channel', roomId), 404);
  });
});

await test('empty installs wait for a real administrator and later grants backfill existing users', async () => {
  await withFixture(async (sqlite) => {
    migrate(sqlite);
    person(sqlite, 'local_seedy');
    person(sqlite, 'root-handle');
    sqlite
      .prepare('INSERT INTO handles(handle,userId,main) VALUES(?,?,1)')
      .run('root', 'root-handle');
    assert.equal(
      room(sqlite),
      undefined,
      'A familiar ID or handle never confers ownership',
    );
    person(sqlite, 'actual-admin');
    person(sqlite, 'waiting');
    person(sqlite, 'incomplete', { complete: 0 });
    grantAdmin(sqlite, 'actual-admin');
    assert.equal(room(sqlite).ownerId, 'actual-admin');
    assert.equal(member(sqlite, 'actual-admin').role, 'owner');
    assert.equal(member(sqlite, 'waiting').status, 'active');
    assert.equal(member(sqlite, 'incomplete'), undefined);
    grantAdmin(sqlite, 'local_seedy');
    assert.equal(
      room(sqlite).ownerId,
      'actual-admin',
      'Later grants do not seize an existing group',
    );
    assert.equal((await api.listRooms('waiting')).rooms[0].id, roomId);
  });
});

await test('completed registrations enroll automatically; incomplete and excluded accounts do not', async () => {
  await withFixture(async (sqlite) => {
    migrate(sqlite);
    person(sqlite, 'pending-admin', { complete: 0 });
    grantAdmin(sqlite, 'pending-admin');
    person(sqlite, 'waiting');
    assert.equal(room(sqlite), undefined);
    sqlite
      .prepare('UPDATE users SET onboardingComplete=1 WHERE id=?')
      .run('pending-admin');
    assert.equal(room(sqlite).ownerId, 'pending-admin');
    assert.equal(member(sqlite, 'waiting').status, 'active');

    person(sqlite, 'new-complete');
    person(sqlite, 'new-incomplete', { complete: 0 });
    person(sqlite, 'new-deleted', { deletedAt: 5, complete: 0 });
    person(sqlite, 'new-channel', { kind: 'channel', complete: 0 });
    person(sqlite, 'noctgram', { complete: 0 });
    assert.equal(member(sqlite, 'new-complete').status, 'active');
    assert.equal(member(sqlite, 'new-incomplete'), undefined);
    sqlite.exec(`UPDATE users SET onboardingComplete=1
      WHERE id IN ('new-incomplete','new-deleted','new-channel','noctgram')`);
    assert.equal(member(sqlite, 'new-incomplete').status, 'active');
    for (const id of ['new-deleted', 'new-channel', 'noctgram'])
      assert.equal(member(sqlite, id), undefined, id);
    assert.equal((await api.listRooms('new-incomplete')).rooms[0].id, roomId);
  });
});

await test('enrollment events preserve leave, ban, archive, roles and read position', async () => {
  await withFixture(async (sqlite) => {
    person(sqlite, 'owner');
    grantAdmin(sqlite, 'owner');
    for (const id of ['left', 'banned', 'archived', 'room-admin'])
      person(sqlite, id);
    migrate(sqlite);
    await api.changeRoom('left', { action: 'leave', id: roomId });
    await api.changeRoom('owner', {
      action: 'removeMember',
      id: roomId,
      userId: 'banned',
    });
    await api.changeRoom('owner', {
      action: 'role',
      id: roomId,
      userId: 'room-admin',
      role: 'admin',
    });
    await api.changeRoom('archived', {
      action: 'archive',
      id: roomId,
      archived: true,
    });
    const messageId = crypto.randomUUID();
    await api.changeRoom('owner', {
      action: 'send',
      id: roomId,
      key: messageId,
      text: 'Welcome',
    });
    await api.changeRoom('archived', {
      action: 'read',
      id: roomId,
      through: messageId,
    });
    const ids = ['owner', 'left', 'banned', 'archived', 'room-admin'];
    const previous = ids.map((id) => member(sqlite, id));

    sqlite.exec(
      'UPDATE users SET onboardingComplete=1 WHERE onboardingComplete=1',
    );
    sqlite.exec(
      "UPDATE users SET onboardingComplete=0 WHERE id IN ('left','banned')",
    );
    sqlite.exec(
      "UPDATE users SET onboardingComplete=1 WHERE id IN ('left','banned')",
    );
    person(sqlite, 'later-admin');
    grantAdmin(sqlite, 'later-admin');
    migrate(sqlite);
    migrate(sqlite);
    assert.deepEqual(
      ids.map((id) => member(sqlite, id)),
      previous,
    );
    assert.equal((await api.listRooms('left')).rooms.length, 0);
    assert.equal((await api.listRooms('banned')).rooms.length, 0);
    assert.equal((await api.listRooms('archived')).rooms.length, 0);
    assert.equal((await api.listRooms('archived', true)).rooms[0].id, roomId);
    assert.equal(
      (await api.readRoom('archived', roomId)).messages[0].text,
      'Welcome',
    );
    await deny(api.readRoom('left', roomId), 404);
    await deny(api.readRoom('banned', roomId), 404);
  });
});

await test('community rejoin and member additions exceed 200 while ordinary groups keep their cap', async () => {
  await withFixture(async (sqlite) => {
    person(sqlite, 'owner');
    grantAdmin(sqlite, 'owner');
    migrate(sqlite);
    for (let index = 0; index < 205; index++) person(sqlite, `member-${index}`);
    person(sqlite, 'returning');
    person(sqlite, 'added');
    person(sqlite, 'banned');
    await api.changeRoom('returning', { action: 'leave', id: roomId });
    await api.changeRoom('added', { action: 'leave', id: roomId });
    const invite = await api.changeRoom('owner', {
      action: 'invite',
      id: roomId,
    });
    assert.equal(
      (
        await api.changeRoom('returning', {
          action: 'join',
          token: invite.token,
        })
      ).id,
      roomId,
    );
    await api.changeRoom('owner', {
      action: 'addMember',
      id: roomId,
      userId: 'added',
    });
    assert.equal(member(sqlite, 'added').status, 'active');
    await api.changeRoom('owner', {
      action: 'removeMember',
      id: roomId,
      userId: 'banned',
    });
    await deny(
      api.changeRoom('banned', { action: 'join', token: invite.token }),
    );
    await deny(
      api.changeRoom('owner', {
        action: 'addMember',
        id: roomId,
        userId: 'banned',
      }),
    );

    const ordinary = await api.changeRoom('owner', {
      action: 'create',
      name: 'Ordinary',
      visibility: 'public',
      username: 'ordinary_group',
    });
    const add =
      sqlite.prepare(`INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt)
      VALUES(?,?,'member','active',1)`);
    for (let index = 0; index < 199; index++)
      add.run(ordinary.id, `member-${index}`);
    await deny(api.changeRoom('added', { action: 'join', id: ordinary.id }));
    await deny(
      api.changeRoom('owner', {
        action: 'addMember',
        id: ordinary.id,
        userId: 'added',
      }),
    );
    assert.equal((await api.readRoom('owner', ordinary.id)).memberCount, 200);
  });
});
