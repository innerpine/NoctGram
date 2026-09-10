// Actual route, JSON bounds, rate limiter and room SQL; synthetic identities only.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import test from 'node:test';

void test('room HTTP guards bind mutations to the signed-in actor and preserve group ACLs', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const { tag } of JSON.parse(
    readFileSync('drizzle/meta/_journal.json', 'utf8'),
  ).entries)
    sql.exec(readFileSync(`drizzle/${tag}.sql`, 'utf8'));
  for (const id of ['alice', 'bob', 'eve'])
    sql.prepare('INSERT INTO users(id,name,created) VALUES(?,?,1)').run(id, id);
  const context = {
    actor: 'alice',
    db: {
      prepare(query) {
        let args = [];
        return {
          bind(...values) {
            args = values;
            return this;
          },
          async first() {
            return sql.prepare(query).get(...args) || null;
          },
          async all() {
            return { results: sql.prepare(query).all(...args) };
          },
          async run() {
            return {
              meta: { changes: sql.prepare(query).run(...args).changes },
            };
          },
        };
      },
      async batch(statements) {
        sql.exec('BEGIN');
        try {
          const results = [];
          for (const s of statements) results.push(await s.run());
          sql.exec('COMMIT');
          return results;
        } catch (error) {
          sql.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  globalThis.__roomHttp = context;
  try {
    const compiled = await build({
      entryPoints: ['app/api/rooms/route.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'room-http-fixture',
          setup(builder) {
            builder.onResolve(
              { filter: /^(?:@\/lib\/server|\.\/storage|\.\/auth-session)$/ },
              ({ path }) => ({ path, namespace: 'fixture' }),
            );
            builder.onLoad(
              { filter: /.*/, namespace: 'fixture' },
              ({ path }) => ({
                resolveDir: resolve('lib'),
                contents:
                  path === '@/lib/server'
                    ? `import {ApiError} from './api-error';export {ApiError,failure} from './api-error'; export async function viewer(){if(!globalThis.__roomHttp.actor)throw new ApiError(401,'Sign in');return globalThis.__roomHttp.actor;}`
                    : path === './storage'
                      ? 'export const db=()=>globalThis.__roomHttp.db;'
                      : `export const setting=()=>''; export async function tokenHash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');}`,
              }),
            );
          },
        },
      ],
    });
    const route = await import(
      'data:text/javascript;base64,' +
        Buffer.from(compiled.outputFiles[0].text).toString('base64')
    );
    const post = (body, headers = {}) =>
      route.POST(
        new Request('https://noctgram.test/api/rooms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://noctgram.test',
            ...headers,
          },
          body: JSON.stringify(body),
        }),
      );
    const get = (query) =>
      route.GET(
        new Request(
          'https://noctgram.test/api/rooms?' + new URLSearchParams(query),
        ),
      );
    const create = {
      action: 'create',
      actor: 'alice',
      kind: 'group',
      name: 'Night friends',
      visibility: 'public',
      username: 'night_friends',
    };
    context.actor = '';
    assert.equal((await get({ action: 'list' })).status, 401);
    context.actor = 'bob';
    assert.equal((await post(create)).status, 401);
    context.actor = 'alice';
    assert.equal(
      (await post(create, { Origin: 'https://evil.test' })).status,
      403,
    );
    assert.equal(
      (await post({ ...create, name: 'x'.repeat(49000) })).status,
      413,
    );
    assert.equal(
      sql.prepare('SELECT count(*) AS n FROM chat_rooms').get().n,
      0,
    );
    const created = await post(create);
    assert.equal(created.status, 200);
    assert.match(created.headers.get('Cache-Control'), /no-store/);
    const room = await created.json();
    context.actor = 'bob';
    assert.equal((await get({ action: 'room', id: room.id })).status, 404);
    assert.equal((await get({ action: 'list', actor: 'alice' })).status, 401);
    assert.equal(
      (await post({ action: 'join', actor: 'bob', username: 'night_friends' }))
        .status,
      200,
    );
    const key = crypto.randomUUID();
    assert.equal(
      (
        await post({
          action: 'send',
          actor: 'bob',
          id: room.id,
          key,
          text: 'Hello from the route',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post({
          action: 'send',
          actor: 'bob',
          id: room.id,
          key,
          text: 'Hello from the route',
        })
      ).status,
      200,
    );
    assert.equal(
      sql.prepare('SELECT count(*) AS n FROM chat_room_messages').get().n,
      1,
    );
    context.actor = 'alice';
    const detail = await (
      await get({ action: 'room', id: room.id, actor: 'alice' })
    ).json();
    assert.equal(detail.messages[0].text, 'Hello from the route');
    assert.equal(
      (
        await post({
          action: 'removeMember',
          actor: 'alice',
          id: room.id,
          userId: 'bob',
        })
      ).status,
      200,
    );
    context.actor = 'bob';
    assert.equal((await get({ action: 'room', id: room.id })).status, 404);
    assert.equal(
      (await post({ action: 'join', username: 'night_friends' })).status,
      403,
    );
    context.actor = 'alice';
    const secret = await (
      await post({ action: 'create', kind: 'secret', peerId: 'eve' })
    ).json();
    assert.equal(
      (
        await post({
          action: 'send',
          id: secret.id,
          key: crypto.randomUUID(),
          text: 'must never persist',
        })
      ).status,
      400,
    );
    assert.equal(
      sql
        .prepare('SELECT count(*) AS n FROM chat_room_messages WHERE roomId=?')
        .get(secret.id).n,
      0,
    );
    context.actor = 'eve';
    sql
      .prepare('INSERT INTO auth_limits(key,count,expiresAt) VALUES(?,?,?)')
      .run(
        'action:room-create:' +
          Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode('eve'),
              ),
            ),
            (x) => x.toString(16).padStart(2, '0'),
          ).join(''),
        10,
        Date.now() + 3600000,
      );
    const limited = await post({
      action: 'create',
      kind: 'group',
      name: 'Too many',
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  } finally {
    delete globalThis.__roomHttp;
    sql.close();
  }
});
