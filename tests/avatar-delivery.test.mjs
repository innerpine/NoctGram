import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import sharp from 'sharp';

const moduleUrl = (text) =>
  'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
async function compile(file, imports = {}) {
  let code = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  for (const [name, url] of Object.entries(imports))
    code = code
      .replaceAll(`from '${name}'`, `from '${url}'`)
      .replaceAll(`from "${name}"`, `from '${url}'`);
  return moduleUrl(code);
}
const variantsUrl = await compile('lib/avatar-variants.ts'),
  variants = await import(variantsUrl);
const errorUrl = await compile('lib/api-error.ts'),
  { ApiError } = await import(errorUrl);
let current;
globalThis.__avatarDelivery = {
  get current() {
    return current;
  },
  fail(status) {
    throw new ApiError(status, 'Denied');
  },
};
const server =
  moduleUrl(`import {ApiError} from '${errorUrl}'; export {ApiError};
 const ctx=()=>globalThis.__avatarDelivery.current;
 export const viewer=async()=>{if(ctx().sessionDenied)throw new ApiError(401,'Denied');return 'alice';};
 export const db=()=>({prepare:sql=>({bind:()=>({first:async()=>sql.includes('SELECT up.userId')?ctx().upload:{onboardingComplete:1},run:async()=>{ctx().states.push(sql);return {meta:{changes:1}};}})})});
 export const bucket=()=>({get:async key=>{ctx().reads.push(key);return ctx().objects.get(key)||null;},put:async(key,bytes)=>{ctx().writes.push({key,bytes:bytes.byteLength});if(ctx().failPut===key||ctx().failVariant&&key.includes('/'))throw new Error('R2 unavailable');}});
 export const failure=e=>Response.json({error:e.message},{status:e.status||500});`);
const access = moduleUrl(`const ctx=()=>globalThis.__avatarDelivery.current;
 export const visibleAccount=()=> 'av.deletedAt=0';
 export const assertReadable=async()=>{if(ctx().readDenied)globalThis.__avatarDelivery.fail(403);};
 export const assertWritable=assertReadable;
 export const assertUploadAvailable=async()=>{if(ctx().removed)globalThis.__avatarDelivery.fail(404);};
 export const assertMediaRead=async()=>{if(ctx().mediaDenied)globalThis.__avatarDelivery.fail(403);};`);
const get = (
  await import(
    await compile('app/api/media/[id]/route.ts', {
      '@/lib/server': server,
      '@/lib/account-access': access,
      '@/lib/media-access': access,
      '@/lib/avatar-variants': variantsUrl,
    })
  )
).GET;
const post = (
  await import(
    await compile('app/api/upload/route.ts', {
      '@/lib/server': server,
      '@/lib/account-access': access,
      '@/lib/avatar-variants': variantsUrl,
      '@/lib/request-body': await compile('lib/request-body.ts', {
        './api-error': errorUrl,
      }),
      '@/lib/upload-storage': moduleUrl(
        `export const reserveUpload=async(id,me,file)=>{globalThis.__avatarDelivery.current.reserved={id,me,...file};};`,
      ),
      '@/lib/rate-limit': moduleUrl('export const rateLimit=async()=>{};'),
    })
  )
).POST;
function reset() {
  current = {
    upload: {
      userId: 'bob',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: null,
      onboardingComplete: 1,
      viewerComplete: 1,
      deletedAt: 0,
      avatar: 1,
    },
    objects: new Map(),
    reads: [],
    writes: [],
    states: [],
  };
}
function object(bytes, type = 'image/webp', extra = {}) {
  return {
    body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(bytes));
        c.close();
      },
    }),
    size: bytes.length,
    httpEtag: '"version-1"',
    writeHttpMetadata: (h) => h.set('Content-Type', type),
    ...extra,
  };
}
const request = (query = '', headers = {}) =>
  get(
    new Request('https://noctgram.example/api/media/avatar' + query, {
      headers,
    }),
    { params: Promise.resolve({ id: 'avatar' }) },
  );
const webp = async (size = 96, options = {}) =>
  sharp({
    create: { width: size, height: size, channels: 4, background: '#ff994488' },
  })
    .webp(options)
    .toBuffer();

await test('responsive avatars preserve external URLs and strictly limit derivative keys', () => {
  assert.equal(
    variants.avatarSource('/api/media/abc_123', 96),
    '/api/media/abc_123?avatar=96',
  );
  for (const url of [
    'https://example.com/a',
    'blob:abc',
    '/api/media/a?download',
    '/api/media/../secret',
  ])
    assert.equal(variants.avatarSource(url), url);
  for (const input of [null, '', '0', '192.0', '9999', '../96'])
    assert.equal(variants.avatarSize(input), undefined);
  assert.equal(variants.avatarSources('https://example.com/a'), undefined);
});
await test('real lossless/lossy/transparent WebP previews pass; bad size, animation and corrupt headers fail', async () => {
  for (const size of variants.avatarSizes)
    for (const opts of [{ lossless: true }, { quality: 84 }]) {
      const bytes = await webp(size, opts);
      assert.equal(variants.validAvatarVariant(bytes, size), true);
      assert.equal(
        variants.validAvatarVariant(bytes, size === 96 ? 192 : 96),
        false,
      );
      const corrupt = Buffer.from(bytes);
      corrupt[4] ^= 1;
      assert.equal(variants.validAvatarVariant(corrupt, size), false);
    }
  const animated = Buffer.from(await webp());
  assert.equal(animated.toString('ascii', 12, 16), 'VP8X');
  animated[20] |= 2;
  assert.equal(variants.validAvatarVariant(animated, 96), false);
  assert.equal(variants.validAvatarVariant(new Uint8Array(20), 96), false);
});
await test('current avatar receives its preview and browser-private validation headers', async () => {
  reset();
  current.objects.set('avatars/v1/avatar/96.webp', object([1, 2, 3]));
  const response = await request('?avatar=96');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-cache, must-revalidate',
  );
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [1, 2, 3],
  );
  assert.deepEqual(current.reads, ['avatars/v1/avatar/96.webp']);
});
await test('cached avatar never bypasses current authentication, restrictions, removal or access checks', async () => {
  for (const [flag, status] of [
    ['sessionDenied', 401],
    ['readDenied', 403],
    ['removed', 404],
    ['mediaDenied', 403],
  ]) {
    reset();
    current[flag] = true;
    current.objects.set('avatars/v1/avatar/96.webp', object([1]));
    assert.equal(
      (await request('?avatar=96', { 'If-None-Match': '"version-1"' })).status,
      status,
    );
    assert.deepEqual(current.reads, []);
  }
  reset();
  current.objects.set('avatars/v1/avatar/96.webp', object([1]));
  const response = await request('?avatar=96', {
    'If-None-Match': '"old", W/"version-1"',
  });
  assert.equal(response.status, 304);
  assert.equal(await response.text(), '');
});
await test('old avatar without previews falls back to the unchanged original; nonavatars, chats and downloads remain no-store', async () => {
  reset();
  current.objects.set('avatar', object([7, 8], 'image/jpeg'));
  const response = await request('?avatar=192');
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal((await response.arrayBuffer()).byteLength, 2);
  for (const kind of ['ordinary', 'chat', 'download', 'invalid', 'range']) {
    reset();
    if (kind === 'ordinary') current.upload.avatar = 0;
    if (kind === 'chat') current.upload.kind = 'file';
    current.objects.set(
      'avatar',
      object(
        [7, 8],
        'image/jpeg',
        kind === 'range' ? { size: 5, range: { offset: 1, length: 2 } } : {},
      ),
    );
    const response = await request(
      kind === 'invalid'
        ? '?avatar=1000'
        : kind === 'download'
          ? '?avatar=96&download=1'
          : '?avatar=96',
      kind === 'range' ? { Range: 'bytes=1-2' } : {},
    );
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(current.reads, ['avatar']);
    assert.equal(response.status, kind === 'range' ? 206 : 200);
    if (kind === 'range')
      assert.equal(response.headers.get('content-range'), 'bytes 1-2/5');
  }
});
async function upload(previews) {
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array([255, 216, 255, 217])], 'a.jpg', {
      type: 'image/jpeg',
    }),
  );
  for (const [size, bytes] of previews)
    form.set(
      'avatar' + size,
      new File([bytes], 'a.webp', { type: 'image/webp' }),
    );
  return post(
    new Request('https://noctgram.example/api/upload', {
      method: 'POST',
      headers: { Origin: 'https://noctgram.example' },
      body: form,
    }),
  );
}
await test('avatar upload reserves original plus derivative bytes and becomes ready only after all writes', async () => {
  reset();
  const previews = await Promise.all(
    variants.avatarSizes.map(async (s) => [s, await webp(s)]),
  );
  const response = await upload(previews);
  assert.equal(response.status, 200);
  assert.equal(current.writes.length, 4);
  assert.equal(
    current.reserved.size,
    4 + previews.reduce((n, v) => n + v[1].length, 0),
  );
  assert.equal(current.writes[0].bytes, 4);
  assert.ok(current.states.some((s) => s.includes("state='ready'")));
  reset();
  current.failVariant = true;
  assert.equal((await upload(previews)).status, 500);
  assert.ok(current.states.some((s) => s.includes("state='deleting'")));
  assert.equal(
    current.states.some((s) => s.includes("state='ready'")),
    false,
  );
  reset();
  assert.equal((await upload([[96, await webp(192)]])).status, 400);
  assert.equal(current.reserved, undefined);
  assert.equal(current.writes.length, 0);
});
