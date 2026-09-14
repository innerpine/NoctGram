import data from './gift-upgrade-data.json';
import type { GiftUpgradeCollection } from './gift-collectibles';

const collections = new Map(
  // Noctgram upgrade pricing is independent of the imported Telegram quotes.
  (data as GiftUpgradeCollection[]).map((gift) => [
    gift.id,
    { ...gift, price: 25 },
  ]),
);
export function upgradeCollection(id: string) {
  return collections.get(id) || null;
}
