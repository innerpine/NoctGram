import { db } from './storage';
import { ApiError } from './api-error';
import { visibleAccount } from './account-access';
import { balance } from './star-wallet';
import { rateLimit } from './rate-limit';
import {
  GIFT_CONVERSION_FEE_PERCENT,
  giftConversionAmount,
  type GiftConversionPreview,
  type GiftConversionResult,
} from './gift-conversion-policy';

function receiptId(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 220)
    throw new ApiError(400, 'Выбери полученный подарок');
  return value;
}

async function ownedGift(me: string, id: string) {
  const gift = await db()
    .prepare(`SELECT g.created,COALESCE(p.amount,0) AS originalPrice,
      (p.kind='gift' AND p.sender=g.sender AND p.recipient='noctgram_gifts') AS paid,
      EXISTS(SELECT 1 FROM gift_upgrades WHERE receiptId=g.id) AS upgraded,
      EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=u.id
        AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000)) AS restricted,
      c.amount AS convertedAmount,c.created AS convertedAt
      FROM received_gifts g JOIN users u ON u.id=g.recipient
      LEFT JOIN star_transfers p ON p.id=g.transferId
      LEFT JOIN gift_conversions c ON c.receiptId=g.id
      WHERE g.id=? AND g.recipient=? AND u.kind='person' AND ${visibleAccount('u')}`)
    .bind(id, me)
    .first<{
      created: number;
      originalPrice: number;
      paid: number;
      upgraded: number;
      restricted: number;
      convertedAmount: number | null;
      convertedAt: number | null;
    }>();
  if (!gift) throw new ApiError(404, 'Подарок не найден');
  return gift;
}

function quote(
  id: string,
  gift: Awaited<ReturnType<typeof ownedGift>>,
  now: number,
): GiftConversionPreview {
  const amount =
    gift.convertedAmount ?? giftConversionAmount(gift.originalPrice);
  const reason =
    gift.convertedAt !== null
      ? 'Подарок уже продан. Звёзды начислены на баланс.'
      : gift.upgraded
        ? 'Коллекционные подарки нельзя продать за звёзды.'
        : !gift.paid || amount <= 0
          ? 'Этот подарок нельзя продать: нет оплаченной покупки.'
          : gift.restricted
            ? 'Продажа недоступна из-за ограничений аккаунта.'
            : now < gift.created
              ? 'Продажа этого подарка пока недоступна.'
              : null;
  return {
    id,
    available: reason === null,
    reason,
    originalPrice: gift.originalPrice,
    amount,
    fee: gift.originalPrice - amount,
    feePercent: GIFT_CONVERSION_FEE_PERCENT,
    convertedAt: gift.convertedAt,
  };
}

export async function previewGiftConversion(
  me: string,
  value: unknown,
  now = Date.now(),
): Promise<GiftConversionPreview> {
  const id = receiptId(value);
  return quote(id, await ownedGift(me, id), now);
}

export async function convertGift(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
): Promise<GiftConversionResult> {
  const id = receiptId(body.id);
  const gift = await ownedGift(me, id);
  // A committed sale remains retrievable indefinitely, and across devices.
  if (gift.convertedAt !== null)
    return {
      id,
      amount: gift.convertedAmount!,
      convertedAt: gift.convertedAt,
      balance: await balance(me),
    };
  const preview = quote(id, gift, now);
  if (!preview.available) throw new ApiError(409, preview.reason!);
  if (body.expectedAmount !== preview.amount)
    throw new ApiError(
      409,
      'Сумма продажи изменилась. Проверь её и подтверди заново.',
    );
  await rateLimit('gift-conversions', me, 12, 60);
  const transferId = 'gift-conversion:' + id;
  await db().batch([
    db()
      .prepare(`INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created)
      SELECT ?,'noctgram_gifts',u.id,?,(p.amount / 100)*85 + ((p.amount % 100)*85)/100,'gift_conversion',?
      FROM received_gifts g JOIN users u ON u.id=g.recipient JOIN star_transfers p ON p.id=g.transferId
      WHERE g.id=? AND g.recipient=? AND u.kind='person' AND ${visibleAccount('u')}
        AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=u.id AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))
        AND p.kind='gift' AND p.sender=g.sender AND p.recipient='noctgram_gifts'
        AND typeof(p.amount)='integer' AND p.amount BETWEEN 1 AND 9007199254740991
        AND (p.amount / 100)*85 + ((p.amount % 100)*85)/100 = ?
        AND g.created<=?
        AND NOT EXISTS(SELECT 1 FROM gift_upgrades WHERE receiptId=g.id)
        AND NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=g.id)
      ON CONFLICT(id) DO NOTHING`)
      .bind(
        transferId,
        JSON.stringify({ receiptId: id }),
        now,
        id,
        me,
        preview.amount,
        now,
      ),
    db()
      .prepare(`INSERT INTO gift_conversions(receiptId,transferId,amount,created)
      SELECT g.id,t.id,t.amount,t.created FROM received_gifts g
      JOIN star_transfers t ON t.id=? AND t.recipient=g.recipient AND t.kind='gift_conversion'
      WHERE g.id=? AND g.recipient=? AND NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=g.id)
      ON CONFLICT(receiptId) DO NOTHING`)
      .bind(transferId, id, me),
  ]);
  const saved = await ownedGift(me, id);
  if (saved.convertedAt === null) {
    const current = quote(id, saved, now);
    throw new ApiError(
      409,
      current.reason ||
        'Не удалось продать подарок. Обнови сведения и попробуй ещё раз.',
    );
  }
  return {
    id,
    amount: saved.convertedAmount!,
    convertedAt: saved.convertedAt,
    balance: await balance(me),
  };
}
