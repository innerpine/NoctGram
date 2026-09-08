// Read-only research harness. Only SQLite :memory: and an in-memory R2 mock are used.
// Run: node tests/upload-storage.test.mjs
// Loads the CURRENT TypeScript functions and EVERY real journal migration; no copied SQL helpers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const journal = JSON.parse(source('drizzle/meta/_journal.json')).entries;
const migrations = journal.map((e) => source('drizzle/' + e.tag + '.sql'));
const url = (text) =>
  'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const compile = (name, imports = {}) => {
  let text = ts.transpileModule(source(name), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  for (const [key, target] of Object.entries(imports)) {
    text = text.replaceAll(
      'from ' + JSON.stringify(key),
      'from ' + JSON.stringify(target),
    );
    text = text.replaceAll(
      "from '" + key + "'",
      'from ' + JSON.stringify(target),
    );
  }
  return url(text);
};
const key = '__noctStorageResearchHarness';
globalThis[key] = {
  current: null,
  tokenHash: async (value) => createHash('sha256').update(value).digest('hex'),
};
const storageModule = url(
  `export const db=()=>globalThis.${key}.current.d1; export const bucket=()=>globalThis.${key}.current.r2;`,
);
const hashModule = url(
  `export const tokenHash=(value)=>globalThis.${key}.tokenHash(value);`,
);
const errorModule = compile('lib/api-error.ts');
const storage = await import(
  compile('lib/upload-storage.ts', {
    './storage': storageModule,
    './api-error': errorModule,
  })
);
const bodies = await import(
  compile('lib/request-body.ts', { './api-error': errorModule })
);
const limits = await import(
  compile('lib/rate-limit.ts', {
    './storage': storageModule,
    './api-error': errorModule,
    './auth-session': hashModule,
  })
);
const DAY = 86400000;
const now = Date.now();
const old = now - 3 * DAY;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// Each SQL operation is atomic, and each asynchronous D1 method yields before executing.
// Promise.all exercises independent reservations against the same authoritative SQLite state.
function d1For(sqlite) {
  class Statement {
    constructor(sql, args = []) {
      this.sql = sql;
      this.args = args;
    }
    bind(...args) {
      return new Statement(this.sql, args);
    }
    execute(kind, column) {
      const statement = sqlite.prepare(this.sql);
      if (kind === 'first') {
        const value = statement.get(...this.args);
        return value ? (column ? value[column] : { ...value }) : null;
      }
      if (kind === 'all')
        return {
          results: statement.all(...this.args).map((row) => ({ ...row })),
          success: true,
        };
      const result = statement.run(...this.args);
      return {
        success: true,
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
        },
      };
    }
    async first(column) {
      await Promise.resolve();
      return this.execute('first', column);
    }
    async all() {
      await Promise.resolve();
      return this.execute('all');
    }
    async run() {
      await Promise.resolve();
      return this.execute('run');
    }
  }
  return {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      await Promise.resolve();
      sqlite.exec('BEGIN');
      try {
        const result = statements.map((s) => s.execute('run'));
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations) sql.exec(migration);
  const objects = new Map();
  const deleteCalls = [];
  const failedDeletes = new Map();
  const failedHeads = new Map();
  const ctx = {
    sql,
    objects,
    deleteCalls,
    failedDeletes,
    failedHeads,
    onDelete: null,
    d1: d1For(sql),
    r2: {
      async head(id) {
        await Promise.resolve();
        if (failedHeads.get(id)) {
          failedHeads.set(id, failedHeads.get(id) - 1);
          throw new Error('HEAD temporarily unavailable');
        }
        return objects.has(id) ? { size: objects.get(id) } : null;
      },
      async delete(id) {
        deleteCalls.push(id);
        await Promise.resolve();
        if (ctx.onDelete) await ctx.onDelete(id);
        if (failedDeletes.get(id)) {
          failedDeletes.set(id, failedDeletes.get(id) - 1);
          throw new Error('R2 temporarily unavailable');
        }
        objects.delete(id);
      },
    },
    user(id = 'alice') {
      sql
        .prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)')
        .run(id, id, now);
      return id;
    },
    upload(
      id,
      {
        owner = 'alice',
        bytes = 512,
        state = 'ready',
        created = old,
        objectSize = bytes || 512,
      } = {},
    ) {
      sql
        .prepare(
          'INSERT INTO uploads(id,userId,type,name,created,bytes,state) VALUES(?,?,?,?,?,?,?)',
        )
        .run(id, owner, 'image/png', id + '.png', created, bytes, state);
      objects.set(id, objectSize);
      return id;
    },
    post(id, media, { user = 'alice', publishAt = 0, cancelledAt = 0 } = {}) {
      sql
        .prepare(
          'INSERT INTO posts(id,userId,text,media,created,publishAt,publisherId,cancelledAt) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          user,
          'fixture',
          JSON.stringify(media),
          old,
          publishAt,
          'alice',
          cancelledAt,
        );
    },
    report(
      id,
      snapshot,
      { type = 'post', target = id, author = 'alice' } = {},
    ) {
      sql
        .prepare(
          'INSERT INTO content_reports(id,targetType,targetId,postId,userId,authorId,text,snapshot,reason,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          type,
          target,
          type === 'post' ? target : '',
          'bob',
          author,
          'evidence',
          JSON.stringify(snapshot),
          'fixture',
          old,
          old,
        );
    },
    removal(id, snapshot, { type = 'post', target = id } = {}) {
      sql
        .prepare(
          'INSERT INTO content_removals(id,targetType,targetId,postId,authorId,moderatorId,text,snapshot,reason,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          type,
          target,
          type === 'post' ? target : '',
          'alice',
          'bob',
          'evidence',
          JSON.stringify(snapshot),
          'fixture',
          old,
        );
    },
    has(id) {
      return !!sql.prepare('SELECT 1 FROM uploads WHERE id=?').get(id);
    },
    state(id) {
      return sql.prepare('SELECT state FROM uploads WHERE id=?').get(id)?.state;
    },
  };
  ctx.user();
  ctx.user('bob');
  return ctx;
}
async function using(fn) {
  const ctx = fixture();
  globalThis[key].current = ctx;
  try {
    await fn(ctx);
    assert.deepEqual(ctx.sql.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    globalThis[key].current = null;
    ctx.sql.close();
  }
}
const fileInfo = (size) => ({ size, name: 'fixture.png', type: 'image/png' });
function chunked(
  bytes,
  {
    size = 9,
    contentType = 'multipart/form-data; boundary=storage-boundary',
    length,
  } = {},
) {
  let offset = 0,
    cancelled = false;
  const headers = { 'Content-Type': contentType };
  if (length !== undefined) headers['Content-Length'] = String(length);
  const body = new ReadableStream(
    {
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        const end = Math.min(offset + size, bytes.length);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const req = new Request('https://fixture.invalid/api/upload', {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  });
  return { req, cancelled: () => cancelled, consumed: () => offset };
}
function multipart(parts) {
  const value =
    parts
      .map(
        (p) =>
          '--storage-boundary\r\nContent-Disposition: form-data; name="' +
          p.name +
          '"' +
          (p.filename === undefined ? '' : '; filename="' + p.filename + '"') +
          '\r\n' +
          (p.filename === undefined ? '' : 'Content-Type: image/png\r\n') +
          '\r\n' +
          p.value +
          '\r\n',
      )
      .join('') + '--storage-boundary--\r\n';
  return new TextEncoder().encode(value);
}

test('multipart accepts exact byte boundary without Content-Length', async () => {
  const bytes = multipart([
    { name: 'file', filename: 'test.png', value: 'PNG fixture' },
  ]);
  const form = await bodies.readMultipart(chunked(bytes).req, bytes.length);
  assert.equal(form.get('file').name, 'test.png');
  assert.equal(await form.get('file').text(), 'PNG fixture');
});
test('multipart counts chunked bytes and ignores a false small Content-Length', async () => {
  const bytes = multipart([
    { name: 'file', filename: 'test.png', value: 'x'.repeat(3 * 1024 * 1024) },
  ]);
  for (const length of [undefined, 1]) {
    const stream = chunked(bytes, { length, size: 16384 });
    await assert.rejects(
      () => bodies.readMultipart(stream.req, 100),
      (e) => e.status === 413,
    );
    assert.equal(stream.cancelled(), true);
    assert.ok(
      stream.consumed() <= 100 + 16384 + 1048576 + 16384,
      'Only a bounded tail can be discarded after rejection',
    );
  }
});
test('multipart rejects duplicate files, extra fields, malformed boundary and wrong type', async () => {
  const file = { name: 'file', filename: 'test.png', value: 'x' };
  for (const parts of [
    [file, file],
    [file, { name: 'ignored', value: 'x' }],
    [],
  ]) {
    await assert.rejects(
      () => bodies.readMultipart(chunked(multipart(parts)).req, 4096),
      (e) => e.status === 400,
    );
  }
  await assert.rejects(
    () =>
      bodies.readMultipart(
        chunked(new TextEncoder().encode('broken')).req,
        4096,
      ),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () =>
      bodies.readMultipart(
        chunked(new Uint8Array(), { contentType: 'application/json' }).req,
        4096,
      ),
    (e) => e.status === 415,
  );
});
test('parallel reservations cannot overspend the byte quota', () =>
  using(async (ctx) => {
    ctx.upload('existing', {
      bytes: storage.STORAGE_BYTES - 100,
      created: now,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        storage.reserveUpload('parallel_' + i, 'alice', fileInfo(50)),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
    for (const r of results.filter((r) => r.status === 'rejected'))
      assert.equal(r.reason.code, 'STORAGE_QUOTA');
    const usage = await storage.storageUsage('alice');
    assert.equal(usage.bytes, storage.STORAGE_BYTES);
    assert.equal(usage.files, 3);
  }));
test('parallel reservations honor file count and unknown legacy sizes', () =>
  using(async (ctx) => {
    const insert = ctx.sql.prepare(
      "INSERT INTO uploads(id,userId,type,name,created,bytes,state) VALUES(?,'alice','image/png','fixture',?,1,'ready')",
    );
    for (let i = 0; i < storage.STORAGE_FILES - 1; i++)
      insert.run('file_' + i, now);
    const results = await Promise.allSettled([
      storage.reserveUpload('slot_a', 'alice', fileInfo(1)),
      storage.reserveUpload('slot_b', 'alice', fileInfo(1)),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    ctx.upload('legacy', { owner: 'bob', bytes: 0 });
    assert.equal((await storage.storageUsage('bob')).bytes, 25 * 1024 * 1024);
  }));
test('deleted accounts cannot reserve a new upload', () =>
  using(async (ctx) => {
    ctx.sql
      .prepare('UPDATE users SET deletedAt=? WHERE id=?')
      .run(now, 'alice');
    await assert.rejects(() =>
      storage.reserveUpload('forbidden', 'alice', fileInfo(1)),
    );
    assert.equal(ctx.has('forbidden'), false);
  }));
test('GC preserves every dormant content/profile/evidence reference and deletes only orphan', () =>
  using(async (ctx) => {
    const kept = [
      'avatar',
      'cover',
      'motion',
      'future',
      'cancelled',
      'story',
      'report_array',
      'report_string',
      'report_story',
      'removal_array',
      'removal_string',
      'removal_story',
      'moderated',
    ];
    for (const id of kept) ctx.upload(id);
    ctx.upload('orphan');
    ctx.upload('recent', { created: now });
    ctx.sql
      .prepare(
        "UPDATE users SET avatar='/api/media/avatar',cover='/api/media/cover' WHERE id='alice'",
      )
      .run();
    ctx.sql
      .prepare(
        "INSERT INTO profile_appearance(userId,avatarMotion,updated) VALUES('alice','/api/media/motion',?)",
      )
      .run(old);
    ctx.sql
      .prepare(
        "INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) VALUES('alice',0,1,'fixture',?)",
      )
      .run(old);
    ctx.sql
      .prepare(
        "INSERT INTO users(id,name,created,kind,ownerId) VALUES('channel_fixture','Channel',?,'channel','alice')",
      )
      .run(old);
    ctx.post('future_post', [{ id: 'future' }], {
      user: 'channel_fixture',
      publishAt: now + DAY,
    });
    ctx.post('cancelled_post', [{ id: 'cancelled' }], {
      user: 'channel_fixture',
      publishAt: now + DAY,
      cancelledAt: now,
    });
    ctx.sql
      .prepare(
        "INSERT INTO stories(id,userId,mediaId,text,created,expiresAt) VALUES('story_fixture','alice','story','fixture',?,?)",
      )
      .run(old, now + DAY);
    ctx.report('array_report', { media: [{ id: 'report_array' }] });
    ctx.report('string_report', {
      media: JSON.stringify([{ id: 'report_string' }]),
    });
    ctx.report('story_report', { mediaId: 'report_story' }, { type: 'story' });
    ctx.removal('array_removal', { media: [{ id: 'removal_array' }] });
    ctx.removal('string_removal', {
      media: JSON.stringify([{ id: 'removal_string' }]),
    });
    ctx.removal(
      'story_removal',
      { mediaId: 'removal_story' },
      { type: 'story' },
    );
    ctx.sql
      .prepare(
        "INSERT INTO moderated_uploads(uploadId,removalId) VALUES('moderated','array_removal')",
      )
      .run();
    // A blocked owner must not lose existing media even though public visibility is disabled.
    ctx.sql
      .prepare(
        "INSERT INTO moderation_events(id,userId,moderatorId,mode,reason,created) VALUES('block','alice','bob','blocked','fixture',?)",
      )
      .run(now);
    ctx.sql
      .prepare(
        "INSERT INTO account_restrictions(userId,eventId,mode,reason,created) VALUES('alice','block','blocked','fixture',?)",
      )
      .run(now);
    const result = await storage.cleanUploads();
    assert.equal(result.removed, 1);
    assert.equal(ctx.has('orphan'), false);
    assert.equal(ctx.objects.has('orphan'), false);
    for (const id of [...kept, 'recent']) {
      assert.equal(ctx.has(id), true, id);
      assert.equal(ctx.objects.has(id), true, id);
    }
  }));
test('expired unreported stories are pruned with views, reported evidence remains', () =>
  using(async (ctx) => {
    for (const id of ['expired', 'reported']) ctx.upload(id);
    for (const id of ['expired', 'reported'])
      ctx.sql
        .prepare(
          'INSERT INTO stories(id,userId,mediaId,text,created,expiresAt) VALUES(?,?,?,?,?,?)',
        )
        .run(id, 'alice', id, 'fixture', now - 10 * DAY, now - 8 * DAY);
    ctx.sql
      .prepare(
        "INSERT INTO story_views(storyId,userId,created) VALUES('expired','bob',?)",
      )
      .run(old);
    ctx.report(
      'keep_story',
      { mediaId: 'reported' },
      { type: 'story', target: 'reported' },
    );
    await storage.cleanUploads();
    assert.equal(ctx.has('expired'), false);
    assert.equal(ctx.has('reported'), true);
    assert.equal(
      ctx.sql.prepare('SELECT COUNT(*) AS n FROM story_views').get().n,
      0,
    );
    assert.equal(
      ctx.sql
        .prepare("SELECT COUNT(*) AS n FROM stories WHERE id='reported'")
        .get().n,
      1,
    );
  }));
test('failed R2 deletion keeps quota charged and retries idempotently', () =>
  using(async (ctx) => {
    ctx.upload('retry');
    ctx.failedDeletes.set('retry', 1);
    const first = await storage.cleanUploads();
    assert.equal(first.removed, 0);
    assert.equal(ctx.state('retry'), 'deleting');
    assert.equal(ctx.objects.has('retry'), true);
    assert.equal((await storage.storageUsage('alice')).bytes, 512);
    const second = await storage.cleanUploads();
    assert.equal(second.removed, 1);
    assert.equal(ctx.has('retry'), false);
    assert.equal(ctx.objects.has('retry'), false);
    assert.equal((await storage.storageUsage('alice')).bytes, 0);
    assert.equal((await storage.cleanUploads()).removed, 0);
  }));
test('durable music outbox retries deletion without touching other music objects', () =>
  using(async (ctx) => {
    ctx.objects.set('music/delete', 123);
    ctx.objects.set('music/keep', 123);
    ctx.failedDeletes.set('music/delete', 1);
    ctx.sql
      .prepare(
        "INSERT INTO storage_deletions(objectKey,created) VALUES('music/delete',?)",
      )
      .run(old);
    await storage.cleanUploads();
    assert.equal(
      ctx.sql.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get().n,
      1,
    );
    await storage.cleanUploads();
    assert.equal(
      ctx.sql.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get().n,
      0,
    );
    assert.equal(ctx.objects.has('music/delete'), false);
    assert.equal(ctx.objects.has('music/keep'), true);
  }));
test('once GC claims an upload, all attachment inserts and updates fail atomically', () =>
  using(async (ctx) => {
    ctx.upload('racing');
    ctx.post('existing_post', []);
    ctx.sql
      .prepare(
        "INSERT INTO profile_appearance(userId,updated) VALUES('alice',?)",
      )
      .run(old);
    ctx.sql
      .prepare(
        "INSERT INTO stories(id,userId,text,created,expiresAt) VALUES('existing_story','alice','fixture',?,?)",
      )
      .run(old, now + DAY);
    ctx.report('existing_report', {});
    ctx.removal('existing_removal', {});
    let checks = 0;
    ctx.onDelete = async (id) => {
      if (id !== 'racing') return;
      assert.equal(ctx.state(id), 'deleting');
      const rejected = [
        () => ctx.post('racing_post', [{ id }]),
        () =>
          ctx.sql
            .prepare('UPDATE posts SET media=? WHERE id=?')
            .run(JSON.stringify([{ id }]), 'existing_post'),
        () =>
          ctx.sql
            .prepare(
              "UPDATE users SET avatar='/api/media/racing' WHERE id='alice'",
            )
            .run(),
        () =>
          ctx.sql
            .prepare(
              "UPDATE users SET cover='/api/media/racing' WHERE id='alice'",
            )
            .run(),
        () =>
          ctx.sql
            .prepare(
              "INSERT INTO users(id,name,created,avatar) VALUES('racing_channel','Channel',?,'/api/media/racing')",
            )
            .run(now),
        () =>
          ctx.sql
            .prepare(
              "UPDATE profile_appearance SET avatarMotion='/api/media/racing' WHERE userId='alice'",
            )
            .run(),
        () =>
          ctx.sql
            .prepare(
              "INSERT INTO profile_appearance(userId,avatarMotion,updated) VALUES('bob','/api/media/racing',?)",
            )
            .run(now),
        () =>
          ctx.sql
            .prepare(
              "INSERT INTO stories(id,userId,mediaId,text,created,expiresAt) VALUES('racing_story','alice','racing','fixture',?,?)",
            )
            .run(now, now + DAY),
        () =>
          ctx.sql
            .prepare(
              "UPDATE stories SET mediaId='racing' WHERE id='existing_story'",
            )
            .run(),
        () => ctx.report('racing_report', { media: JSON.stringify([{ id }]) }),
        () =>
          ctx.sql
            .prepare('UPDATE content_reports SET snapshot=? WHERE id=?')
            .run(JSON.stringify({ mediaId: id }), 'existing_report'),
        () => ctx.removal('racing_removal', { media: [{ id }] }),
        () =>
          ctx.sql
            .prepare('UPDATE content_removals SET snapshot=? WHERE id=?')
            .run(JSON.stringify({ mediaId: id }), 'existing_removal'),
        () =>
          ctx.sql
            .prepare(
              "INSERT INTO moderated_uploads(uploadId,removalId) VALUES('racing','existing_removal')",
            )
            .run(),
      ];
      for (const operation of rejected) {
        assert.throws(operation, /MEDIA_NOT_READY/);
        checks++;
      }
    };
    await storage.cleanUploads();
    assert.equal(checks, 14);
    assert.equal(ctx.has('racing'), false);
    assert.equal(ctx.objects.has('racing'), false);
  }));
test('uploading reservations cannot be attached; a recent reservation is not collected', () =>
  using(async (ctx) => {
    await storage.reserveUpload('pending', 'alice', fileInfo(100));
    assert.throws(
      () => ctx.post('pending_post', [{ id: 'pending' }]),
      /MEDIA_NOT_READY/,
    );
    assert.throws(
      () =>
        ctx.sql
          .prepare(
            "UPDATE users SET avatar='/api/media/pending' WHERE id='alice'",
          )
          .run(),
      /MEDIA_NOT_READY/,
    );
    await storage.cleanUploads();
    assert.equal(ctx.state('pending'), 'uploading');
  }));
test('transient legacy HEAD failure must not block unrelated orphan cleanup', () =>
  using(async (ctx) => {
    ctx.upload('head_failure', { bytes: 0 });
    ctx.upload('unrelated');
    ctx.failedHeads.set('head_failure', 1);
    await storage.cleanUploads();
    assert.equal(ctx.has('unrelated'), false);
  }));
test('a deleted legacy owner must not permanently poison cleanup', () =>
  using(async (ctx) => {
    ctx.upload('deleted_owner_legacy', { bytes: 0 });
    ctx.upload('unrelated', { owner: 'bob' });
    ctx.sql.prepare("UPDATE users SET deletedAt=? WHERE id='alice'").run(now);
    await storage.cleanUploads();
    assert.equal(ctx.has('deleted_owner_legacy'), false);
    assert.equal(ctx.has('unrelated'), false);
  }));
test('parallel rate-limit attempts cannot exceed max, have retryAfter, and reset after expiry', () =>
  using(async (ctx) => {
    const result = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        limits.rateLimit('fixture', 'alice', 5, 60),
      ),
    );
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 5);
    for (const r of result.filter((r) => r.status === 'rejected')) {
      assert.equal(r.reason.status, 429);
      assert.ok(r.reason.retryAfter > 0);
    }
    await limits.rateLimit('fixture', 'bob', 5, 60);
    ctx.sql.prepare('UPDATE auth_limits SET expiresAt=1').run();
    await limits.rateLimit('fixture', 'alice', 5, 60);
    assert.equal(
      ctx.sql
        .prepare('SELECT count FROM auth_limits WHERE key=?')
        .get('action:fixture:' + (await globalThis[key].tokenHash('alice')))
        .count,
      1,
    );
  }));
test('report types share one actor quota and safety exit actions remain available', () =>
  using(async () => {
    for (let i = 0; i < 8; i++)
      await limits.socialRateLimit(
        'alice',
        ['report', 'reportComment', 'reportStory', 'reportMessage'][i % 4],
      );
    await assert.rejects(
      () => limits.socialRateLimit('alice', 'reportMessage'),
      (e) => e.status === 429,
    );
    for (const action of [
      'callEnd',
      'telegramUnlink',
      'telegramCancel',
      'pushUnsubscribe',
    ])
      await limits.socialRateLimit('alice', action);
    await limits.socialRateLimit('bob', 'report');
  }));

test('music cleanup preserves a live reference and an unfinished recent upload', () =>
  using(async (ctx) => {
    ctx.objects.set('music/live', 123);
    ctx.objects.set('music/pending', 123);
    ctx.sql
      .prepare(
        "INSERT INTO music_tracks(id,url,kind,title,artist,authorUrl,created) VALUES('gc_track','https://example.test/track','track','Fixture','Fixture','https://example.test',?)",
      )
      .run(old);
    ctx.sql
      .prepare(
        "INSERT INTO music_audio(userId,trackId,objectKey,mime,size,created) VALUES('alice','gc_track','music/live','audio/mpeg',123,?)",
      )
      .run(old);
    ctx.sql
      .prepare(
        "INSERT INTO storage_deletions(objectKey,created) VALUES('music/live',?),('music/pending',?)",
      )
      .run(old, now);
    await storage.cleanUploads();
    assert.equal(ctx.objects.has('music/live'), true);
    assert.equal(ctx.objects.has('music/pending'), true);
    ctx.sql
      .prepare("DELETE FROM music_audio WHERE objectKey='music/live'")
      .run();
    await storage.cleanUploads();
    assert.equal(ctx.objects.has('music/live'), false);
    assert.equal(ctx.objects.has('music/pending'), true);
  }));

test('chat attachments survive source deletion while a forwarded copy still references them', () =>
  using(async (ctx) => {
    ctx.upload('chat-file');
    ctx.sql.exec(
      "INSERT INTO chat_uploads(uploadId,recipient,size,kind) VALUES('chat-file','bob',512,'image')",
    );
    const media = JSON.stringify([{ id: 'chat-file', kind: 'image' }]);
    const insert = ctx.sql.prepare(
      "INSERT INTO messages(id,sender,recipient,text,media,created) VALUES(?,'alice','bob','',?,?)",
    );
    insert.run('source', media, old);
    insert.run('forwarded', media, now);
    ctx.sql.exec(
      "UPDATE messages SET deletedAt=1,media='[]' WHERE id='source'",
    );
    await storage.cleanUploads();
    assert.equal(ctx.has('chat-file'), true);
    assert.equal(ctx.objects.has('chat-file'), true);
    ctx.sql.exec("DELETE FROM messages WHERE id='forwarded'");
    await storage.cleanUploads();
    assert.equal(ctx.has('chat-file'), false);
    assert.equal(ctx.objects.has('chat-file'), false);
  }));
test('chat inserts and edits cannot attach a file claimed by cleanup or still uploading', () =>
  using(async (ctx) => {
    ctx.sql.exec(
      "INSERT INTO messages(id,sender,recipient,text,created) VALUES('editable','alice','bob','hello',1)",
    );
    for (const state of ['uploading', 'deleting']) {
      ctx.upload(state, { state });
      const media = JSON.stringify([{ id: state }]);
      assert.throws(
        () =>
          ctx.sql
            .prepare(
              "INSERT INTO messages(id,sender,recipient,text,media,created) VALUES(?,'alice','bob','',?,1)",
            )
            .run(state, media),
        /MEDIA_NOT_READY/,
      );
      assert.throws(
        () =>
          ctx.sql
            .prepare("UPDATE messages SET media=? WHERE id='editable'")
            .run(media),
        /MEDIA_NOT_READY/,
      );
    }
    assert.equal(
      ctx.sql.prepare("SELECT text FROM messages WHERE id='editable'").get()
        .text,
      'hello',
    );
  }));

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (error) {
    failures++;
    console.error('FAIL ' + name + '\n  ' + (error?.stack || error));
  }
}
delete globalThis[key];
console.log(
  `${tests.length - failures}/${tests.length} passed; source=${root}; migrations=${journal.length}; SQLite and R2 fixtures only.`,
);
if (failures) process.exitCode = 1;
