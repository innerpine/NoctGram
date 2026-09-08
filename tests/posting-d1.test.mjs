/**
 * Real D1 regression for NoctGram posting SQL and atomic media access.
 * Run from the repository: node --test tests/posting-d1.test.mjs
 * No .env, HTTP app, external requests or persistent DB.
 * Deliberately uses Miniflare/workerd rather than node:sqlite: D1 limits
 * expression depth to 100 and compound SELECT terms to five.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const root = [
  process.cwd(),
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
].find((p) => existsSync(join(p, 'app/api/social/route.ts')));
assert.ok(root, 'Run from NoctGram root or copy this file into tests/.');
const require = createRequire(join(root, 'package.json'));
// Load the Node-only test runtime by path; its ambient declarations must not
// change the app's Worker/browser type environment during linting.
const { Miniflare } = require(require.resolve('miniflare'));
const ts = require('typescript');
const source = (file) => readFileSync(join(root, file), 'utf8');
const modules = new Map();
const allowed = new Set([
  'lib/media-access.ts',
  'lib/chat-access.ts',
  'lib/chat-files.ts',
  'lib/premium-access.ts',
  'lib/boost-access.ts',
  'lib/boost-rules.ts',
  'lib/channel-access.ts',
  'lib/account-access.ts',
  'lib/privacy.ts',
  'lib/api-error.ts',
]);
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  if (file === 'lib/server.ts')
    return {
      db() {
        throw new Error('Only extracted SQL may access test D1.');
      },
      ApiError: load('lib/api-error.ts').ApiError,
    };
  assert.ok(allowed.has(file), 'Unexpected module: ' + file);
  const loadedModule = { exports: {} };
  modules.set(file, loadedModule);
  const compiled = ts.transpileModule(source(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
  }).outputText;
  const scopedRequire = (specifier) => {
    const target = specifier.startsWith('@/')
      ? resolve(root, specifier.slice(2))
      : specifier.startsWith('.')
        ? resolve(root, dirname(file), specifier)
        : null;
    assert.ok(target, 'Unexpected dependency: ' + specifier);
    const relative = target
      .slice(resolve(root).length + 1)
      .replaceAll('\\', '/');
    return load(extname(relative) ? relative : relative + '.ts');
  };
  compileFunction(compiled, ['require', 'exports', 'module', 'fetch'])(
    scopedRequire,
    loadedModule.exports,
    loadedModule,
    () => {
      throw new Error('External network forbidden.');
    },
  );
  return loadedModule.exports;
}
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => find(child, predicate));
}
const route = ts.createSourceFile(
  'route.ts',
  source('app/api/social/route.ts'),
  ts.ScriptTarget.Latest,
  true,
);
const postBranch = find(
  route,
  (node) =>
    ts.isIfStatement(node) &&
    node.expression.getText(route) === "action === 'post'" &&
    node.thenStatement.getText(route).includes('INSERT INTO posts'),
);
assert.ok(postBranch, 'Post branch must exist.');
const declaration = find(
  postBranch.thenStatement,
  (node) =>
    ts.isVariableDeclaration(node) &&
    node.name.getText(route) === 'inserted' &&
    node.initializer?.getText(route).includes('INSERT INTO posts'),
);
assert.ok(
  declaration,
  'Extract the actual post INSERT + bind, never a copied SQL query.',
);
const helpers = {
  channelPermission: load('lib/channel-access.ts').channelPermission,
  writableTarget: load('lib/channel-access.ts').writableTarget,
  mediaPermission: load('lib/media-access.ts').mediaPermission,
};
function compileInsert(declarationText) {
  return compileFunction(
    ts.transpileModule(
      `return async (ctx) => {
  const { d,me,media,postId,text,verified,poll,code,codeLang,b,publishAt,author }=ctx;
  const ${declarationText};
  return inserted;
};`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    Object.keys(helpers),
  )(...Object.values(helpers));
}
const insert = compileInsert(declaration.getText(route));

void test(
  'posting uses real D1 parser limits and atomic access conditions',
  { timeout: 120000 },
  async (t) => {
    const mf = new Miniflare({
      modules: true,
      script:
        'export default { fetch() { return new Response("D1 SQL test only",{status:404}); } };',
      compatibilityDate: '2026-05-15',
      d1Databases: ['DB'],
      d1Persist: false,
      cachePersist: false,
      durableObjectsPersist: false,
      outboundService: () => {
        throw new Error('External network forbidden.');
      },
    });
    t.after(() => mf.dispose());
    const d = await mf.getD1Database('DB');
    for (const migration of JSON.parse(source('drizzle/meta/_journal.json'))
      .entries) {
      for (const statement of source('drizzle/' + migration.tag + '.sql').split(
        '--> statement-breakpoint',
      )) {
        if (!statement.trim()) continue;
        try {
          await d.prepare(statement).run();
        } catch (cause) {
          throw new Error('Migration failed: ' + migration.tag, { cause });
        }
      }
    }
    const run = (sql, ...args) =>
      d
        .prepare(sql)
        .bind(...args)
        .run();
    const first = (sql, ...args) =>
      d
        .prepare(sql)
        .bind(...args)
        .first();
    async function fixture() {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12),
        now = Date.now();
      const actor = 'actor_' + suffix,
        owner = 'owner_' + suffix,
        stranger = 'stranger_' + suffix;
      const channel = 'channel_' + suffix,
        other = 'other_' + suffix;
      for (const id of [actor, owner, stranger])
        await run(
          'INSERT INTO users(id,name,created) VALUES(?,?,?)',
          id,
          id,
          now,
        );
      for (const [id, ownerId] of [
        [channel, actor],
        [other, owner],
      ])
        await run(
          "INSERT INTO users(id,name,created,kind,ownerId) VALUES(?,?,?,'channel',?)",
          id,
          id,
          now,
          ownerId,
        );
      return {
        actor,
        owner,
        stranger,
        channel,
        other,
        now,
        async upload(ownerId = actor, state = 'ready') {
          const id = 'media_' + randomUUID().replaceAll('-', '');
          await run(
            'INSERT INTO uploads(id,userId,type,name,created,state) VALUES(?,?,?,?,?,?)',
            id,
            ownerId,
            'image/png',
            'fixture.png',
            now,
            state,
          );
          return { id, type: 'image/png', name: 'fixture.png' };
        },
        async post(patch = {}, executor = insert) {
          const ctx = {
            d,
            me: actor,
            author: actor,
            media: [],
            postId: randomUUID(),
            text: 'D1 text',
            verified: [],
            poll: [],
            code: '',
            codeLang: 'text',
            b: {},
            publishAt: 0,
            ...patch,
          };
          const result = await executor(ctx);
          const row = await first('SELECT * FROM posts WHERE id=?', ctx.postId);
          return { result, row, ctx };
        },
        async member(role = 'editor') {
          await run(
            'INSERT INTO channel_members(channelId,userId,role,created) VALUES(?,?,?,?)',
            other,
            actor,
            role,
            now,
          );
        },
        async scheduled(media) {
          const id = randomUUID();
          await run(
            'INSERT INTO posts(id,userId,text,media,created,publishAt,publisherId) VALUES(?,?,?,?,?,?,?)',
            id,
            other,
            'Private scheduled',
            JSON.stringify([media]),
            now + 3600000,
            now + 3600000,
            owner,
          );
          return id;
        },
      };
    }
    async function saved(f, patch = {}) {
      const result = await f.post(patch);
      assert.equal(result.result.meta.changes, 1);
      assert.ok(result.row);
      return result.row;
    }
    async function denied(f, patch = {}) {
      const result = await f.post(patch);
      assert.equal(result.result.meta.changes, 0);
      assert.equal(result.row, null);
    }

    await t.test(
      'harness enforces D1 depth=100 and compound SELECT=5',
      async () => {
        await assert.rejects(
          () =>
            d
              .prepare('SELECT 1 WHERE ' + Array(110).fill('1=1').join(' AND '))
              .all(),
          /maximum depth 100/i,
        );
        await assert.rejects(
          () => d.prepare(Array(6).fill('SELECT 1').join(' UNION ')).all(),
          /too many terms/i,
        );
      },
    );
    await t.test(
      'text, poll and code posts compile and store their real payload',
      async () => {
        const f = await fixture();
        assert.equal((await saved(f)).text, 'D1 text');
        assert.deepEqual(
          JSON.parse(
            (await saved(f, { text: 'Which?', poll: ['One', 'Two'] })).poll,
          ),
          ['One', 'Two'],
        );
        const code = await saved(f, {
          text: '',
          code: 'const noct = "🌙";\nconsole.log(noct);',
          codeLang: 'javascript',
        });
        assert.equal(code.code, 'const noct = "🌙";\nconsole.log(noct);');
        assert.equal(code.codeLang, 'javascript');
      },
    );
    await t.test(
      'own media and owner channel posts retain publisher/adult metadata',
      async () => {
        const f = await fixture(),
          media = await f.upload();
        const row = await saved(f, {
          author: f.channel,
          media: [media.id],
          verified: [media],
          b: { adult: true },
        });
        assert.equal(row.userId, f.channel);
        assert.equal(row.publisherId, f.actor);
        assert.equal(row.adult, 1);
        assert.deepEqual(JSON.parse(row.media), [media]);
        assert.equal(
          (await saved(f, { media: [media.id], verified: [media] })).userId,
          f.actor,
        );
      },
    );
    await t.test('all four attachments compile under D1 limits', async () => {
      const f = await fixture(),
        verified = await Promise.all(
          Array.from({ length: 4 }, () => f.upload()),
        );
      const row = await saved(f, {
        media: verified.map((v) => v.id),
        verified,
      });
      assert.equal(JSON.parse(row.media).length, 4);
    });
    await t.test(
      'one missing, foreign, pending or moderated file rejects whole four-item array',
      async () => {
        for (const problem of ['missing', 'foreign', 'pending', 'moderated']) {
          const f = await fixture(),
            verified = await Promise.all(
              Array.from({ length: 3 }, () => f.upload()),
            );
          let bad;
          if (problem === 'missing')
            bad = {
              id: 'missing_' + randomUUID(),
              type: 'image/png',
              name: 'missing.png',
            };
          else
            bad = await f.upload(
              problem === 'foreign' ? f.stranger : f.actor,
              problem === 'pending' ? 'pending' : 'ready',
            );
          if (problem === 'moderated') {
            const removal = randomUUID();
            await run(
              'INSERT INTO content_removals(id,targetType,targetId,postId,authorId,moderatorId,text,snapshot,reason,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
              removal,
              'post',
              removal,
              '',
              f.actor,
              f.owner,
              'Fixture',
              '{}',
              'Fixture',
              f.now,
            );
            await run(
              'INSERT INTO moderated_uploads(uploadId,removalId) VALUES(?,?)',
              bad.id,
              removal,
            );
          }
          verified.splice(1, 0, bad);
          await denied(f, { media: verified.map((m) => m.id), verified });
        }
      },
    );
    await t.test(
      'duplicate allowed ID and future scheduled channel post retain original semantics',
      async () => {
        const f = await fixture(),
          media = await f.upload(),
          when = Date.now() + 3600000;
        const row = await saved(f, {
          author: f.channel,
          media: [media.id, media.id],
          verified: [media, media],
          publishAt: when,
        });
        assert.equal(JSON.parse(row.media).length, 2);
        assert.equal(row.created, when);
        assert.equal(row.publishAt, when);
        assert.equal(row.publisherId, f.actor);
        assert.equal(row.notifyPending, 1);
        assert.equal(
          (
            await first(
              `SELECT ${load('lib/channel-access.ts').published('p')} AS visible FROM posts p WHERE p.id=?`,
              row.id,
            )
          ).visible,
          0,
        );
      },
    );
    await t.test(
      'unowned channel and other upload denied atomically',
      async () => {
        const f = await fixture();
        await denied(f, { author: f.other });
        const media = await f.upload(f.stranger);
        await denied(f, { media: [media.id], verified: [media] });
      },
    );
    await t.test(
      'editor can publish; revocation before write immediately denies',
      async () => {
        const f = await fixture();
        await f.member();
        await saved(f, { author: f.other });
        await run(
          'DELETE FROM channel_members WHERE channelId=? AND userId=?',
          f.other,
          f.actor,
        );
        await denied(f, { author: f.other });
      },
    );
    await t.test(
      'own upload in private scheduled channel cannot escape after role revocation',
      async () => {
        const f = await fixture(),
          media = await f.upload();
        await f.member();
        await f.scheduled(media);
        const yes = await first(
          `WITH i AS(SELECT ? AS media,? AS actor) SELECT ${helpers.mediaPermission('i.media', 'i.actor')} AS allowed FROM i`,
          media.id,
          f.actor,
        );
        assert.equal(yes.allowed, 1);
        await run(
          'DELETE FROM channel_members WHERE channelId=? AND userId=?',
          f.other,
          f.actor,
        );
        await denied(f, { media: [media.id], verified: [media] });
      },
    );
    await t.test(
      'unrelated public media reference permits own upload while other ownership still fails',
      async () => {
        const f = await fixture(),
          media = await f.upload();
        await f.scheduled(media);
        await denied(f, { media: [media.id], verified: [media] });
        await run(
          'UPDATE users SET avatar=? WHERE id=?',
          '/api/media/' + media.id,
          f.stranger,
        );
        await saved(f, { media: [media.id], verified: [media] });
        await denied(f, {
          me: f.stranger,
          author: f.stranger,
          media: [media.id],
          verified: [media],
        });
      },
    );
    await t.test(
      'pending, deleted and moderated uploads cannot be attached',
      async () => {
        const f = await fixture();
        for (const state of ['pending', 'deleted']) {
          const media = await f.upload(f.actor, state);
          await denied(f, { media: [media.id], verified: [media] });
        }
        const media = await f.upload();
        const removal = randomUUID();
        await run(
          'INSERT INTO content_removals(id,targetType,targetId,postId,authorId,moderatorId,text,snapshot,reason,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
          removal,
          'post',
          removal,
          '',
          f.actor,
          f.owner,
          'Fixture',
          '{}',
          'Fixture',
          f.now,
        );
        await run(
          'INSERT INTO moderated_uploads(uploadId,removalId) VALUES(?,?)',
          media.id,
          removal,
        );
        await denied(f, { media: [media.id], verified: [media] });
      },
    );
    await t.test(
      'read-only actor, target channel or channel owner cannot publish',
      async () => {
        for (const target of ['actor', 'channel', 'owner']) {
          const f = await fixture(),
            user =
              target === 'owner'
                ? f.owner
                : target === 'channel'
                  ? f.channel
                  : f.actor;
          if (target === 'owner') await f.member();
          const id = randomUUID();
          await run(
            "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES(?,?,?,'read_only',?,?)",
            id,
            user,
            f.stranger,
            'Fixture',
            f.now,
          );
          await run(
            "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES(?,?,'read_only',?,?)",
            user,
            id,
            'Fixture',
            f.now,
          );
          await denied(f, {
            author:
              target === 'owner'
                ? f.other
                : target === 'channel'
                  ? f.channel
                  : f.actor,
          });
        }
      },
    );
    await t.test(
      'unsent private chat upload cannot become a personal or owner-channel post',
      async () => {
        const f = await fixture(),
          media = await f.upload(),
          publicMedia = await f.upload();
        await run(
          'INSERT INTO chat_uploads(uploadId,recipient,size,kind) VALUES(?,?,?,?)',
          media.id,
          f.owner,
          12,
          'image',
        );
        await denied(f, { media: [media.id], verified: [media] });
        await denied(f, {
          author: f.channel,
          media: [publicMedia.id, media.id],
          verified: [publicMedia, media],
        });
        assert.equal(
          (
            await first(
              'SELECT COUNT(*) AS count FROM posts WHERE publisherId=?',
              f.actor,
            )
          ).count,
          0,
        );
        await saved(f, { media: [publicMedia.id], verified: [publicMedia] });
      },
    );
    await t.test(
      'sent chat upload remains private after hide/delete and despite a public reference',
      async () => {
        const f = await fixture(),
          media = await f.upload(),
          messageId = randomUUID();
        await run(
          'INSERT INTO messages(id,sender,recipient,text,media,created) VALUES(?,?,?,?,?,?)',
          messageId,
          f.actor,
          f.owner,
          'Private attachment',
          JSON.stringify([media]),
          f.now,
        );
        await run(
          'INSERT INTO chat_uploads(uploadId,recipient,size,kind,messageId) VALUES(?,?,?,?,?)',
          media.id,
          f.owner,
          12,
          'image',
          messageId,
        );
        // A pre-existing public reference must not bypass private-file scope.
        await run(
          'UPDATE users SET avatar=? WHERE id=?',
          '/api/media/' + media.id,
          f.actor,
        );
        await denied(f, { media: [media.id], verified: [media] });
        await run(
          'INSERT INTO hidden_messages(messageId,userId) VALUES(?,?)',
          messageId,
          f.actor,
        );
        await denied(f, {
          author: f.channel,
          media: [media.id],
          verified: [media],
        });
        await run(
          'UPDATE messages SET deletedAt=? WHERE id=?',
          f.now,
          messageId,
        );
        await denied(f, { media: [media.id], verified: [media] });
      },
    );
    assert.deepEqual(
      (await d.prepare('PRAGMA foreign_key_check').all()).results,
      [],
    );
  },
);
