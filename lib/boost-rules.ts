// NoctGram's initial level economy; deliberately independent from Telegram's
// server-controlled thresholds and paid gift/giveaway products.
export const boostRules = {
  slots: 4,
  perLevel: 4,
  maxLevel: 5,
  cooldown: 86400000,
} as const;
export function boostLevel(count: number) {
  return Math.min(
    boostRules.maxLevel,
    Math.floor(Math.max(0, count) / boostRules.perLevel),
  );
}
