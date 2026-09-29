import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importTelegramStickers } from '../scripts/import-telegram-stickers.mjs';

// The Bot API importer against a mocked Telegram: files are validated,
// stored with provenance, and the bot token never leaves the API requests.
const dir = mkdtempSync(join(tmpdir(), 'noct-stickers-'));
const root = pathToFileURL(dir + '/');
mkdirSync(join(dir, 'lib'));
mkdirSync(join(dir, 'public/assets/stickers'), { recursive: true });
cpSync('lib/sticker-catalog.json', join(dir, 'lib/sticker-catalog.json'));
cpSync(
  'public/assets/stickers/sources.json',
  join(dir, 'public/assets/stickers/sources.json'),
);
const TOKEN = 'test-token-not-real';
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
const webp = (() => {
  const bytes = new Uint8Array(40);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  bytes.set(new TextEncoder().encode('VP8X'), 12);
  bytes.set([0xff, 0x01, 0, 0xff, 0x01, 0], 24);
  return bytes;
})();
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
const sets = {};
const files = {};
const requested = [];
const fetch = async (url, init = {}) => {
  requested.push(String(url));
  const api = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(url);
  if (api) {
    assert.equal(api[1], TOKEN);
    const body = JSON.parse(init.body);
    if (api[2] === 'getStickerSet') {
      const set = sets[body.name];
      return Response.json(
        set
          ? { ok: true, result: set }
          : { ok: false, description: 'STICKERSET_INVALID' },
        { status: set ? 200 : 400 },
      );
    }
    if (api[2] === 'getFile')
      return Response.json({
        ok: true,
        result: {
          file_id: body.file_id,
          file_path: 'stickers/' + body.file_id,
          file_size: files[body.file_id].length,
        },
      });
  }
  const file =
    /^https:\/\/api\.telegram\.org\/file\/bot([^/]+)\/stickers\/(\w+)$/.exec(
      url,
    );
  if (file) {
    assert.equal(file[1], TOKEN);
    return new Response(files[file[2]]);
  }
  throw new Error('Unexpected request: ' + url);
};
const logs = [];
const run = (argv, env = { TELEGRAM_BOT_TOKEN: TOKEN }) =>
  importTelegramStickers(argv, {
    fetch,
    env,
    root,
    log: (line) => logs.push(line),
  });
try {
  files.anim = new Uint8Array(gzipSync(JSON.stringify(lottie())));
  files.thumb = webp;
  files.still = webp;
  files.video = webm;
  sets.CatsSet = {
    name: 'CatsSet',
    title: 'Коты',
    sticker_type: 'regular',
    stickers: [
      {
        file_id: 'anim',
        file_unique_id: 'u-anim',
        emoji: '😺',
        is_animated: true,
        is_video: false,
        width: 512,
        height: 512,
        thumbnail: { file_id: 'thumb', file_unique_id: 'u-thumb' },
      },
      {
        file_id: 'still',
        file_unique_id: 'u-still',
        emoji: '😸',
        is_animated: false,
        is_video: false,
        width: 512,
        height: 512,
      },
      {
        file_id: 'video',
        file_unique_id: 'u-video',
        emoji: '😹',
        is_animated: false,
        is_video: true,
        width: 512,
        height: 512,
      },
    ],
  };
  await assert.rejects(run(['--set', 'CatsSet'], {}), /TELEGRAM_BOT_TOKEN/);
  await assert.rejects(
    run(['--set', 'Missing']),
    /getStickerSet: STICKERSET_INVALID/,
  );
  await assert.rejects(run(['--set', 'CatsSet', '--id', 'tgweb']), /--id/);
  assert.deepEqual(await run(['--set', 'CatsSet']), {
    id: 'catsset',
    type: 'stickers',
    count: 3,
  });
  const out = (path) => join(dir, 'public/assets/stickers/catsset', path);
  assert.deepEqual(JSON.parse(readFileSync(out('1.json'), 'utf8')), lottie());
  assert.ok(existsSync(out('1.webp')), 'Telegram thumbnail becomes the poster');
  assert.ok(existsSync(out('2.webp')) && existsSync(out('3.webm')));
  const catalog = JSON.parse(
    readFileSync(join(dir, 'lib/sticker-catalog.json'), 'utf8'),
  );
  const pack = catalog.packs.find((item) => item.id === 'catsset');
  assert.equal(pack.title, 'Коты');
  assert.equal(pack.source, 'Telegram: CatsSet');
  assert.deepEqual(
    pack.items.map((item) => [item.id, item.format, item.path, item.emoji]),
    [
      ['catsset:1', 'lottie', '/assets/stickers/catsset/1.json', '😺'],
      ['catsset:2', 'webp', '/assets/stickers/catsset/2.webp', '😸'],
      ['catsset:3', 'webm', '/assets/stickers/catsset/3.webm', '😹'],
    ],
  );
  assert.ok(
    catalog.packs.some((item) => item.id === 'tgweb'),
    'Other packs stay',
  );
  const sources = JSON.parse(
    readFileSync(join(dir, 'public/assets/stickers/sources.json'), 'utf8'),
  );
  const imported = sources.files.filter((row) =>
    row.file.startsWith('catsset/'),
  );
  assert.deepEqual(
    imported.map((row) => row.file),
    ['catsset/1.json', 'catsset/1.webp', 'catsset/2.webp', 'catsset/3.webm'],
  );
  assert.ok(
    imported.every(
      (row) =>
        row.source === 'telegram:CatsSet' && /^[0-9a-f]{64}$/.test(row.sha256),
    ),
  );
  assert.ok(
    sources.files.some((row) => row.file.startsWith('tgs/')),
    'Telegram Web K provenance stays',
  );

  // A custom emoji set joins the premium emoji with pack-prefixed names.
  files.e1 = webp;
  sets.Faces = {
    name: 'Faces',
    title: 'Лица',
    sticker_type: 'custom_emoji',
    stickers: [
      {
        file_id: 'e1',
        file_unique_id: 'u-e1',
        emoji: '🙂',
        is_animated: false,
        is_video: false,
        width: 100,
        height: 100,
      },
    ],
  };
  await run(['--set', 'Faces', '--title', 'Мои лица']);
  const generated = readFileSync(
    join(dir, 'lib/premium-emoji-catalog.ts'),
    'utf8',
  );
  assert.match(generated, /"id":"faces","title":"Мои лица"/);
  assert.match(generated, /"name":"faces_1"/);
  assert.match(generated, /"format":"webp"/);

  // Unsafe animations are refused before anything is recorded.
  files.bad = new Uint8Array(
    gzipSync(
      JSON.stringify(
        lottie({
          layers: [{ ty: 4, ks: { o: { a: 0, k: 1, x: 'eval(1)' } } }],
        }),
      ),
    ),
  );
  sets.Bad = {
    name: 'Bad',
    title: 'Bad',
    sticker_type: 'regular',
    stickers: [
      {
        file_id: 'bad',
        file_unique_id: 'u-bad',
        emoji: '💥',
        is_animated: true,
        is_video: false,
        width: 512,
        height: 512,
      },
    ],
  };
  await assert.rejects(run(['--set', 'Bad']), /Выражения/);
  assert.ok(
    !JSON.parse(
      readFileSync(join(dir, 'lib/sticker-catalog.json'), 'utf8'),
    ).packs.some((item) => item.id === 'bad'),
  );

  // The token only ever goes to Telegram; nothing written or printed has it.
  assert.ok(
    requested.every((url) => url.startsWith('https://api.telegram.org/')),
  );
  for (const path of [
    'lib/sticker-catalog.json',
    'lib/premium-emoji-catalog.ts',
    'public/assets/stickers/sources.json',
  ])
    assert.ok(!readFileSync(join(dir, path), 'utf8').includes(TOKEN), path);
  assert.ok(!logs.join('\n').includes(TOKEN));
  console.log(
    'Telegram sticker importer: mocked Bot API, provenance and token hygiene passed.',
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
