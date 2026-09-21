import type { GiftAttributes } from './gift-collectibles';
import { readApiJson } from './http-response';

// Noct Market policy. The fee is charged to the buyer's payment and goes to the
// treasury; system lots have no seller and therefore no fee.
export const MARKET_FEE_PERCENT = 5;
export const MARKET_MAX_PRICE = 10_000_000;

export function marketFee(price: number): number {
  if (!Number.isSafeInteger(price) || price <= 0) return 0;
  return Math.floor((price * MARKET_FEE_PERCENT) / 100);
}
export function formatMarketNumber(number: string) {
  return `+888 ${number.slice(0, 4)} ${number.slice(4)}`;
}

export type MarketKind = 'number' | 'username' | 'gift';
export type MarketPerson = {
  id: string;
  name: string;
  avatar: string;
  handle: string;
};
export type MarketGift = {
  family: string;
  number: number;
  name: string;
  attributes: GiftAttributes;
};
// `key` is the public asset id: a handle, eight digits or `family:number`.
export type MarketRow = {
  kind: MarketKind;
  key: string;
  title: string;
  status: 'sale' | 'sold' | 'idle';
  price: number | null;
  listingId: string | null;
  closed: number;
  gift?: MarketGift;
};
export type MarketFacet = {
  id: string;
  name: string;
  rarityPermille?: number;
  count: number;
};
export type MarketCatalog = {
  rows: MarketRow[];
  more: boolean;
  counts: Record<MarketKind, number>;
  families?: MarketFacet[];
  attributes?: Record<'model' | 'backdrop' | 'symbol', MarketFacet[]>;
};
export type MarketSale = {
  seller: MarketPerson | null;
  buyer: MarketPerson | null;
  system: boolean;
  price: number;
  closed: number;
};
export type MarketLot = {
  kind: MarketKind;
  key: string;
  title: string;
  issued: number;
  owner: MarketPerson | null;
  mine: boolean;
  listing: { id: string; price: number; system: boolean } | null;
  history: MarketSale[];
  gift?: MarketGift;
};
export type MarketAsset = {
  kind: MarketKind;
  key: string;
  title: string;
  main?: boolean;
  displayed?: boolean;
  listing: { id: string; price: number } | null;
  gift?: MarketGift;
};
export type MarketAssets = { balance: number; assets: MarketAsset[] };

export type MarketApiError = Error & { status?: number; code?: string };
export async function marketApi<T>(query = '', body?: object): Promise<T> {
  const response = await fetch('/api/market' + query, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await readApiJson<T>(response, 'Не удалось загрузить Маркет');
  if (data.code === 'ONBOARDING_REQUIRED') window.location.replace('/welcome');
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || 'Не удалось загрузить Маркет'),
      { status: response.status, code: data.code },
    );
  return data;
}
