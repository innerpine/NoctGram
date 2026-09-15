import { giftDefinition } from './gift-catalog';

export const NOCT_GIFTS_GAME_VERSION = '2026-09-15-1';
export const NOCT_GIFTS_ALIASES: Record<
  string,
  { id: string; rarity: string }
> = {
  stardust: { id: 'ion_gem', rarity: 'common' },
  rabbit: { id: 'jelly_bunny', rarity: 'common' },
  orb: { id: 'crystal_ball', rarity: 'rare' },
  watch: { id: 'swiss_watch', rarity: 'rare' },
  mask: { id: 'witch_hat', rarity: 'epic' },
  comet: { id: 'astral_shard', rarity: 'epic' },
  ring: { id: 'bonded_ring', rarity: 'legend' },
  throne: { id: 'plush_pepe', rarity: 'legend' },
};
type CaseDefinition = {
  id: string;
  n: string;
  p: number;
  t: string;
  s: string;
  items: [string, number][];
};
// Explicit case-only distribution, including the archived gifts used in the design.
// This does not reopen their direct purchase or invent collectible serial numbers.
export const NOCT_GIFTS_CASES: CaseDefinition[] = [
  {
    id: 'moon',
    n: 'Лунный',
    p: 75,
    t: '#C7ACE8',
    s: 'circle',
    items: [
      ['stardust', 52],
      ['rabbit', 28],
      ['orb', 14],
      ['comet', 5],
      ['throne', 1],
    ],
  },
  {
    id: 'orbit',
    n: 'Орбита',
    p: 150,
    t: '#3ECF8E',
    s: 'squircle',
    items: [
      ['rabbit', 40],
      ['orb', 30],
      ['watch', 18],
      ['ring', 9],
      ['throne', 3],
    ],
  },
  {
    id: 'eclipse',
    n: 'Затмение',
    p: 320,
    t: '#C7ACE8',
    s: 'diamond',
    items: [
      ['orb', 34],
      ['watch', 28],
      ['mask', 20],
      ['comet', 12],
      ['ring', 5],
      ['throne', 1],
    ],
  },
  {
    id: 'midnight',
    n: 'Полночь',
    p: 60,
    t: '#A1A1AA',
    s: 'diamond',
    items: [
      ['stardust', 60],
      ['rabbit', 25],
      ['mask', 12],
      ['comet', 3],
    ],
  },
];
export function noctGiftsGameCatalog(origin: string) {
  return {
    version: NOCT_GIFTS_GAME_VERSION,
    cases: NOCT_GIFTS_CASES,
    gifts: Object.fromEntries(
      Object.entries(NOCT_GIFTS_ALIASES).map(([alias, entry]) => {
        const gift = giftDefinition(entry.id)!;
        return [
          alias,
          {
            giftId: gift.id,
            name: gift.name,
            price: gift.price,
            color: gift.color,
            rarity: entry.rarity,
            imageUrl: new URL(`/assets/gifts/${gift.id}.webp`, origin).href,
            animationUrl: new URL(`/assets/gifts/${gift.id}.json`, origin).href,
          },
        ];
      }),
    ),
    upgrade: { feePercent: 35, chancePercent: 88, minChance: 2, maxChance: 92 },
  };
}
