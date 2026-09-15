import { giftDefinition } from './gift-catalog';

export const NOCT_GIFTS_GAME_VERSION = '2026-09-15-4';
// The advertised rules and the actual draw must use the same values.
export const NOCT_GIFTS_UPGRADE_RULES = {
  feePercent: 0,
  chancePercent: 110,
  minChance: 3,
  maxChance: 95,
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
// This does not reopen their direct purchase or invent collectible serial numbers.
export const NOCT_GIFTS_CASES: CaseDefinition[] = [
  {
    id: 'moon',
    n: 'Лунный',
    p: 75,
    t: '#C7ACE8',
    s: 'circle',
    items: [
      ['stardust', 56],
      ['rabbit', 25],
      ['orb', 12],
      ['comet', 5],
      ['throne', 2],
    ],
  },
  {
    id: 'orbit',
    n: 'Орбита',
    p: 150,
    t: '#3ECF8E',
    s: 'squircle',
    items: [
      ['rabbit', 36],
      ['orb', 26],
      ['watch', 23],
      ['ring', 11],
      ['throne', 4],
    ],
  },
  {
    id: 'eclipse',
    n: 'Затмение',
    p: 320,
    t: '#C7ACE8',
    s: 'diamond',
    items: [
      ['orb', 31],
      ['watch', 34],
      ['mask', 16],
      ['comet', 10],
      ['ring', 7],
      ['throne', 2],
    ],
  },
  {
    id: 'midnight',
    n: 'Полночь',
    p: 60,
    t: '#A1A1AA',
    s: 'diamond',
    items: [
      ['stardust', 64],
      ['rabbit', 24],
      ['mask', 8],
      ['comet', 4],
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
