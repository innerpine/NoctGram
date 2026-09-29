import names from './chat-emoji-data.json';
import { emojiParts, type PremiumEmoji } from './premium-emoji';

export function appleEmojiUrl(unified: string, large = false) {
  if (large)
    return `https://cdn.jsdelivr.net/gh/iamcal/emoji-data@v16.0.0/img-apple-160/${unified}.png`;
  return `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/apple/64/${unified}.png`;
}
const normalized = (value: string) =>
  value
    .split('-')
    .filter((code) => code !== 'fe0f')
    .join('-');
const artwork = new Map(names.map((name) => [normalized(name), name]));
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
export function chatEmojiParts(text: string) {
  const parts: {
    text: string;
    unified?: string;
    premium?: PremiumEmoji;
    // The sticker id of a custom emoji from a pack made by a person.
    custom?: string;
  }[] = [];
  for (const part of emojiParts(text)) {
    if (part.emoji) {
      parts.push({ text: part.text, premium: part.emoji });
      continue;
    }
    if (part.custom) {
      parts.push({ text: part.text, custom: part.custom });
      continue;
    }
    for (const { segment } of segmenter.segment(part.text)) {
      // Artwork filenames encode code points within this already segmented grapheme.
      // eslint-disable-next-line typescript/no-misused-spread
      const code = [...segment]
        .map((char) => char.codePointAt(0)!.toString(16).padStart(4, '0'))
        .join('-');
      // Explicit text presentation (VS15) stays text; a joined emoji is one image.
      const unified = artwork.get(normalized(code));
      const last = parts.at(-1);
      if (!unified && last && !last.unified && !last.premium && !last.custom)
        last.text += segment;
      else parts.push({ text: segment, ...(unified ? { unified } : {}) });
    }
  }
  return parts;
}
// A message of only emoji is shown large: Unicode emoji and premium or
// custom emoji tokens count alike.
export function largeEmojiCount(text: string) {
  const parts = chatEmojiParts(text);
  const emoji = (part: (typeof parts)[number]) =>
    !!(part.unified || part.premium || part.custom);
  const count = parts.filter(emoji).length;
  return count > 0 &&
    count <= 6 &&
    parts.every((part) => emoji(part) || !part.text.trim())
    ? count
    : 0;
}
