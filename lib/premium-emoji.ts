export const premiumEmoji = [
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
] as const;
export type PremiumEmoji = (typeof premiumEmoji)[number];
export const emojiToken = (emoji: PremiumEmoji) => `:noct_${emoji.name}:`;
export function emojiParts(text: string) {
  return text.split(/(:noct_[a-z0-9_]+:)/g).map((text) => ({
    text,
    emoji: premiumEmoji.find((e) => emojiToken(e) === text),
  }));
}
export function emojiFallback(text: string) {
  return emojiParts(text)
    .map((p) => p.emoji?.fallback || p.text)
    .join('');
}
export const hasPremiumEmoji = (text: string) => /:noct_[a-z0-9_]+:/.test(text);
