import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

await test('comment replies preserve references without leaking hidden or deleted comments', async (t) => {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  for (const { tag } of JSON.parse(
    readFileSync('drizzle/meta/_journal.json', 'utf8'),
  ).entries)
    sql.exec(readFileSync(`drizzle/${tag}.sql`, 'utf8'));
  globalThis.__commentsDb = {
    prepare(query) {
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          return {
            meta: { changes: sql.prepare(query).run(...this.args).changes },
          };
        },
        async all() {
          return { results: sql.prepare(query).all(...this.args) };
        },
      };
    },
  };
  t.after(() => delete globalThis.__commentsDb);
  const { outputFiles } = await build({
    entryPoints: ['lib/comment-replies.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'isolated-db',
        setup(b) {
          b.onResolve(
            { filter: /^\.\/(server|account-access|privacy)$/ },
            (args) => ({ path: args.path, namespace: 'fixture' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
            if (path === './server')
              return {
                contents:
                  'export const db=()=>globalThis.__commentsDb; export {ApiError} from "./lib/api-error.ts";',
                resolveDir: process.cwd(),
              };
            const name =
              path === './privacy' ? 'personalVisibility' : 'visibleAccount';
            const source = readFileSync('lib/' + path.slice(2) + '.ts', 'utf8');
            const start = source.indexOf('export function ' + name + '(');
            return {
              contents: source.slice(start, source.indexOf('\n}', start) + 2),
              loader: 'ts',
            };
          });
        },
      },
    ],
  });
  const api = await import(
    'data:text/javascript;base64,' +
      Buffer.from(outputFiles[0].text).toString('base64')
  );
  for (const id of ['me', 'author', 'other'])
    sql
      .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
      .run(id, id, 1);
  for (const id of ['post', 'different'])
    sql
      .prepare('INSERT INTO posts(id,userId,text,created) VALUES(?,?,?,?)')
      .run(id, 'author', 'post', 1);
  await api.insertComment('parent', 'post', 'author', 'Original comment', null);
  await api.insertComment('answer', 'post', 'me', 'Reply', 'parent');
  const rows = () =>
    sql.prepare("SELECT * FROM comments WHERE id='answer'").all();
  const quote = async () =>
    (await api.withCommentReplies(rows(), 'me'))[0].reply;
  assert.deepEqual(await quote(), {
    id: 'parent',
    userId: 'author',
    name: 'author',
    text: 'Original comment',
    unavailable: false,
  });
  await api.insertComment('nested', 'post', 'other', 'Nested reply', 'answer');
  assert.equal(
    sql.prepare("SELECT replyTo FROM comments WHERE id='nested'").get().replyTo,
    'answer',
  );
  await assert.rejects(
    api.insertComment('cross', 'different', 'me', 'No', 'parent'),
    (e) => e.status === 409,
  );
  await assert.rejects(
    api.insertComment('missing', 'post', 'me', 'No', 'absent'),
    (e) => e.status === 409,
  );
  for (const pair of [
    ['me', 'author'],
    ['author', 'me'],
  ]) {
    sql
      .prepare('INSERT INTO user_blocks(blocker,blocked,created) VALUES(?,?,1)')
      .run(...pair);
    assert.deepEqual(await quote(), {
      id: 'parent',
      userId: '',
      name: '',
      text: '',
      unavailable: true,
    });
    await assert.rejects(
      api.insertComment('blocked', 'post', 'me', 'No', 'parent'),
      (e) => e.status === 409,
    );
    sql.exec('DELETE FROM user_blocks');
  }
  sql.exec("UPDATE users SET deletedAt=1 WHERE id='author'");
  assert.equal((await quote()).text, '');
  sql.exec("UPDATE users SET deletedAt=0 WHERE id='author'");
  sql
    .prepare(
      "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('e','author','me','blocked','test',1)",
    )
    .run();
  sql.exec(
    "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('author','e','blocked','test',1)",
  );
  assert.equal((await quote()).unavailable, true);
  sql.exec('DELETE FROM account_restrictions');
  sql.exec("DELETE FROM comments WHERE id='parent'");
  assert.equal(rows().length, 1, 'Deleting the parent keeps the answer');
  assert.equal((await quote()).unavailable, true);
  assert.equal(
    (
      await api.withCommentReplies(
        [{ postId: 'different', replyTo: 'answer' }],
        'me',
      )
    )[0].reply.unavailable,
    true,
  );
  for (const invalid of ['', 42, {}, 'x'.repeat(251)])
    assert.throws(() => api.commentReplyTarget(invalid));
  assert.equal(api.commentReplyTarget(undefined), null);
});
