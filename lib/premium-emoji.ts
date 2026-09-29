import { catalogEmoji, catalogEmojiPacks } from './premium-emoji-catalog';

// Premium emoji go into text as :noct_<name>: tokens: the original NoctGram
// set and the emoji packs of the built-in catalog (the Telegram Web set shares
// its Lottie files with the built-in sticker packs). Emoji from packs made by
// people are :ce_<sticker id>: tokens, resolved through the sticker API.
export type PremiumEmoji = {
  id: string;
  name: string;
  fallback: string;
  pack: string;
  // Catalog emoji: an asset outside /assets/emoji, without a static preview.
  asset?: string;
  format?: 'lottie' | 'webp' | 'webm';
};
export const premiumEmojiPacks: readonly { id: string; title: string }[] = [
  { id: 'RestrictedEmoji', title: 'RestrictedEmoji' },
  { id: 'CreepyEmoji', title: 'CreepyEmoji' },
  { id: 'NewsEmoji', title: 'NewsEmoji' },
  ...catalogEmojiPacks,
];
const original: PremiumEmoji[] = [
  {
    id: '5372954454653933911',
    name: 'smile',
    fallback: '😀',
    pack: 'RestrictedEmoji',
  },
  {
    id: '5370953476635368811',
    name: 'laugh',
    fallback: '😂',
    pack: 'RestrictedEmoji',
  },
  {
    id: '5370971163310693562',
    name: 'skull',
    fallback: '💀',
    pack: 'RestrictedEmoji',
  },
  {
    id: '5399988331729664856',
    name: 'eyes',
    fallback: '👀',
    pack: 'CreepyEmoji',
  },
  {
    id: '5328014489554002336',
    name: 'heart',
    fallback: '❤️',
    pack: 'CreepyEmoji',
  },
  {
    id: '5346288231073723227',
    name: 'archive',
    fallback: '🗃',
    pack: 'CreepyEmoji',
  },
  {
    id: '5424972470023104089',
    name: 'fire',
    fallback: '🔥',
    pack: 'NewsEmoji',
  },
  {
    id: '5438496463044752972',
    name: 'star',
    fallback: '⭐️',
    pack: 'NewsEmoji',
  },
  {
    id: '5449569374065152798',
    name: 'moon',
    fallback: '🌛',
    pack: 'NewsEmoji',
  },
];
export const premiumEmoji: readonly PremiumEmoji[] = [
  ...original,
  ...catalogEmoji,
];
export const emojiToken = (emoji: PremiumEmoji) => `:noct_${emoji.name}:`;
const CUSTOM = /^:ce_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):$/;
// Stands in for a custom emoji where only plain text fits.
export const CUSTOM_EMOJI_FALLBACK = '✨';
export function emojiParts(text: string) {
  return text
    .split(/(:noct_[a-z0-9_]+:|:ce_[0-9a-f-]{36}:)/g)
    .map((text) => ({
      text,
      emoji: premiumEmoji.find((e) => emojiToken(e) === text),
      // The sticker id of a custom emoji from a pack made by a person.
      custom: CUSTOM.exec(text)?.[1],
    }));
}
export function emojiFallback(text: string) {
  return emojiParts(text)
    .map(
      (p) => p.emoji?.fallback || (p.custom ? CUSTOM_EMOJI_FALLBACK : p.text),
    )
    .join('');
}
export const hasPremiumEmoji = (text: string) =>
  /:noct_[a-z0-9_]+:|:ce_[0-9a-f-]{36}:/.test(text);
