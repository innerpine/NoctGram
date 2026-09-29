// Shared by the sticker importers. Writes the built-in catalog
// (lib/sticker-catalog.json), the provenance list
// (public/assets/stickers/sources.json) and the premium emoji module
// generated from the catalog's emoji packs (lib/premium-emoji-catalog.ts).
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const defaultRoot = new URL('../../', import.meta.url);
// Older premium emoji keep these token names; catalog emoji may not reuse them.
const LEGACY_NAMES = [
  'smile',
  'laugh',
  'skull',
  'eyes',
  'heart',
  'archive',
  'fire',
  'star',
  'moon',
];
export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}
export function readCatalog(root = defaultRoot) {
  return readJson(new URL('lib/sticker-catalog.json', root), {
    revision: '',
    packs: [],
  });
}
export function readSources(root = defaultRoot) {
  return readJson(new URL('public/assets/stickers/sources.json', root), {
    files: [],
  });
}
// Replaces a pack with the same id, keeping the order of the others.
export function upsertPack(catalog, pack) {
  const index = catalog.packs.findIndex((item) => item.id === pack.id);
  if (index < 0) catalog.packs.push(pack);
  else catalog.packs[index] = pack;
  return catalog;
}
// Every custom emoji becomes the text token :noct_<slug>:, so slugs of all
// emoji packs are unique together with the older names.
export function checkEmojiNames(catalog) {
  const seen = new Set(LEGACY_NAMES);
  for (const pack of catalog.packs.filter((item) => item.type === 'emoji'))
    for (const item of pack.items) {
      if (!/^[a-z0-9_]+$/.test(item.slug))
        throw new Error(`${pack.id}: slug ${item.slug} is not a token name`);
      if (seen.has(item.slug))
        throw new Error(`${pack.id}: emoji name ${item.slug} is already used`);
      seen.add(item.slug);
    }
}
export function emojiModule(catalog) {
  const packs = catalog.packs.filter((pack) => pack.type === 'emoji');
  const emoji = packs.flatMap((pack) =>
    pack.items.map((item) => ({
      id: `${pack.id}-${item.slug}`,
      name: item.slug,
      fallback: item.emoji,
      pack: pack.id,
      asset: item.path,
      format: item.format,
    })),
  );
  const list = (rows) =>
    rows.map((row) => '  ' + JSON.stringify(row) + ',').join('\n');
  return `// Generated from lib/sticker-catalog.json by the sticker importers
// (scripts/import-tweb-assets.mjs, scripts/import-telegram-stickers.mjs).
// Do not edit by hand.
export type CatalogEmoji = {
  id: string;
  name: string;
  fallback: string;
  pack: string;
  asset: string;
  format: 'lottie' | 'webp' | 'webm';
};
export const catalogEmojiPacks: readonly { id: string; title: string }[] = [
${list(packs.map((pack) => ({ id: pack.id, title: pack.title })))}
];
export const catalogEmoji: readonly CatalogEmoji[] = [
${list(emoji)}
];
`;
}
export async function writeCatalog(catalog, root = defaultRoot) {
  checkEmojiNames(catalog);
  await writeFile(
    new URL('lib/sticker-catalog.json', root),
    JSON.stringify(catalog, null, 2) + '\n',
  );
  await writeFile(
    new URL('lib/premium-emoji-catalog.ts', root),
    emojiModule(catalog),
  );
}
// Provenance: one entry per stored file. New entries replace older ones for
// the same file; `drop` removes entries an importer no longer produces.
export async function writeSources(
  files,
  { root = defaultRoot, header = {}, drop = () => false } = {},
) {
  const sources = { ...(await readSources(root)), ...header };
  const byFile = new Map(
    (sources.files || [])
      .filter((row) => !drop(row))
      .map((row) => [row.file, row]),
  );
  for (const row of files) byFile.set(row.file, row);
  sources.files = [...byFile.values()].sort((a, b) =>
    a.file.localeCompare(b.file),
  );
  await writeFile(
    new URL('public/assets/stickers/sources.json', root),
    JSON.stringify(sources, null, 2) + '\n',
  );
}
