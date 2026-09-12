import eligible from './gift-upgrade-eligibility.json';

export const canUpgradeGift = (id: string) => eligible.includes(id);

// A Noctgram collectible is recorded in D1. It is not a minted TON NFT.
export type GiftAttribute = {
  id: string;
  name: string;
  rarityPermille: number;
};
export type GiftModel = GiftAttribute & { asset: string };
export type GiftSymbol = GiftAttribute & { asset: string };
export type GiftBackdrop = GiftAttribute & {
  centerColor: string;
  edgeColor: string;
  patternColor: string;
  textColor: string;
};
export type GiftAttributes = {
  model: GiftModel;
  backdrop: GiftBackdrop;
  symbol: GiftSymbol;
};
export type GiftCollectible = GiftAttributes & {
  issuance?: 'admin';
  family: string;
  number: number;
  keepOriginal: boolean;
  upgradedAt: number;
};
export type GiftUpgradeCollection = {
  id: string;
  telegramId: string;
  title: string;
  price: number;
  models: GiftModel[];
  backdrops: GiftBackdrop[];
  symbols: GiftSymbol[];
};
export type GiftUpgradePreview = {
  balance: number;
  collection: GiftUpgradeCollection | null;
  collectible: GiftCollectible | null;
};

export function giftRarity(permille: number) {
  return (
    (permille / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%'
  );
}

export type GiftUpgradeRow = {
  family: string;
  number: number;
  attributes: string;
  keepOriginal: number;
  created: number;
};
export function collectibleFromRow(row: GiftUpgradeRow): GiftCollectible {
  return {
    ...(JSON.parse(row.attributes) as GiftAttributes),
    family: row.family,
    number: row.number,
    keepOriginal: row.keepOriginal === 1,
    upgradedAt: row.created,
  };
}
