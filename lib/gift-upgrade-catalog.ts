import data from './gift-upgrade-data.json';
import type { GiftUpgradeCollection } from './gift-collectibles';

const collections = new Map(
  (data as GiftUpgradeCollection[]).map((gift) => [gift.id, gift]),
);
export function upgradeCollection(id: string) {
  return collections.get(id) || null;
}
