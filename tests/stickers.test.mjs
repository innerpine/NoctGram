import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

// Sticker packs made by people, built-in stickers and custom emoji through
// the real routes and SQL: uploads, sending, forwarding, reports, moderation.
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
const journal = JSON.parse(
  await readFile('drizzle/meta/_journal.json', 'utf8'),
);
for (const { tag } of journal.entries)
  sql.exec(await readFile('drizzle/' + tag + '.sql', 'utf8'));
sql.exec(`INSERT INTO users(id,name,created) VALUES('alice','Alice',1),('bob','Bob',1),('carol','Carol',1),('dave','Dave',1);
  INSERT INTO handles(handle,userId,main) VALUES('alice','alice',1),('bob','bob',1),('carol','carol',1),('dave','dave',1);
  INSERT INTO moderators(userId,created) VALUES('carol',1);
  INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) VALUES('dave',0,${Date.now() + 86400000},'admin',1);`);
const objects = new Map();
globalThis.__stickerDB = {
  prepare(query) {
    return {
      query,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        return sql.prepare(query).get(...this.args) || null;
      },
      async all() {
        return { results: sql.prepare(query).all(...this.args) };
      },
      async run() {
        if (/^\s*SELECT\b/i.test(query))
          return {
            results: sql.prepare(query).all(...this.args),
            meta: { changes: 0 },
          };
        return {
          meta: {
            changes: Number(sql.prepare(query).run(...this.args).changes),
          },
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
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
globalThis.__stickerBucket = {
  async put(id, bytes, metadata) {
    objects.set(id, { bytes, metadata });
  },
  async delete(id) {
    objects.delete(id);
  },
  async head(id) {
    return objects.has(id) ? { size: objects.get(id).bytes.length } : null;
  },
  async get(id) {
    const object = objects.get(id);
    if (!object) return null;
    return {
      body: object.bytes,
      size: object.bytes.length,
      httpEtag: '"fixture"',
      writeHttpMetadata(headers) {
        headers.set('Content-Type', object.metadata.httpMetadata.contentType);
      },
    };
  },
};
globalThis.__stickerHeaders = new Headers();
const { outputFiles } = await build({
  stdin: {
    contents: `export { GET as stickersGET, POST as stickersPOST } from './app/api/stickers/route';
      export { GET as socialGET, POST as socialPOST } from './app/api/social/route';
      export { POST as forwardPOST } from './app/api/chat-forward/route';
      export { GET as mediaGET } from './app/api/media/[id]/route';
      export { changeRoom, readRoom, listRooms } from './lib/rooms';
      export { readConversation } from './lib/chat-messages';
      export { cleanUploads } from './lib/upload-storage';
      export { mediaPermission } from './lib/media-access';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'sticker-fixture',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(cloudflare:workers|next\/headers|next\/server|next\/navigation|(\.\/|@\/lib\/)storage)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'cloudflare:workers'
              ? 'export const env={NOCT_AUTH_MODE:"hybrid"};'
              : path === 'next/server'
                ? 'export const after=()=>{};'
                : path === 'next/headers'
                  ? 'export const headers=async()=>globalThis.__stickerHeaders; export const cookies=async()=>({get:()=>undefined,set:()=>{}});'
                  : path === 'next/navigation'
                    ? 'export const redirect=()=>{throw new Error("Unexpected redirect")};'
                    : 'export const db=()=>globalThis.__stickerDB; export const bucket=()=>globalThis.__stickerBucket;',
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const as = (viewer) => {
  sql.exec('DELETE FROM auth_limits');
  globalThis.__stickerHeaders = new Headers({
    'oai-authenticated-user-id': viewer,
    'oai-authenticated-user-email': viewer + '@example.test',
  });
};
const json = async (response) => ({
  status: response.status,
  body: await response.json(),
  headers: response.headers,
});
const key = () => crypto.randomUUID();
async function stickers(viewer, body) {
  as(viewer);
  return json(
    await api.stickersPOST(
      new Request('http://localhost/api/stickers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  );
}
async function read(viewer, query) {
  as(viewer);
  return json(
    await api.stickersGET(
      new Request('http://localhost/api/stickers?' + query),
    ),
  );
}
async function upload(viewer, pack, emoji, bytes, name = 'sticker') {
  as(viewer);
  const form = new FormData();
  form.set('file', new File([bytes], name));
  form.set('pack', pack);
  form.set('emoji', emoji);
  return json(
    await api.stickersPOST(
      new Request('http://localhost/api/stickers', {
        method: 'POST',
        body: form,
      }),
    ),
  );
}
async function social(viewer, body) {
  as(viewer);
  return json(
    await api.socialPOST(
      new Request('http://localhost/api/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  );
}
async function socialRead(viewer, query) {
  as(viewer);
  return json(
    await api.socialGET(
      new Request('http://localhost/api/social?' + query + '&actor=' + viewer),
    ),
  );
}
async function media(viewer, id) {
  as(viewer);
  return api.mediaGET(new Request('http://localhost/api/media/' + id), {
    params: Promise.resolve({ id }),
  });
}
const png = (width, height, size = 33) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};
const webp = (() => {
  const bytes = new Uint8Array(40);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  bytes.set(new TextEncoder().encode('VP8X'), 12);
  bytes.set([0xff, 0x01, 0, 0xff, 0x01, 0], 24);
  return bytes;
})();
const lottie = (patch = {}) => ({
  v: '5.5.2',
  fr: 60,
  ip: 0,
  op: 120,
  w: 512,
  h: 512,
  layers: [{ ty: 4, shapes: [] }],
  ...patch,
});
const tgs = (data) => new Uint8Array(gzipSync(JSON.stringify(data)));
const uploads = (state) =>
  sql.prepare('SELECT COUNT(*) AS n FROM uploads WHERE state=?').get(state).n;

// Packs: names, limits and validation.
const cats = await stickers('alice', {
  action: 'createPack',
  title: '  Коты   и кошки ',
  shortName: 'Alice_Cats',
  type: 'stickers',
});
assert.equal(cats.status, 200);
assert.equal(cats.body.title, 'Коты и кошки');
assert.equal(cats.body.shortName, 'alice_cats');
assert.equal(cats.body.own, true);
assert.equal(cats.body.installed, true, 'A new pack is in its author’s panel');
assert.equal(
  (
    await stickers('bob', {
      action: 'createPack',
      title: 'Мои',
      shortName: 'alice_cats',
    })
  ).status,
  409,
);
assert.equal(
  (
    await stickers('bob', {
      action: 'createPack',
      title: 'Мои',
      shortName: 'noct_official',
    })
  ).status,
  409,
);
assert.equal(
  (
    await stickers('bob', {
      action: 'createPack',
      title: 'Мои',
      shortName: 'ab',
    })
  ).status,
  400,
);
assert.equal(
  (
    await stickers('bob', {
      action: 'createPack',
      title: '',
      shortName: 'bob_pack',
    })
  ).status,
  400,
);

// Uploads are checked by content before anything is stored.
const before = objects.size;
for (const [bytes, pattern, status = 400] of [
  [png(600, 600), /16 до 512/],
  [png(10, 10), /16 до 512/],
  [png(512, 512, 600 * 1024), /512 КБ/, 413],
  [
    new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]),
    /WebP, PNG и TGS/,
  ],
  [tgs(lottie({ w: 256, h: 256 })), /512×512/],
  [tgs(lottie({ op: 400 })), /длиннее 3/],
  [
    tgs(lottie({ layers: [{ ty: 4, ks: { o: { a: 0, k: 1, x: 'x()' } } }] })),
    /Выражения/,
  ],
]) {
  const rejected = await upload('alice', cats.body.id, '😺', bytes);
  assert.equal(rejected.status, status, String(pattern));
  assert.match(rejected.body.error, pattern);
}
assert.equal(objects.size, before, 'Rejected files never reach storage');
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM uploads').get().n, 0);
assert.equal(
  (await upload('alice', cats.body.id, 'кот', png(512, 512))).status,
  400,
);
assert.equal(
  (await upload('bob', cats.body.id, '😺', png(512, 512))).status,
  404,
  'Only the author adds stickers',
);
const still = await upload('alice', cats.body.id, '😺', png(512, 512));
assert.equal(still.status, 200);
assert.equal(still.body.format, 'png');
assert.match(still.body.src, /^\/api\/media\/[0-9a-f-]{36}$/);
assert.equal(still.body.token, undefined);
const photo = await upload('alice', cats.body.id, '😸', webp);
assert.equal(photo.body.format, 'webp');
const moving = await upload('alice', cats.body.id, '😹', tgs(lottie()));
assert.equal(moving.body.format, 'tgs');
assert.equal(moving.body.w, 512);
const stillUpload = still.body.src.slice('/api/media/'.length);
assert.equal(
  objects.get(stillUpload).metadata.httpMetadata.contentType,
  'image/png',
);
assert.equal(
  objects.get(moving.body.src.slice('/api/media/'.length)).metadata.httpMetadata
    .contentType,
  'application/x-tgsticker',
);
assert.equal(uploads('ready'), 3);

// Panel, previews, installs and resolving.
const alicePanel = await read('alice', 'action=panel');
assert.deepEqual(
  alicePanel.body.packs.map((pack) => [pack.shortName, pack.stickers.length]),
  [['alice_cats', 3]],
);
assert.equal(alicePanel.body.limits.favorites, 5);
const preview = await read('bob', 'action=pack&name=alice_cats');
assert.equal(preview.status, 200);
assert.equal(preview.body.installed, false);
assert.equal(preview.body.own, false);
assert.deepEqual(
  (await read('bob', 'action=pack&name=u:' + cats.body.id)).body.id,
  cats.body.id,
);
const builtin = await read('bob', 'action=pack&name=utya');
assert.equal(builtin.body.builtin, true);
assert.equal(builtin.body.stickers[0].ref, 'b:utya:birthday');
assert.equal((await read('bob', 'action=pack&name=nothing_here')).status, 404);
// The iOS app lists the built-in packs instead of bundling the catalog.
const builtins = (await read('bob', 'action=builtin')).body.packs;
assert.deepEqual(
  builtins.map((pack) => pack.ref),
  ['b:utya', 'b:monkey', 'b:holiday', 'b:tgweb'],
);
assert.equal(builtins[3].type, 'emoji');
assert.equal(builtins[3].stickers[0].token, ':noct_star_gold:');
assert.equal(
  (await stickers('bob', { action: 'install', ref: 'u:' + cats.body.id }))
    .status,
  200,
);
assert.deepEqual(
  (await read('bob', 'action=panel')).body.packs.map((pack) => pack.id),
  [cats.body.id],
);
const missing = crypto.randomUUID();
const resolved = await read(
  'bob',
  `action=resolve&refs=${still.body.ref},b:utya:birthday,u:${missing},b:tgweb:star_gold`,
);
assert.deepEqual(
  resolved.body.stickers.map((sticker) => [sticker.ref, sticker.available]),
  [
    [still.body.ref, true],
    ['b:utya:birthday', true],
    ['u:' + missing, false],
    ['b:tgweb:star_gold', true],
  ],
);
assert.equal(resolved.body.stickers[2].src, '');
assert.equal(resolved.body.stickers[3].token, ':noct_star_gold:');
const served = await media('bob', stillUpload);
assert.equal(served.status, 200, 'A live sticker is visible to everyone');
assert.equal(served.headers.get('cache-control'), 'private, max-age=3600');
assert.equal(served.headers.get('x-content-type-options'), 'nosniff');

// A sticker file cannot be reused as a profile or post picture.
assert.equal(
  sql
    .prepare(`SELECT ${api.mediaPermission('?1', '?2')} AS ok`)
    .get(stillUpload, 'alice').ok,
  0,
);

// Sending stickers in direct chats.
const dm = await social('bob', {
  action: 'message',
  id: 'alice',
  text: '',
  sticker: still.body.ref,
  key: key(),
});
assert.equal(dm.status, 200);
const bi = key();
assert.equal(
  (
    await social('bob', {
      action: 'message',
      id: 'alice',
      sticker: 'b:utya:birthday',
      key: bi,
    })
  ).status,
  200,
);
assert.equal(
  (
    await social('bob', {
      action: 'message',
      id: 'alice',
      sticker: 'b:utya:birthday',
      key: bi,
    })
  ).status,
  200,
  'A retried send is idempotent',
);
assert.equal(
  (
    await social('bob', {
      action: 'message',
      id: 'alice',
      sticker: 'b:utya:search',
      key: bi,
    })
  ).status,
  409,
);
for (const [sticker, status] of [
  ['u:' + missing, 404],
  ['b:tgweb:star_gold', 400],
  ['b:utya:unknown', 400],
  ['u:not-a-uuid', 404],
])
  assert.equal(
    (
      await social('bob', {
        action: 'message',
        id: 'alice',
        sticker,
        key: key(),
      })
    ).status,
    status,
    sticker,
  );
assert.equal(
  (
    await social('bob', {
      action: 'message',
      id: 'alice',
      text: 'и текст',
      sticker: still.body.ref,
      key: key(),
    })
  ).status,
  400,
);
const conversation = await api.readConversation('alice', 'bob');
assert.deepEqual(
  conversation.map((message) => message.sticker),
  [still.body.ref, 'b:utya:birthday'],
);
assert.equal(conversation[0].text, '');
const threads = await socialRead('alice', 'action=threads');
assert.equal(threads.body.find((row) => row.id === 'bob').lastText, 'Стикер');

// Groups and forwarding.
const group = await api.changeRoom('alice', {
  action: 'create',
  kind: 'group',
  name: 'Стикеры',
  memberIds: ['bob'],
});
const roomSticker = key();
await api.changeRoom('bob', {
  action: 'send',
  id: group.id,
  key: roomSticker,
  sticker: photo.body.ref,
});
await api.changeRoom('bob', {
  action: 'send',
  id: group.id,
  key: roomSticker,
  sticker: photo.body.ref,
});
await assert.rejects(
  api.changeRoom('bob', {
    action: 'send',
    id: group.id,
    key: roomSticker,
    sticker: still.body.ref,
  }),
  /другого сообщения/,
);
await assert.rejects(
  api.changeRoom('bob', {
    action: 'send',
    id: group.id,
    key: key(),
    text: 'Текст',
    sticker: photo.body.ref,
  }),
  /отдельным сообщением/,
);
const roomRead = await api.readRoom('alice', group.id);
assert.equal(
  roomRead.messages.find((message) => message.id === roomSticker).sticker,
  photo.body.ref,
);
assert.equal(
  (await api.listRooms('alice')).rooms.find((room) => room.id === group.id)
    .lastMessage.text,
  'Стикер',
);
as('alice');
const forwarded = await json(
  await api.forwardPOST(
    new Request('http://localhost/api/chat-forward', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: key(),
        source: { dm: { peer: 'bob', ids: [dm.body.id] } },
        targets: [{ room: { roomId: group.id } }, { dm: { peer: 'alice' } }],
      }),
    }),
  ),
);
assert.equal(forwarded.status, 200);
const [roomCopy] = forwarded.body.results[0].ids;
const copied = (await api.readRoom('bob', group.id)).messages.find(
  (message) => message.id === roomCopy,
);
assert.equal(copied.sticker, still.body.ref);
assert.equal(copied.forwardedName, 'Bob');
assert.equal(
  (await api.readConversation('alice', 'alice')).at(-1).sticker,
  still.body.ref,
  'Stickers can be kept in «Избранное»',
);

// Favourites keep the newest five without Premium.
for (const slug of [
  'birthday',
  'disappear',
  'discussion',
  'links',
  'passcode',
  'restricted',
])
  assert.equal(
    (await stickers('bob', { action: 'fave', ref: 'b:utya:' + slug, on: true }))
      .status,
    200,
  );
assert.deepEqual(
  (await read('bob', 'action=panel')).body.favorites.map(
    (sticker) => sticker.ref,
  ),
  ['restricted', 'passcode', 'links', 'discussion', 'disappear'].map(
    (slug) => 'b:utya:' + slug,
  ),
);
assert.equal(
  (
    await stickers('bob', {
      action: 'fave',
      ref: 'b:tgweb:star_gold',
      on: true,
    })
  ).status,
  404,
  'Custom emoji are not favourite stickers',
);
await stickers('bob', { action: 'fave', ref: still.body.ref, on: true });
assert.equal(
  (await read('bob', 'action=panel')).body.favorites[0].ref,
  still.body.ref,
);

// Order and emoji of stickers.
const ids = [moving.body.ref, photo.body.ref, still.body.ref].map((ref) =>
  ref.slice(2),
);
assert.equal(
  (await stickers('alice', { action: 'reorder', id: cats.body.id, ids }))
    .status,
  200,
);
assert.deepEqual(
  (await read('bob', 'action=pack&name=alice_cats')).body.stickers.map(
    (sticker) => sticker.ref,
  ),
  [moving.body.ref, photo.body.ref, still.body.ref],
);
assert.equal(
  (
    await stickers('alice', {
      action: 'reorder',
      id: cats.body.id,
      ids: ids.slice(1),
    })
  ).status,
  409,
);
assert.equal(
  (await stickers('bob', { action: 'reorder', id: cats.body.id, ids })).status,
  404,
);
await stickers('alice', { action: 'updateSticker', id: ids[0], emoji: '🔥' });
assert.equal(
  (await read('bob', 'action=pack&name=alice_cats')).body.stickers[0].emoji,
  '🔥',
);

// Custom emoji from a pack made by a person need Premium, like Telegram.
const faces = await stickers('alice', {
  action: 'createPack',
  title: 'Лица',
  shortName: 'alice_faces',
  type: 'emoji',
});
const face = await upload('alice', faces.body.id, '🙂', png(100, 100));
assert.equal(face.status, 200);
assert.equal(face.body.token, ':ce_' + face.body.ref.slice(2) + ':');
assert.equal(
  (
    await social('bob', {
      action: 'message',
      id: 'alice',
      text: 'Привет ' + face.body.token,
      key: key(),
    })
  ).status,
  403,
);
assert.equal(
  (
    await social('dave', {
      action: 'message',
      id: 'alice',
      text: 'Привет ' + face.body.token,
      key: key(),
    })
  ).status,
  200,
);
assert.equal(
  (
    await social('dave', {
      action: 'message',
      id: 'alice',
      text: `:ce_${missing}:`,
      key: key(),
    })
  ).status,
  404,
);
assert.equal(
  (
    await social('dave', {
      action: 'message',
      id: 'alice',
      text: `:ce_${ids[0]}:`,
      key: key(),
    })
  ).status,
  404,
  'A sticker is not a custom emoji',
);
assert.equal(
  (
    await social('dave', {
      action: 'message',
      id: 'alice',
      sticker: face.body.ref,
      key: key(),
    })
  ).status,
  404,
  'A custom emoji is not a sticker message',
);

// Reports keep evidence; a moderator removes the pack everywhere.
assert.equal(
  (
    await stickers('alice', {
      action: 'report',
      id: cats.body.id,
      reason: 'Спам',
    })
  ).status,
  400,
);
assert.equal(
  (
    await stickers('bob', {
      action: 'report',
      id: cats.body.id,
      reason: 'Чужие картинки',
    })
  ).status,
  200,
);
const report = sql
  .prepare("SELECT * FROM content_reports WHERE targetType='sticker_pack'")
  .get();
assert.equal(report.targetId, cats.body.id);
assert.equal(report.authorId, 'alice');
assert.equal(JSON.parse(report.snapshot).media.length, 3);
assert.equal(JSON.parse(report.snapshot).shortName, 'alice_cats');
const queue = await socialRead('carol', 'action=moderationReports&status=new');
assert.equal(
  queue.body.find((row) => row.targetType === 'sticker_pack').available,
  1,
);
const removal = await social('carol', {
  action: 'removeContent',
  targetType: 'sticker_pack',
  id: cats.body.id,
  reason: 'Нарушение авторских прав',
});
assert.equal(removal.status, 200);
assert.ok(
  sql
    .prepare('SELECT removedAt FROM sticker_packs WHERE id=?')
    .get(cats.body.id).removedAt > 0,
);
assert.equal(
  sql.prepare('SELECT COUNT(*) AS n FROM moderated_uploads').get().n,
  3,
);
assert.equal(
  sql
    .prepare(
      "SELECT status FROM content_reports WHERE targetType='sticker_pack'",
    )
    .get().status,
  'closed',
);
assert.equal((await media('bob', stillUpload)).status, 404);
assert.equal((await read('bob', 'action=pack&name=alice_cats')).status, 404);
assert.deepEqual((await read('bob', 'action=panel')).body.packs, []);
assert.ok(
  !(await read('bob', 'action=panel')).body.favorites.some(
    (sticker) => sticker.ref === still.body.ref,
  ),
);
assert.equal(
  (await read('bob', 'action=resolve&refs=' + still.body.ref)).body.stickers[0]
    .available,
  false,
  'Sent copies show «Стикер недоступен»',
);
assert.equal(
  (
    await social('bob', {
      action: 'message',
      id: 'alice',
      sticker: still.body.ref,
      key: key(),
    })
  ).status,
  404,
);
assert.equal(
  (await upload('alice', cats.body.id, '😺', png(512, 512))).status,
  403,
);
const mine = await read('alice', 'action=mine');
const removedPack = mine.body.packs.find((pack) => pack.id === cats.body.id);
assert.equal(removedPack.removed, true);
assert.ok(
  removedPack.stickers.every((sticker) => !sticker.available && !sticker.src),
  'The author sees a removed pack without its files',
);
await stickers('alice', { action: 'deletePack', id: cats.body.id });
assert.ok(
  !(await read('alice', 'action=mine')).body.packs.some(
    (pack) => pack.id === cats.body.id,
  ),
);
assert.equal(
  sql
    .prepare('SELECT COUNT(*) AS n FROM stickers WHERE packId=?')
    .get(cats.body.id).n,
  3,
  'Evidence stays after the author hides a removed pack',
);

// Deleting a pack frees its files at once and clears panels.
const dogs = await stickers('alice', {
  action: 'createPack',
  title: 'Псы',
  shortName: 'alice_dogs',
});
const dog = await upload('alice', dogs.body.id, '🐶', png(256, 256));
const dogUpload = dog.body.src.slice('/api/media/'.length);
await stickers('bob', { action: 'install', ref: 'u:' + dogs.body.id });
await stickers('bob', { action: 'fave', ref: dog.body.ref, on: true });
// Uploads stay while referenced, even when older than a day.
sql.prepare('UPDATE uploads SET created=1 WHERE id=?').run(dogUpload);
await api.cleanUploads();
assert.equal(
  sql.prepare('SELECT state FROM uploads WHERE id=?').get(dogUpload).state,
  'ready',
);
assert.equal(
  (await stickers('bob', { action: 'deletePack', id: dogs.body.id })).status,
  404,
);
assert.equal(
  (await stickers('alice', { action: 'deletePack', id: dogs.body.id })).status,
  200,
);
assert.equal(
  sql.prepare('SELECT COUNT(*) AS n FROM uploads WHERE id=?').get(dogUpload).n,
  0,
);
assert.equal(objects.has(dogUpload), false);
assert.equal(
  sql
    .prepare('SELECT COUNT(*) AS n FROM user_sticker_packs WHERE packRef=?')
    .get('u:' + dogs.body.id).n,
  0,
);
assert.equal(
  sql
    .prepare('SELECT COUNT(*) AS n FROM faved_stickers WHERE stickerRef=?')
    .get(dog.body.ref).n,
  0,
);
assert.equal((await read('alice', 'action=pack&name=alice_dogs')).status, 404);
assert.equal(
  (
    await stickers('alice', {
      action: 'createPack',
      title: 'Псы',
      shortName: 'alice_dogs',
    })
  ).status,
  200,
  'The name of a deleted pack is free again',
);

// Limits: twenty packs per author (the hidden removed pack does not count).
for (let i = 0; i < 18; i++)
  assert.equal(
    (
      await stickers('alice', {
        action: 'createPack',
        title: 'Набор ' + i,
        shortName: 'alice_pack_' + i,
      })
    ).status,
    200,
  );
const over = await stickers('alice', {
  action: 'createPack',
  title: 'Лишний',
  shortName: 'alice_extra',
});
assert.equal(over.status, 400);
assert.match(over.body.error, /до 20 наборов/);
console.log(
  'Stickers: packs, uploads, panel, sends in chats and groups, forwarding, custom emoji, reports and moderation passed.',
);
