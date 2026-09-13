// Noctgram policy: explicitly chosen commission, independent of Telegram's
// per-gift convert_stars quotes. Only whole Noct Stars are credited.
export const GIFT_CONVERSION_FEE_PERCENT = 15;

export function giftConversionAmount(price: number): number {
  if (!Number.isSafeInteger(price) || price <= 0) return 0;
  // Split the integer before multiplying to avoid precision loss for large sums.
  return Math.floor(price / 100) * 85 + Math.floor(((price % 100) * 85) / 100);
}

export type GiftConversionPreview = {
  id: string;
  available: boolean;
  reason: string | null;
  originalPrice: number;
  amount: number;
  fee: number;
  feePercent: number;
  convertedAt: number | null;
};

export type GiftConversionResult = {
  id: string;
  amount: number;
  balance: number;
  convertedAt: number;
};
