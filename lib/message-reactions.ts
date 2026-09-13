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
