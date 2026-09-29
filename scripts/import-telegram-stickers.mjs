// Imports a Telegram sticker set or custom emoji set as a built-in pack,
// through the Bot API of your own bot:
//   node --env-file=bot/.env scripts/import-telegram-stickers.mjs --set <name> [--id <pack id>] [--title <title>]
// Animated stickers (TGS) are unpacked to Lottie JSON and checked like
// uploads; static WebP and video WebM files are kept as they are. The bot
// token is only sent to api.telegram.org: it is never written or printed.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { imageSize, inflateTgs, inspectLottie } from '../lib/tgs-validate.ts';
import {
  defaultRoot,
  readCatalog,
  sha256,
  upsertPack,
  writeCatalog,
  writeSources,
} from './lib/sticker-catalog-writer.mjs';

const API = 'https://api.telegram.org';
const FILE_LIMIT = 1024 * 1024;
const RESERVED = new Set([
  'tgs',
  'posters',
  'utya',
  'monkey',
  'holiday',
  'tgweb',
]);

function options(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--set', '--id', '--title'].includes(key) || !argv[i + 1])
      throw new Error(`Неизвестный параметр: ${key}`);
    values[key.slice(2)] = argv[++i];
  }
  if (!values.set || !/^[A-Za-z0-9_]{1,64}$/.test(values.set))
    throw new Error(
      'Укажите набор: --set <имя из ссылки t.me/addstickers/имя или t.me/addemoji/имя>',
    );
  const id =
    values.id ||
    values.set
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 32);
  if (!/^[a-z0-9_]{2,32}$/.test(id) || RESERVED.has(id))
    throw new Error('Короткое имя набора (--id): 2–32 символа a-z, 0-9, _');
  return { set: values.set, id, title: values.title };
}
function magic(bytes, kind) {
  const text = (from, length) =>
    String.fromCharCode(...bytes.subarray(from, from + length));
  if (kind === 'webp') return text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP';
  if (kind === 'webm')
    return (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    );
  return false;
}

export async function importTelegramStickers(
  argv,
  {
    fetch = globalThis.fetch,
    env = process.env,
    root = defaultRoot,
    log = console.log,
  } = {},
) {
  const { set, id, title } = options(argv);
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token)
    throw new Error(
      'Нужен TELEGRAM_BOT_TOKEN: запустите с --env-file=bot/.env или задайте переменную окружения',
    );
  // Errors mention the method, never the URL with the token.
  async function api(method, params) {
    const response = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok)
      throw new Error(
        `${method}: ${data?.description || 'HTTP ' + response.status}`,
      );
    return data.result;
  }
  async function download(fileId) {
    const file = await api('getFile', { file_id: fileId });
    if (!file.file_path || (file.file_size ?? 0) > FILE_LIMIT)
      throw new Error('Файл набора недоступен или слишком большой');
    const response = await fetch(`${API}/file/bot${token}/${file.file_path}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Файл: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > FILE_LIMIT) throw new Error('Файл слишком большой');
    return bytes;
  }

  const stickerSet = await api('getStickerSet', { name: set });
  const type =
    stickerSet.sticker_type === 'custom_emoji'
      ? 'emoji'
      : stickerSet.sticker_type === 'regular'
        ? 'stickers'
        : null;
  if (!type) throw new Error('Маски не поддерживаются');
  const limit = type === 'emoji' ? 200 : 120;
  const list = (stickerSet.stickers || []).slice(0, limit);
  if (!list.length) throw new Error('В наборе нет стикеров');

  const folder = new URL(`public/assets/stickers/${id}/`, root);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const items = [],
    files = [];
  const store = async (name, bytes, uniqueId) => {
    await writeFile(new URL(name, folder), bytes);
    files.push({
      file: `${id}/${name}`,
      source: `telegram:${set}`,
      fileUniqueId: uniqueId,
      sha256: sha256(bytes),
      bytes: bytes.length,
    });
  };
  for (const [index, sticker] of list.entries()) {
    // Emoji slugs become text tokens :noct_<slug>:, so they carry the pack id.
    const slug = type === 'emoji' ? `${id}_${index + 1}` : String(index + 1);
    const emoji = sticker.emoji || '🙂';
    const bytes = await download(sticker.file_id);
    let format, name, width, height;
    if (sticker.is_animated) {
      const json = await inflateTgs(bytes);
      const data = JSON.parse(json);
      const problem = inspectLottie(data, { maxSize: 512, maxSeconds: 10 });
      if (problem) throw new Error(`Стикер ${index + 1}: ${problem}`);
      format = 'lottie';
      name = `${slug}.json`;
      width = data.w;
      height = data.h;
      await store(name, new TextEncoder().encode(json), sticker.file_unique_id);
      // Telegram's own WebP thumbnail is the static poster.
      if (sticker.thumbnail?.file_id) {
        const thumb = await download(sticker.thumbnail.file_id);
        if (magic(thumb, 'webp'))
          await store(`${slug}.webp`, thumb, sticker.thumbnail.file_unique_id);
      }
    } else if (sticker.is_video) {
      if (!magic(bytes, 'webm'))
        throw new Error(`Стикер ${index + 1}: ожидался WebM`);
      format = 'webm';
      name = `${slug}.webm`;
      width = sticker.width;
      height = sticker.height;
      await store(name, bytes, sticker.file_unique_id);
    } else {
      const size = magic(bytes, 'webp') ? imageSize(bytes, 'image/webp') : null;
      if (!size || size.width > 512 || size.height > 512)
        throw new Error(`Стикер ${index + 1}: ожидался WebP до 512×512`);
      format = 'webp';
      name = `${slug}.webp`;
      width = size.width;
      height = size.height;
      await store(name, bytes, sticker.file_unique_id);
    }
    items.push({
      id: `${id}:${slug}`,
      slug,
      emoji,
      format,
      path: `/assets/stickers/${id}/${name}`,
      w: width,
      h: height,
    });
  }
  const catalog = await readCatalog(root);
  upsertPack(catalog, {
    id,
    type,
    title: title || stickerSet.title || set,
    source: `Telegram: ${set}`,
    items,
  });
  await writeCatalog(catalog, root);
  await writeSources(files, {
    root,
    drop: (row) => row.file.startsWith(id + '/'),
  });
  log(
    `Набор «${title || stickerSet.title || set}» (${type === 'emoji' ? 'эмодзи' : 'стикеры'}): ${items.length} шт. → public/assets/stickers/${id}/`,
  );
  return { id, type, count: items.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href)
  importTelegramStickers(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
