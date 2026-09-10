export function insertComposerEmoji(
  text: string,
  emoji: string,
  start: number,
  end: number,
  limit = 4000,
) {
  const from = Math.max(0, Math.min(text.length, start));
  const to = Math.max(from, Math.min(text.length, end));
  const next = text.slice(0, from) + emoji + text.slice(to);
  // Never cut an emoji's surrogate pair, skin tone or joined family sequence.
  if (next.length > limit) return null;
  return { text: next, caret: from + emoji.length };
}
