import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
const migrations = await Promise.all(
  journal.entries.map((entry) =>
    readFile('drizzle/' + entry.tag + '.sql', 'utf8'),
  ),
);
const result = await build({
  stdin: {
    contents: `export * from './lib/antispam'; export * from './lib/antispam-moderation'; export * from './lib/rooms'; export * from './lib/media-access'; export * from './lib/upload-storage'; export * from './lib/giveaways';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'antispam-fixture',
      setup(build) {
        build.onResolve(
          { filter: /^(\.\/|@\/lib\/)(storage|server|auth-session)$/ },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: path.endsWith('auth-session')
            ? `export const setting=()=>"1"; export const tokenHash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');`
            : `export {ApiError,failure} from './lib/api-error'; export const db=()=>globalThis.__antispamDb; export const bucket=()=>({delete:async()=>{}}); export const clean=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new Error('Invalid field');return v.trim();};`,
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      result.outputFiles[0].text + '\n//# sourceURL=antispam-fixture.mjs',
    ).toString('base64')
);
let sql, beforeRun;
function fixture() {
  sql?.close();
  sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations) sql.exec(migration);
  beforeRun = null;
  function statement(query) {
    let values = [];
    const execute = (mode) => {
      if (beforeRun?.matches(query)) {
        const hook = beforeRun;
        beforeRun = null;
        hook.run();
      }
      try {
        const s = sql.prepare(query);
        return /\?\d/.test(query)
          ? s[mode](
              Object.fromEntries(
                values.map((value, i) => [String(i + 1), value]),
              ),
            )
          : s[mode](...values);
      } catch (e) {
        throw new Error(
          e.message + '\nSQL: ' + query + '\nBindings: ' + values.length,
          { cause: e },
        );
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
  let tail = Promise.resolve();
  globalThis.__antispamDb = {
    prepare: statement,
    batch(statements) {
      const result = tail.then(async () => {
        sql.exec('BEGIN');
        try {
          const results = [];
          for (const s of statements) results.push(await s.run());
          sql.exec('COMMIT');
          return results;
        } catch (e) {
          sql.exec('ROLLBACK');
          throw e;
        }
      });
      tail = result.catch(() => {});
      return result;
    },
  };
  for (const name of ['alice', 'bob', 'carol', 'mod', 'admin'])
    sql
      .prepare('INSERT INTO users(id,name,created) VALUES(?,?,1)')
      .run(name, name);
  sql.exec(
    "INSERT INTO moderators(userId,created) VALUES('mod',1); INSERT INTO administrators(userId,created) VALUES('admin',1)",
  );
}
const count = (table) =>
  sql.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
const post = (
  text = 'unixgram.com',
  actorId = 'alice',
  contextId = actorId,
) => ({
  kind: 'post',
  targetId: crypto.randomUUID(),
  actorId,
  contextId,
  payload: {
    text,
    media: '[]',
    poll: '[]',
    code: '',
    codeLang: 'text',
    adult: 0,
    publishAt: 0,
  },
});
const review = (id, decision = 'approve', me = 'mod') =>
  api.spamModerationPost('spamReview', { id, decision }, me);
const block = (actor = 'alice') => {
  const id = crypto.randomUUID();
  sql
    .prepare(
      "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,'mod','blocked','Spam',?)",
    )
    .run(id, actor, Date.now());
  sql
    .prepare(
      "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,'blocked','Spam',?)",
    )
    .run(actor, id, Date.now());
};
const createGroup = () =>
  api.changeRoom('admin', {
    action: 'create',
    kind: 'group',
    name: 'Noctgram | Общение',
    memberIds: ['alice', 'bob', 'carol'],
  });
const send = (room, text, extra = {}, actor = 'alice') =>
  api.changeRoom(actor, {
    action: 'send',
    id: room.id,
    key: crypto.randomUUID(),
    text,
    ...extra,
  });
const rejectStatus = (promise, ...codes) =>
  assert.rejects(promise, (e) => codes.includes(e.status));

test('antispam persistence, permission races and ordinary-group integration', async (t) => {
  await t.test(
    'identity checks use database roles and allow harmless text',
    async () => {
      fixture();
      await api.assertSpamIdentity('alice', 'Обычное имя');
      await rejectStatus(
        api.assertSpamIdentity('alice', 'u_n_i_x_g_r_a_m'),
        400,
      );
      await rejectStatus(
        api.assertSpamIdentity('alice', 'dW5peGdyYW0uY29t'),
        400,
      );
      await api.assertSpamIdentity('admin', 'unixgram.com');
    },
  );
  await t.test(
    'quarantine holds canonical posts and deduplicates new request IDs',
    async () => {
      fixture();
      const submission = post();
      const first = await api.reviewSpam(submission),
        retry = await api.reviewSpam({
          ...submission,
          targetId: crypto.randomUUID(),
        });
      assert.equal(first.queued, true);
      assert.equal(first.id, retry.id);
      assert.equal(count('posts'), 0);
      assert.equal(count('antispam_queue'), 1);
      const page = await api.spamModerationGet(
        'spamQueue',
        new URLSearchParams(),
        'mod',
      );
      assert.equal((await page.json()).items[0].payload.text, 'unixgram.com');
      await rejectStatus(
        api.spamModerationGet('spamQueue', new URLSearchParams(), 'bob'),
        403,
      );
      const settled = await Promise.allSettled([
        review(first.id),
        review(first.id),
      ]);
      assert.equal(
        settled.filter((item) => item.status === 'fulfilled').length,
        1,
      );
      assert.equal(count('posts'), 1);
      assert.equal(
        sql.prepare('SELECT publisherId FROM posts').get().publisherId,
        'alice',
      );
      assert.equal(
        sql.prepare('SELECT status FROM antispam_queue').get().status,
        'approved',
      );
    },
  );
  await t.test('reject is final and leaves nothing public', async () => {
    fixture();
    const submission = post(),
      queued = await api.reviewSpam(submission);
    await review(queued.id, 'reject');
    await rejectStatus(api.reviewSpam(submission), 403);
    await rejectStatus(review(queued.id), 409);
    assert.equal(count('posts'), 0);
  });
  await t.test(
    'blocked author cannot be approved; group membership is checked again',
    async () => {
      fixture();
      const room = await createGroup(),
        queued = await send(room, 'unixgram.com');
      sql
        .prepare(
          "UPDATE chat_room_members SET status='left' WHERE roomId=? AND userId='alice'",
        )
        .run(room.id);
      await rejectStatus(review(queued.id), 409);
      assert.equal(count('chat_room_messages'), 0);
      const pending = await api.reviewSpam(post());
      block();
      await rejectStatus(review(pending.id), 403);
      assert.equal(count('posts'), 0);
    },
  );
  await t.test(
    'reviewer permissions are rechecked at the write, despite another active admin',
    async () => {
      fixture();
      const queued = await api.reviewSpam(post());
      beforeRun = {
        matches: (query) => query.includes('INSERT INTO posts'),
        run: () => sql.exec("DELETE FROM moderators WHERE userId='mod'"),
      };
      await rejectStatus(review(queued.id), 409);
      assert.equal(count('posts'), 0);
      assert.equal(
        sql.prepare('SELECT status FROM antispam_queue').get().status,
        'pending',
      );
    },
  );
  await t.test(
    'settings require administrator role, compare-and-swap and bounded domains',
    async () => {
      fixture();
      const body = { domains: ['example.com'], raid: true, expectedUpdated: 0 };
      await rejectStatus(
        api.spamModerationPost('spamSettings', body, 'mod'),
        403,
      );
      const response = await api.spamModerationPost(
        'spamSettings',
        body,
        'admin',
      );
      const settings = await response.json();
      assert.ok(settings.raidUntil > Date.now());
      await rejectStatus(
        api.spamModerationPost('spamSettings', body, 'admin'),
        409,
      );
      await rejectStatus(
        api.spamModerationPost(
          'spamSettings',
          {
            ...body,
            expectedUpdated: settings.updated,
            domains: ['https://example.com'],
          },
          'admin',
        ),
        400,
      );
    },
  );
  await t.test(
    'raid queues a newcomer, retry keeps receipt, rejected rate requests do not inflate activity',
    async () => {
      fixture();
      sql
        .prepare("UPDATE users SET created=? WHERE id='alice'")
        .run(Date.now());
      sql
        .prepare('UPDATE antispam_settings SET raidUntil=?')
        .run(Date.now() + 86400000);
      const submission = post('Всем привет!'),
        queued = await api.reviewSpam(submission);
      assert.equal(queued.queued, true);
      assert.equal(
        (await api.reviewSpam({ ...submission, targetId: crypto.randomUUID() }))
          .id,
        queued.id,
      );
      const activities = count('antispam_activity');
      await rejectStatus(api.reviewSpam(post('Следующее сообщение')), 429);
      assert.equal(count('antispam_activity'), activities);
      await review(queued.id);
      sql.exec("DELETE FROM auth_limits WHERE key LIKE 'action:antiraid:%'");
      assert.equal(
        await api.reviewSpam(post('Спасибо, теперь могу общаться')),
        null,
      );
      assert.equal(
        await api.reviewSpam(post('Сообщение старого пользователя', 'bob')),
        null,
      );
    },
  );
  await t.test(
    'normal duplicate evidence is scoped, and short greetings are not queued',
    async () => {
      fixture();
      const text = 'Давайте обсудим планы на ближайшую встречу';
      assert.equal(await api.reviewSpam(post(text)), null);
      assert.equal(await api.reviewSpam(post(text)), null);
      assert.equal((await api.reviewSpam(post(text))).queued, true);
      for (let i = 0; i < 5; i++)
        assert.equal(await api.reviewSpam(post('Привет')), null);
      const common = 'Очень длинный обычный текст в разных обсуждениях';
      for (const actor of ['alice', 'bob', 'carol'])
        assert.equal(await api.reviewSpam(post(common, actor)), null);
    },
  );
  await t.test(
    'a coordinated repeated text from three new users in one group is queued',
    async () => {
      fixture();
      const room = await createGroup();
      sql
        .prepare(
          "UPDATE users SET created=? WHERE id IN('alice','bob','carol')",
        )
        .run(Date.now());
      const text = 'Одинаковая рекламная рассылка из нескольких аккаунтов';
      assert.ok(!(await send(room, text, {}, 'alice')).queued);
      assert.ok(!(await send(room, text, {}, 'bob')).queued);
      assert.equal((await send(room, text, {}, 'carol')).queued, true);
      assert.equal(await api.reviewSpam(post(text, 'alice')), null);
      assert.equal(await api.reviewSpam(post(text, 'bob')), null);
      assert.equal(
        (await api.reviewSpam(post(text, 'carol'))).queued,
        true,
        'Personal authors share the same public-feed activity scope',
      );
    },
  );
  await t.test(
    'a reviewer revoked during the queue query cannot read pending private text',
    async () => {
      fixture();
      await api.reviewSpam(post());
      beforeRun = {
        matches: (query) => query.includes('SELECT q.*,u.name'),
        run: () => sql.exec("DELETE FROM moderators WHERE userId='mod'"),
      };
      const page = await api.spamModerationGet(
        'spamQueue',
        new URLSearchParams(),
        'mod',
      );
      assert.deepEqual((await page.json()).items, []);
    },
  );
  await t.test(
    'pending group messages are absent from messages, last preview and unread; approval publishes once',
    async () => {
      fixture();
      const room = await createGroup(),
        queued = await send(room, 'unixgram.com');
      assert.equal(queued.queued, true);
      const before = await api.readRoom('bob', room.id);
      assert.equal(before.messages.length, 0);
      assert.equal(before.unread, 0);
      const listed = await api.listRooms('bob');
      assert.equal(
        listed.rooms.find((r) => r.id === room.id).lastMessage,
        null,
      );
      await review(queued.id);
      const after = await api.readRoom('bob', room.id);
      assert.equal(after.messages.length, 1);
      assert.equal(after.unread, 1);
      await rejectStatus(review(queued.id), 409);
      assert.equal(count('chat_room_messages'), 1);
    },
  );
  await t.test(
    'blocking hides previous group messages and profile identity',
    async () => {
      fixture();
      const room = await createGroup();
      await send(room, 'Сообщение до блокировки');
      block();
      const data = await api.readRoom('bob', room.id);
      assert.equal(data.messages.length, 0);
      assert.equal(data.unread, 0);
      assert.ok(!data.members.some((m) => m.userId === 'alice'));
      assert.equal(
        (await api.listRooms('bob')).rooms.find((r) => r.id === room.id)
          .lastMessage,
        null,
      );
    },
  );
  await t.test('approval cannot quote a blocked sender', async () => {
    fixture();
    const room = await createGroup(),
      target = await send(room, 'Исходное сообщение', {}, 'carol');
    const queued = await send(room, 'unixgram.com', { replyTo: target.id });
    block('carol');
    await rejectStatus(review(queued.id), 409);
    assert.equal(count('chat_room_messages'), 1);
    await rejectStatus(
      send(room, 'unixgram.com', { replyTo: target.id }),
      400,
      404,
    );
  });
  await t.test('pending post media is retained and becomes public only after approval', async () => {
    fixture();
    const uploadId = crypto.randomUUID();
    sql.prepare("INSERT INTO uploads(id,userId,name,type,bytes,state,created) VALUES(?,'alice','photo.png','image/png',4,'ready',?)").run(uploadId,Date.now());
    const submission = post();
    submission.payload.media = JSON.stringify([{id:uploadId,type:'image/png',name:'photo.png'}]);
    const queued = await api.reviewSpam(submission);
    assert.equal(count('posts'),0);
    assert.ok(sql.prepare('SELECT 1 WHERE '+api.uploadReferenced('?1')).get({1:uploadId}));
    await rejectStatus(api.assertMediaRead(uploadId,'bob','alice'),404);
    await review(queued.id);
    await api.assertMediaRead(uploadId,'bob','alice');
    block();
    await rejectStatus(api.assertMediaRead(uploadId,'bob','alice'),404);
  });
  await t.test('administrators and moderators bypass automatic filtering even during a raid', async () => {
    fixture();
    sql.prepare('UPDATE antispam_settings SET raidUntil=?').run(Date.now()+86400000);
    sql.prepare('UPDATE users SET created=?').run(Date.now());
    for (const actor of ['admin','mod']) {
      await api.assertSpamIdentity(actor,'unixgram.com');
      await api.assertUnqueuedPublicWrite(actor,'unixgram.com');
      assert.equal(await api.reviewSpam(post('unixgram.com',actor)),null);
    }
    assert.equal(count('antispam_queue'),0);
    assert.equal(count('antispam_activity'),0);
  });
  await t.test(
    'queue expiration releases otherwise unused files and purges resolved history',
    async () => {
      fixture();
      const queued = await api.reviewSpam(post());
      sql
        .prepare('UPDATE antispam_queue SET created=? WHERE id=?')
        .run(Date.now() - 8 * 86400000, queued.id);
      await api.cleanSpamActivity();
      assert.equal(
        sql.prepare('SELECT status FROM antispam_queue').get().status,
        'rejected',
      );
      sql
        .prepare('UPDATE antispam_queue SET reviewedAt=?')
        .run(Date.now() - 31 * 86400000);
      await api.cleanSpamActivity();
      assert.equal(count('antispam_queue'), 0);
    },
  );
  await t.test(
    'public event guard runs before charging a giveaway',
    async () => {
      fixture();
      const room = await createGroup();
      sql
        .prepare("UPDATE users SET name='unixgram.com' WHERE id='alice'")
        .run();
      await rejectStatus(
        api.createGiveaway('alice', {
          key: crypto.randomUUID(),
          targetKind: 'group',
          targetId: room.id,
          prize: 'stars',
          winnerCount: 1,
          starsPerWinner: 25,
          endsAt: Date.now() + 3600000,
        }),
        400,
      );
      assert.equal(count('giveaways'), 0);
      assert.equal(count('star_transfers'), 0);
    },
  );
});
