import { giftDefinition } from './gift-catalog';

export const NOCT_GIFTS_GAME_VERSION = '2026-09-16-1';
// The advertised rules and the actual draw must use the same values.
export const NOCT_GIFTS_UPGRADE_RULES = {
  feePercent: 0,
  chancePercent: 80,
  minChance: 1,
  maxChance: 85,
} as const;
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
// Balance uses canonical gift values and their 85% sale proceeds, not rarity labels.
// This does not reopen their direct purchase or invent collectible serial numbers.
export const NOCT_GIFTS_CASES: CaseDefinition[] = [
  {
    id: 'moon',
    n: 'Лунный',
    p: 75,
    t: '#C7ACE8',
    s: 'circle',
    items: [
      ['mask', 70],
      ['rabbit', 15],
      ['orb', 8],
      ['comet', 4],
      ['stardust', 2],
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
      ['rabbit', 44],
      ['orb', 40],
      ['watch', 10],
      ['ring', 5],
      ['throne', 1],
    ],
  },
  {
    id: 'eclipse',
    n: 'Затмение',
    p: 320,
    t: '#C7ACE8',
    s: 'diamond',
    items: [
      ['orb', 35],
      ['watch', 30],
      ['mask', 17],
      ['comet', 11],
      ['ring', 6],
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
      ['mask', 84],
      ['rabbit', 10],
      ['comet', 5],
      ['stardust', 1],
    ],
  },
];
export function noctGiftsGameCatalog(origin: string) {
  return {
    version: NOCT_GIFTS_GAME_VERSION,
    counts: [1, 3, 5, 10],
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
    upgrade: NOCT_GIFTS_UPGRADE_RULES,
  };
}
