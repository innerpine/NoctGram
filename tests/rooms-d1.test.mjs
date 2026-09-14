/** In-memory workerd/D1 test: real parser limits, 199 initial members, and secret SQL. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const sourceRoot = process.env.ROOMS_TEST_SOURCE_ROOT || root;
const require = createRequire(join(root, 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { build } = require('esbuild');

void test(
  'room API works within real Cloudflare D1 SQL and parameter limits',
  { timeout: 180000 },
  async (t) => {
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script:
          'export default { fetch() { return new Response("Test D1 only",{status:404}); } };',
        compatibilityDate: '2026-05-15',
        d1Databases: ['DB'],
        d1Persist: false,
        cachePersist: false,
        durableObjectsPersist: false,
        outboundService: () => {
          throw new Error('External network forbidden.');
        },
      }),
    );
    t.after(() => mf.dispose());
    const d = await mf.getD1Database('DB');
    for (const migration of JSON.parse(
      readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8'),
    ).entries) {
      for (const sql of readFileSync(
        join(root, 'drizzle', migration.tag + '.sql'),
        'utf8',
      ).split('--> statement-breakpoint')) {
        if (sql.trim()) await d.prepare(sql).run();
      }
    }
    if (
      !(await d
        .prepare("SELECT 1 FROM sqlite_master WHERE name='chat_rooms'")
        .first())
    ) {
      for (const sql of readFileSync(
        join(sourceRoot, 'tests/fixtures/rooms-schema.sql'),
        'utf8',
      ).split(';')) {
        if (sql.trim()) await d.prepare(sql).run();
      }
    }
    globalThis.__realRoomsDb = d;
    t.after(() => {
      delete globalThis.__realRoomsDb;
    });
    const compiled = await build({
      entryPoints: [
        join(sourceRoot, 'lib/rooms.ts'),
        join(sourceRoot, 'lib/secret-format.ts'),
        join(sourceRoot, 'lib/account-removal.ts'),
      ],
      outdir: 'unused',
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      nodePaths: [join(root, 'node_modules')],
      plugins: [
        {
          name: 'real-d1-binding',
          setup(build) {
            build.onResolve({ filter: /^\.\/auth-session$/ }, () => ({
              path: 'auth',
              namespace: 'fixture-settings',
            }));
            build.onLoad(
              { filter: /.*/, namespace: 'fixture-settings' },
              () => ({ contents: "export const setting=()=> '1'; export const tokenHash=async value=>value;" }),
            );
            build.onResolve({ filter: /^\.\/storage$/ }, () => ({
              path: 'storage',
              namespace: 'test',
            }));
            build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
              contents: 'export const db = () => globalThis.__realRoomsDb;',
            }));
          },
        },
      ],
    });
    const load = (name) =>
      import(
        'data:text/javascript;base64,' +
          Buffer.from(
            compiled.outputFiles.find((f) => f.path.endsWith(name + '.js'))
              .text,
          ).toString('base64')
      );
    const api = await load('rooms'),
      format = await load('secret-format'),
      removal = await load('account-removal');
    const users = [
      'owner',
      'peer',
      'stranger',
      ...Array.from({ length: 199 }, (_, i) => 'initial-' + i),
    ];
    await d.batch(
      users.map((user) =>
        d
          .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
          .bind(user, user, Date.now()),
      ),
    );
    const change = (me, body) => api.changeRoom(me, body);
    const key = () => crypto.randomUUID();
    const largePayload = {
      action: 'create',
      key: key(),
      kind: 'group',
      name: '200 people',
      visibility: 'public',
      username: 'large_group',
      memberIds: users.slice(3),
    };
    const full = await change('owner', largePayload);
    assert.equal(
      (await change('owner', largePayload)).id,
      full.id,
      'A full-room creation retry remains idempotent',
    );
    assert.equal(full.members.length, 200);
    assert.equal(full.memberCount, 200);
    assert.equal(full.canSend, true);
    assert.equal((await api.listRooms('initial-0')).rooms[0].id, full.id);
    assert.equal(
      (await api.searchRooms('peer', 'large')).rooms[0].memberCount,
      200,
    );
    assert.equal(
      (await api.resolveGroup('peer', 'large_group')).room.id,
      full.id,
    );
    await assert.rejects(
      change('peer', { action: 'join', id: full.id }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      change('owner', { action: 'addMember', id: full.id, userId: 'peer' }),
      (e) => e.status === 403,
    );
    assert.equal(
      (await change('initial-0', { action: 'join', id: full.id })).id,
      full.id,
    );
    const message = await change('owner', {
      action: 'send',
      id: full.id,
      key: key(),
      text: 'A real D1 group message',
    });
    const react = (emoji) =>
      change('initial-0', {
        action: 'reaction',
        id: full.id,
        messageId: message.id,
        emoji,
      });
    await react('❤️');
    await react('❤️');
    assert.deepEqual(
      (await api.readRoom('initial-0', full.id)).messages[0].reactions,
      [{ emoji: '❤️', count: 1, own: true }],
    );
    await react('🔥');
    assert.deepEqual(
      (await api.readRoom('owner', full.id)).messages[0].reactions,
      [{ emoji: '🔥', count: 1, own: false }],
    );
    await react(null);
    await react(null);
    assert.deepEqual(
      (await api.readRoom('owner', full.id)).messages[0].reactions,
      [],
    );
    await change('initial-0', {
      action: 'send',
      id: full.id,
      key: key(),
      text: 'Reply',
      replyTo: message.id,
    });
    await change('initial-0', {
      action: 'read',
      id: full.id,
      through: message.id,
    });
    await change('owner', {
      action: 'role',
      id: full.id,
      userId: 'initial-0',
      role: 'admin',
    });
    await change('initial-0', {
      action: 'removeMember',
      id: full.id,
      userId: 'initial-1',
    });
    await change('owner', {
      action: 'role',
      id: full.id,
      userId: 'initial-0',
      role: 'owner',
    });
    await change('owner', { action: 'leave', id: full.id });
    await assert.rejects(
      api.readRoom('owner', full.id),
      (e) => e.status === 404,
    );
    const privateGroup = await change('owner', {
      action: 'create',
      name: 'Private',
    });
    const invite = await change('owner', {
      action: 'invite',
      id: privateGroup.id,
    });
    assert.equal(
      (await api.resolveRoomInvite('peer', invite.token)).room.id,
      privateGroup.id,
    );
    await change('peer', { action: 'join', token: invite.token });
    await change('owner', {
      action: 'update',
      id: privateGroup.id,
      name: 'Renamed',
      description: 'Private group',
    });
    await change('owner', {
      action: 'invite',
      id: privateGroup.id,
      revoke: true,
    });
    await assert.rejects(
      api.resolveRoomInvite('stranger', invite.token),
      (e) => e.status === 404,
    );
    const secret = await change('owner', {
      action: 'create',
      kind: 'secret',
      peerId: 'peer',
    });
    assert.equal(secret.members.length, 2);
    const keyFor = async () => {
      const pair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      );
      const { kty, crv, x, y } = await crypto.subtle.exportKey(
        'jwk',
        pair.publicKey,
      );
      return { kty, crv, x, y };
    };
    await change('owner', {
      action: 'acceptSecret',
      id: secret.id,
      publicKey: await keyFor(),
    });
    await change('peer', {
      action: 'acceptSecret',
      id: secret.id,
      publicKey: await keyFor(),
    });
    const ready = await api.readRoom('owner', secret.id);
    assert.equal(ready.canSend, true);
    const messageId = key();
    const header = await format.secretProtectedHeader({
      roomId: secret.id,
      messageId,
      senderId: 'owner',
      members: ready.members,
    });
    const ciphertext = [
      Buffer.from(JSON.stringify(header)).toString('base64url'),
      '',
      Buffer.alloc(12, 1).toString('base64url'),
      Buffer.from('sealed text').toString('base64url'),
      Buffer.alloc(16, 2).toString('base64url'),
    ].join('.');
    await change('owner', {
      action: 'send',
      id: secret.id,
      key: messageId,
      ciphertext,
    });
    await change('owner', {
      action: 'send',
      id: secret.id,
      key: messageId,
      ciphertext,
    });
    await assert.rejects(
      change('owner', {
        action: 'send',
        id: secret.id,
        key: key(),
        text: 'plaintext',
      }),
      (e) => e.status === 400,
    );
    assert.equal(
      (await api.readRoom('peer', secret.id)).messages[0].ciphertext,
      ciphertext,
    );
    await change('owner', {
      action: 'deleteMessage',
      id: secret.id,
      messageId,
    });
    await change('peer', { action: 'leave', id: secret.id });
    await assert.rejects(
      api.readRoom('owner', secret.id),
      (e) => e.status === 404,
    );
    const groupArchive = await api
      .groupRoomExportSections('initial-0')[1]
      .page('');
    assert.equal(groupArchive.rows.length, 2);
    assert.ok(
      groupArchive.rows.every(
        (row) => !('ciphertext' in row) && !('publicKey' in row),
      ),
    );
    await d
      .prepare(
        "INSERT INTO auth_sessions(tokenHash,userId,created,expiresAt,verifiedAt) VALUES('delete-session','owner',?,?,?)",
      )
      .bind(Date.now(), Date.now() + 86400000, Date.now())
      .run();
    await assert.rejects(
      removal.deleteAccount('owner', 'delete-session', false),
      (e) => e.status === 409 && e.code === 'GROUP_OWNERSHIP_REQUIRED',
    );
    await change('owner', {
      action: 'role',
      id: privateGroup.id,
      userId: 'peer',
      role: 'owner',
    });
    await removal.deleteAccount('owner', 'delete-session', false);
    assert.equal(
      (
        await d
          .prepare('SELECT COUNT(*) n FROM chat_rooms WHERE id=?')
          .bind(secret.id)
          .first()
      ).n,
      0,
    );
    assert.equal(
      (
        await d
          .prepare('SELECT COUNT(*) n FROM chat_room_members WHERE roomId=?')
          .bind(secret.id)
          .first()
      ).n,
      0,
    );
    assert.equal(
      (
        await d
          .prepare('SELECT COUNT(*) n FROM chat_room_messages WHERE roomId=?')
          .bind(secret.id)
          .first()
      ).n,
      0,
    );
    assert.equal((await api.readRoom('peer', privateGroup.id)).ownerId, 'peer');
    const retryPayload = {
      action: 'create',
      key: key(),
      kind: 'group',
      name: 'D1 retry',
      memberIds: ['stranger'],
    };
    const retries = await Promise.all([
      change('peer', retryPayload),
      change('peer', retryPayload),
    ]);
    assert.equal(
      retries[0].id,
      retries[1].id,
      'D1 concurrent identical creates commit one room',
    );
    const conflictingKey = key();
    const conflicting = await Promise.allSettled([
      change('peer', {
        action: 'create',
        key: conflictingKey,
        name: 'D1 conflict',
        memberIds: ['initial-2'],
      }),
      change('peer', {
        action: 'create',
        key: conflictingKey,
        name: 'D1 conflict',
        memberIds: ['initial-3'],
      }),
    ]);
    assert.equal(
      conflicting.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      conflicting.find((result) => result.status === 'rejected').reason.status,
      409,
    );
    const winningRoom = conflicting.find(
      (result) => result.status === 'fulfilled',
    ).value;
    assert.equal(
      winningRoom.members.length,
      2,
      'A conflicting D1 batch cannot inject another participant',
    );
    const secretRetryPayload = {
      action: 'create',
      key: key(),
      kind: 'secret',
      peerId: 'stranger',
    };
    const namedSecret = await change('peer', secretRetryPayload);
    assert.equal(namedSecret.name, 'stranger');
    assert.equal((await api.readRoom('stranger', namedSecret.id)).name, 'peer');
    assert.equal(
      (await api.listRooms('peer')).rooms.find((r) => r.id === namedSecret.id)
        .name,
      'stranger',
    );
    assert.equal((await change('peer', secretRetryPayload)).id, namedSecret.id);
    await change('stranger', { action: 'leave', id: namedSecret.id });
    await assert.rejects(
      change('peer', secretRetryPayload),
      (e) => e.status === 409,
    );
  },
);
