export const MESSAGE_REACTIONS = [
  { emoji: '👍', label: 'Нравится' },
  { emoji: '❤️', label: 'Любовь' },
  { emoji: '😂', label: 'Смешно' },
  { emoji: '🔥', label: 'Огонь' },
  { emoji: '🎉', label: 'Поздравляю' },
  { emoji: '🤯', label: 'Впечатляет' },
  { emoji: '😢', label: 'Грустно' },
  { emoji: '👎', label: 'Не нравится' },
] as const;

export type ReactionEmoji = (typeof MESSAGE_REACTIONS)[number]['emoji'];
export type MessageReaction = {
  emoji: ReactionEmoji;
  count: number;
  own: boolean;
};

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return MESSAGE_REACTIONS.some(({ emoji }) => emoji === value);
}

export function parseReactions(value: string): MessageReaction[] {
  const rows = JSON.parse(value) as MessageReaction[];
  return MESSAGE_REACTIONS.flatMap(({ emoji }) => {
    const row = rows.find((reaction) => reaction.emoji === emoji);
    return row && row.count > 0
      ? [{ emoji, count: row.count, own: !!row.own }]
      : [];
  });
}

/** Reactions after the viewer sets (or removes, with null) their one reaction. */
export function withOwnReaction(
  reactions: MessageReaction[] = [],
  emoji: ReactionEmoji | null,
): MessageReaction[] {
  const current = reactions.find((reaction) => reaction.own)?.emoji ?? null;
  if (current === emoji) return reactions;
  return MESSAGE_REACTIONS.flatMap(({ emoji: item }) => {
    const count =
      (reactions.find((reaction) => reaction.emoji === item)?.count || 0) -
      (item === current ? 1 : 0) +
      (item === emoji ? 1 : 0);
    return count > 0 ? [{ emoji: item, count, own: item === emoji }] : [];
  });
}
