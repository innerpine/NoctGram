// Shared by the sticker API and the browser.
// Built-in packs use Lottie JSON, WebP or WebM; uploads are WebP, PNG or TGS.
export type StickerFormat = 'lottie' | 'webp' | 'webm' | 'png' | 'tgs';
export type StickerInfo = {
  // 'b:<pack>:<slug>' (built-in) or 'u:<sticker id>'.
  ref: string;
  packRef: string;
  emoji: string;
  format: StickerFormat;
  // A static asset path or '/api/media/<upload id>'.
  src: string;
  w: number;
  h: number;
  available: boolean;
  // Custom emoji: the token to put into text.
  token?: string;
};
export type StickerPackInfo = {
  // 'b:<pack id>' or 'u:<pack id>'.
  ref: string;
  id: string;
  shortName: string;
  title: string;
  type: 'stickers' | 'emoji';
  builtin: boolean;
  own: boolean;
  installed: boolean;
  // Own packs only: removed by a moderator.
  removed?: boolean;
  stickers: StickerInfo[];
};
export type StickerPanel = {
  packs: StickerPackInfo[];
  favorites: StickerInfo[];
  premium: boolean;
  limits: {
    packs: number;
    installed: number;
    stickers: number;
    emoji: number;
    favorites: number;
  };
};
export const STICKER_PACK_LIMIT = 20;
export const STICKER_INSTALL_LIMIT = 30;
export const STICKERS_PER_PACK = 120;
export const EMOJI_PER_PACK = 200;
export const FAVE_LIMIT = 5;
export const FAVE_PREMIUM_LIMIT = 10;
export const STICKER_IMAGE_LIMIT = 512 * 1024;
export const EMOJI_IMAGE_LIMIT = 128 * 1024;
export const PACK_TITLE_LIMIT = 64;
export const SHORT_NAME_PATTERN = /^[a-z0-9_]{5,32}$/;
export const customEmojiToken = (stickerId: string) => `:ce_${stickerId}:`;
