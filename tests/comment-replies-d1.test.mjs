/** In-memory workerd/D1 test: comments answer comments of the same post (drizzle/0050_comment_replies.sql). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { build } = require('esbuild');

void test(
  'answers quote the comment they answer, as far as the viewer may see it',
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
    globalThis.__realCommentsDb = d;
    t.after(() => {
      delete globalThis.__realCommentsDb;
    });
    const compiled = await build({
      entryPoints: [join(root, 'lib/comment-replies.ts')],
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
              () => ({
                contents:
                  "export const setting=()=> '1'; export const tokenHash=async value=>value; export const identity=async()=>null;",
              }),
            );
            build.onResolve({ filter: /^\.\/storage$/ }, () => ({
              path: 'storage',
              namespace: 'test',
            }));
            build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
              contents: 'export const db = () => globalThis.__realCommentsDb;',
            }));
          },
        },
      ],
    });
    const api = await import(
      'data:text/javascript;base64,' +
        Buffer.from(compiled.outputFiles[0].text).toString('base64')
    );

    const now = Date.now();
    await d.batch(
      ['author', 'reader', 'blocked', 'gone'].map((user) =>
        d
          .prepare(
            'INSERT INTO users(id,name,created,onboardingComplete) VALUES(?,?,?,1)',
          )
          .bind(user, user.toUpperCase(), now),
      ),
    );
    await d.batch([
      ...['post', 'other'].map((id) =>
        d
          .prepare(
            "INSERT INTO posts(id,userId,text,created) VALUES(?,'author','Ночь',?)",
          )
          .bind(id, now),
      ),
      ...[
        ['first', 'post', 'author', 'Первый комментарий о ночном городе'],
        ['elsewhere', 'other', 'author', 'Под другим постом'],
        ['hidden', 'post', 'blocked', 'Не видно читателю'],
        ['orphan', 'post', 'gone', 'Автор удалён'],
      ].map(([id, post, user, text], index) =>
        d
          .prepare(
            'INSERT INTO comments(id,postId,userId,text,created) VALUES(?,?,?,?,?)',
          )
          .bind(id, post, user, text, now + index),
      ),
    ]);
    // A deleted account keeps its old comments; triggers refuse new ones.
    await d.batch([
      d.prepare("UPDATE users SET deletedAt=? WHERE id='gone'").bind(now),
      d
        .prepare(
          "INSERT INTO user_blocks(blocker,blocked,created) VALUES('reader','blocked',?)",
        )
        .bind(now),
    ]);

    assert.equal(await api.replyTarget('reader', 'post', undefined), null);
    assert.equal(await api.replyTarget('reader', 'post', ''), null);
    assert.equal(await api.replyTarget('reader', 'post', 'first'), 'first');
    await assert.rejects(
      api.replyTarget('reader', 'post', 'elsewhere'),
      /удалён/,
      'An answer stays under its own post',
    );
    await assert.rejects(
      api.replyTarget('reader', 'post', 'hidden'),
      /удалён/,
      'A blocked author cannot be answered',
    );
    await assert.rejects(api.replyTarget('reader', 'post', 42), /Выберите/);

    await d.batch(
      [
        ['to-first', 'first'],
        ['to-hidden', 'hidden'],
        ['to-orphan', 'orphan'],
        ['to-deleted', 'removed-long-ago'],
        ['plain', null],
      ].map(([id, replyTo], index) =>
        d
          .prepare(
            "INSERT INTO comments(id,postId,userId,text,replyTo,created) VALUES(?,'post','reader','Ответ',?,?)",
          )
          .bind(id, replyTo, now + 10 + index),
      ),
    );
    const rows = (
      await d
        .prepare(
          `SELECT c.id,c.replyTo,${api.replyColumns('rc', 'ru')} FROM comments c ${api.replyJoins('c', 'rc', 'ru')} WHERE c.postId=? AND c.userId='reader' ORDER BY c.created`,
        )
        .bind('reader', 'post')
        .all()
    ).results;
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    assert.deepEqual(byId['to-first'], {
      id: 'to-first',
      replyTo: 'first',
      replyUserId: 'author',
      replyName: 'AUTHOR',
      replyText: 'Первый комментарий о ночном городе',
    });
    for (const id of ['to-hidden', 'to-orphan', 'to-deleted']) {
      assert.ok(byId[id].replyTo, id + ' keeps what it answered');
      assert.equal(byId[id].replyUserId, null, id + ' shows no author');
      assert.equal(byId[id].replyText, null, id + ' shows no text');
    }
    assert.equal(byId.plain.replyTo, null);
    assert.equal(byId.plain.replyUserId, null);
  },
);
