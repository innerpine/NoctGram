// Built-in sticker packs and custom emoji, generated from the public Lottie
// assets of Telegram Web K by scripts/import-tweb-assets.mjs.
import catalog from './sticker-catalog.json';
import type { StickerInfo, StickerPackInfo } from './sticker-types';

export type CatalogItem = {
  id: string;
  slug: string;
  emoji: string;
  format: 'lottie' | 'webp' | 'webm';
  path: string;
  w: number;
  h: number;
};
export type CatalogPack = {
  id: string;
  type: 'stickers' | 'emoji';
  title: string;
  source: string;
  items: CatalogItem[];
};
export const stickerCatalog = catalog as {
  revision: string;
  packs: CatalogPack[];
};
// A static first frame of a built-in animation (scripts/render-sticker-posters.mjs).
export const posterFor = (path: string) =>
  path
    .replace('/assets/stickers/tgs/', '/assets/stickers/posters/')
    .replace(/\.json$/, '.webp');
export const builtinRef = (pack: CatalogPack, item: CatalogItem) =>
  `b:${pack.id}:${item.slug}`;
export const builtinPack = (id: string) =>
  stickerCatalog.packs.find((pack) => pack.id === id) ?? null;
// Any built-in item: a sticker or a custom emoji.
export function builtinItem(ref: string) {
  const match = /^b:([a-z0-9_]+):([a-z0-9_]+)$/.exec(ref);
  if (!match) return null;
  const pack = builtinPack(match[1]);
  const item = pack?.items.find((entry) => entry.slug === match[2]);
  return pack && item ? { pack, item } : null;
}
// A built-in item that can be sent as a sticker message.
export function builtinSticker(ref: string) {
  const found = builtinItem(ref);
  return found?.pack.type === 'stickers' ? found : null;
}
export function builtinInfo(pack: CatalogPack, item: CatalogItem): StickerInfo {
  return {
    ref: builtinRef(pack, item),
    packRef: 'b:' + pack.id,
    emoji: item.emoji,
    format: item.format,
    src: item.path,
    w: item.w,
    h: item.h,
    available: true,
    ...(pack.type === 'emoji' ? { token: `:noct_${item.slug}:` } : {}),
  };
}
export function builtinPackInfo(pack: CatalogPack): StickerPackInfo {
  return {
    ref: 'b:' + pack.id,
    id: pack.id,
    shortName: pack.id,
    title: pack.title,
    type: pack.type,
    builtin: true,
    own: false,
    installed: true,
    stickers: pack.items.map((item) => builtinInfo(pack, item)),
  };
}
