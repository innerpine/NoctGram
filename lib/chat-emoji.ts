import names from './chat-emoji-data.json';

export function appleEmojiUrl(unified: string) {
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
  const parts: { text: string; unified?: string }[] = [];
  for (const { segment } of segmenter.segment(text)) {
    // Artwork filenames encode code points within this already segmented grapheme.
    // eslint-disable-next-line typescript/no-misused-spread
    const code = [...segment]
      .map((char) => char.codePointAt(0)!.toString(16).padStart(4, '0'))
      .join('-');
    // Explicit text presentation (VS15) stays text; a joined emoji is one image.
    const unified = artwork.get(normalized(code));
    const last = parts.at(-1);
    if (!unified && last && !last.unified) last.text += segment;
    else parts.push({ text: segment, ...(unified ? { unified } : {}) });
  }
  return parts;
}
export function largeEmojiCount(text: string) {
  const parts = chatEmojiParts(text);
  const count = parts.filter((part) => part.unified).length;
  return count > 0 &&
    count <= 6 &&
    parts.every((part) => part.unified || !part.text.trim())
    ? count
    : 0;
}
