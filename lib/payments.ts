import catalog from './commerce-catalog.json';
import { db } from './storage';
import { setting } from './auth-session';
import { ApiError } from './api-error';
import { assertWritable } from './account-access';
import { cryptoPay, cryptoInvoiceUrl, rubMinor } from './payment-provider';
import { rateLimit } from './rate-limit';

export type PaymentOrder = {
  id: string;
  requestKey: string;
  userId: string;
  telegramId: string | null;
  linkId: string | null;
  sku: string;
  product: string;
  units: number;
  provider: 'telegram' | 'crypto';
  currency: string;
  amountMinor: number;
  providerInvoiceId: string | null;
  checkoutUrl: string | null;
  primaryReceipt: string | null;
  created: number;
  expiresAt: number;
  fulfilledAt: number | null;
  reversedAt: number | null;
  reviewReason: string;
  checkedAt: number;
  precheckoutId: string | null;
};
type Receipt = {
  provider: 'telegram' | 'crypto';
  chargeId: string;
  orderId: string;
  currency: string;
  amountMinor: number;
  payerId: string;
  refund?: boolean;
};
type CryptoInvoice = {
  invoice_id: number;
  status: string;
  currency_type: string;
  fiat: string;
  amount: string;
  payload: string;
  web_app_invoice_url: string;
};
const botConfigured = () =>
  setting('NOCT_BOT_SECRET').length >= 32 &&
  /^[a-zA-Z][a-zA-Z0-9_]{1,28}bot$/i.test(setting('NOCT_BOT_USERNAME'));
export function paymentCatalog() {
  return {
    products: catalog,
    telegram: botConfigured(),
    crypto: !!setting('CRYPTO_PAY_API_TOKEN'),
  };
}
function value(v: unknown, max = 120) {
  if (typeof v !== 'string' || !v || v.length > max)
    throw new ApiError(400, 'Некорректный запрос оплаты');
  return v;
}
export async function paymentOrder(id: string) {
  return db()
    .prepare('SELECT * FROM payment_orders WHERE id=?')
    .bind(id)
    .first<PaymentOrder>();
}
export function publicOrder(o: PaymentOrder) {
  return {
    id: o.id,
    sku: o.sku,
    product: o.product,
    units: o.units,
    provider: o.provider,
    currency: o.currency,
    amountMinor: o.amountMinor,
    expiresAt: o.expiresAt,
    fulfilledAt: o.fulfilledAt,
    reversedAt: o.reversedAt,
    status: o.reversedAt
      ? 'refunded'
      : o.fulfilledAt
        ? 'paid'
        : o.reviewReason
          ? 'review'
          : o.expiresAt < Date.now()
            ? 'expired'
            : 'pending',
    checkoutUrl: o.checkoutUrl,
  };
}
export async function createPayment(me: string, b: Record<string, unknown>) {
  await assertWritable(me);
  if (b.acceptedTerms !== true)
    throw new ApiError(400, 'Подтвердите условия покупки');
  const item = catalog.find((p) => p.id === b.sku),
    provider = b.provider,
    key = value(b.key);
  if (
    !item ||
    !['telegram', 'crypto'].includes(String(provider)) ||
    !/^[a-zA-Z0-9_-]{8,120}$/.test(key)
  )
    throw new ApiError(400, 'Выберите товар и способ оплаты');
  if (provider === 'telegram' && !botConfigured())
    throw new ApiError(503, 'Бот оплаты недоступен');
  if (provider === 'crypto' && !setting('CRYPTO_PAY_API_TOKEN'))
    throw new ApiError(503, 'Crypto Pay недоступен');
  const old = await db()
    .prepare('SELECT * FROM payment_orders WHERE userId=? AND requestKey=?')
    .bind(me, key)
    .first<PaymentOrder>();
  if (old) {
    if (old.sku !== item.id || old.provider !== provider)
      throw new ApiError(409, 'Этот запрос уже связан с другой покупкой');
    return old;
  }
  const link =
    provider === 'telegram'
      ? await db()
          .prepare('SELECT id,telegramId FROM telegram_links WHERE userId=?')
          .bind(me)
          .first<{ id: string; telegramId: string }>()
      : null;
  if (provider === 'telegram' && !link)
    throw new ApiError(409, 'Сначала привяжи Telegram в меню Noct Stars');
  const now = Date.now(),
    id = crypto.randomUUID();
  await db()
    .prepare(`INSERT INTO payment_orders(id,requestKey,userId,telegramId,linkId,sku,product,units,provider,currency,amountMinor,created,expiresAt)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? FROM users u WHERE u.id=? AND u.kind='person' AND u.deletedAt=0 AND NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.userId=u.id AND (r.expiresAt IS NULL OR r.expiresAt>?))
    ON CONFLICT(userId,requestKey) DO NOTHING`)
    .bind(
      id,
      key,
      me,
      link?.telegramId || null,
      link?.id || null,
      item.id,
      item.product,
      item.units,
      provider,
      provider === 'telegram' ? 'XTR' : 'RUB',
      provider === 'telegram' ? item.xtr : item.rub * 100,
      now,
      now + 30 * 60000,
      me,
      now,
    )
    .run();
  const order = await db()
    .prepare('SELECT * FROM payment_orders WHERE userId=? AND requestKey=?')
    .bind(me, key)
    .first<PaymentOrder>();
  if (!order) throw new ApiError(403, 'Покупка недоступна для аккаунта');
  if (order.sku !== item.id || order.provider !== provider)
    throw new ApiError(409, 'Этот запрос уже связан с другой покупкой');
  return order;
}
export async function checkout(order: PaymentOrder) {
  if (order.fulfilledAt || order.reversedAt) return publicOrder(order);
  if (order.expiresAt <= Date.now())
    throw new ApiError(410, 'Срок счёта истёк. Создайте новый.');
  if (order.provider === 'telegram')
    return {
      ...publicOrder(order),
      checkoutUrl: `https://t.me/${setting('NOCT_BOT_USERNAME')}?start=pay_${order.id.replaceAll('-', '')}`,
    };
  if (order.checkoutUrl) return publicOrder(order);
  // Retry with the same opaque payload. Only the chosen invoice is presented;
  // unobserved duplicate invoices from interrupted create requests cannot credit.
  const invoice = await cryptoPay<CryptoInvoice>('createInvoice', {
    currency_type: 'fiat',
    fiat: 'RUB',
    amount: (order.amountMinor / 100).toFixed(2),
    accepted_assets: 'USDT,TON',
    description: catalog.find((p) => p.id === order.sku)!.title,
    payload: order.id,
    expires_in: Math.max(60, Math.floor((order.expiresAt - Date.now()) / 1000)),
    allow_comments: false,
    allow_anonymous: true,
  });
  const url = cryptoInvoiceUrl(invoice.web_app_invoice_url);
  if (
    !url ||
    !Number.isSafeInteger(invoice.invoice_id) ||
    invoice.invoice_id <= 0 ||
    invoice.currency_type !== 'fiat' ||
    invoice.fiat !== 'RUB' ||
    rubMinor(invoice.amount) !== order.amountMinor ||
    invoice.payload !== order.id
  )
    throw new ApiError(502, 'Crypto Pay вернул некорректный счёт');
  await db()
    .prepare(
      'UPDATE payment_orders SET providerInvoiceId=?,checkoutUrl=? WHERE id=? AND providerInvoiceId IS NULL',
    )
    .bind(String(invoice.invoice_id), url, order.id)
    .run();
  return publicOrder((await paymentOrder(order.id))!);
}
export async function verifyCrypto(order: PaymentOrder) {
  if (
    order.provider !== 'crypto' ||
    !order.providerInvoiceId ||
    order.fulfilledAt ||
    order.reversedAt
  )
    return order;
  const result = await cryptoPay<{ items: CryptoInvoice[] }>('getInvoices', {
    invoice_ids: order.providerInvoiceId,
  });
  const invoice = result.items.find(
    (i) => String(i.invoice_id) === order.providerInvoiceId,
  );
  if (!invoice || invoice.status !== 'paid') return order;
  if (
    invoice.currency_type !== 'fiat' ||
    invoice.fiat !== 'RUB' ||
    invoice.payload !== order.id ||
    rubMinor(invoice.amount) !== order.amountMinor
  )
    throw new ApiError(409, 'Данные платежа не совпадают со счётом');
  await recordPayment({
    provider: 'crypto',
    chargeId: String(invoice.invoice_id),
    orderId: order.id,
    currency: 'RUB',
    amountMinor: order.amountMinor,
    payerId: '',
  });
  return (await paymentOrder(order.id))!;
}
export async function recordPayment(receipt: Receipt) {
  const o = await paymentOrder(value(receipt.orderId, 36));
  if (
    !o ||
    o.provider !== receipt.provider ||
    o.currency !== receipt.currency ||
    o.amountMinor !== receipt.amountMinor ||
    !Number.isSafeInteger(receipt.amountMinor) ||
    (o.provider === 'telegram' && o.telegramId !== receipt.payerId) ||
    (o.provider === 'crypto' && o.providerInvoiceId !== receipt.chargeId)
  )
    throw new ApiError(409, 'Платёж не соответствует заказу');
  const chargeId = value(receipt.chargeId, 256),
    id = receipt.provider + ':' + chargeId,
    now = Date.now(),
    d = db();
  const existing = await d
    .prepare(
      'SELECT orderId,currency,amountMinor,payerId FROM payment_receipts WHERE id=?',
    )
    .bind(id)
    .first<Receipt>();
  if (
    existing &&
    (existing.orderId !== o.id ||
      existing.currency !== receipt.currency ||
      existing.amountMinor !== receipt.amountMinor ||
      existing.payerId !== receipt.payerId)
  )
    throw new ApiError(409, 'Квитанция уже связана с другой покупкой');
  const eligible = `o.id=? AND o.fulfilledAt IS NULL AND o.reversedAt IS NULL AND r.id=? AND r.orderId=o.id AND r.provider=o.provider AND r.currency=o.currency AND r.amountMinor=o.amountMinor AND r.paidAt IS NOT NULL AND r.refundedAt IS NULL AND EXISTS(SELECT 1 FROM users u WHERE u.id=o.userId AND u.deletedAt=0)`;
  const reversed = `EXISTS(SELECT 1 FROM payment_orders o JOIN payment_receipts r ON r.id=o.primaryReceipt WHERE o.id=? AND o.id=premium_purchases.orderId AND o.reversedAt IS NULL AND r.refundedAt IS NOT NULL)`;
  const start = `MAX(?,COALESCE((SELECT MAX(expiresAt) FROM premium_purchases pp WHERE pp.userId=o.userId AND pp.revokedAt=0),0),COALESCE((SELECT expiresAt FROM premium_entitlements pe WHERE pe.userId=o.userId AND pe.revokedAt=0 AND pe.source<>'test'),0))`;
  await d.batch([
    d
      .prepare(`INSERT INTO payment_receipts(id,provider,chargeId,orderId,currency,amountMinor,payerId,verifiedAt,paidAt,refundedAt) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET paidAt=COALESCE(payment_receipts.paidAt,excluded.paidAt),refundedAt=COALESCE(payment_receipts.refundedAt,excluded.refundedAt)
      WHERE payment_receipts.orderId=excluded.orderId AND payment_receipts.currency=excluded.currency AND payment_receipts.amountMinor=excluded.amountMinor AND payment_receipts.payerId=excluded.payerId`)
      .bind(
        id,
        receipt.provider,
        chargeId,
        o.id,
        receipt.currency,
        receipt.amountMinor,
        receipt.payerId,
        now,
        receipt.refund ? null : now,
        receipt.refund ? now : null,
      ),
    d
      .prepare(
        `UPDATE payment_orders SET primaryReceipt=? WHERE id=? AND primaryReceipt IS NULL AND EXISTS(SELECT 1 FROM payment_receipts WHERE id=? AND orderId=payment_orders.id)`,
      )
      .bind(id, o.id, id),
    d
      .prepare(
        `INSERT INTO star_transfers(id,recipient,amount,kind,created) SELECT 'purchase:'||o.id,o.userId,o.units,'purchase',? FROM payment_orders o JOIN payment_receipts r ON r.id=o.primaryReceipt WHERE ${eligible} AND o.product='stars' ON CONFLICT(id) DO NOTHING`,
      )
      .bind(now, o.id, id),
    d
      .prepare(
        `INSERT INTO premium_purchases(orderId,userId,startsAt,expiresAt,created) SELECT o.id,o.userId,${start},${start}+o.units*86400000,? FROM payment_orders o JOIN payment_receipts r ON r.id=o.primaryReceipt WHERE ${eligible} AND o.product='premium' ON CONFLICT(orderId) DO NOTHING`,
      )
      .bind(
        Math.floor(now / 1000) * 1000,
        Math.floor(now / 1000) * 1000,
        now,
        o.id,
        id,
      ),
    d
      .prepare(
        `UPDATE payment_orders SET fulfilledAt=? WHERE id=? AND fulfilledAt IS NULL AND (EXISTS(SELECT 1 FROM star_transfers WHERE id='purchase:'||payment_orders.id) OR EXISTS(SELECT 1 FROM premium_purchases WHERE orderId=payment_orders.id))`,
      )
      .bind(now, o.id),
    d
      .prepare(
        `INSERT INTO star_transfers(id,recipient,amount,kind,created) SELECT 'refund:'||o.id,o.userId,-o.units,'purchase_refund',? FROM payment_orders o JOIN payment_receipts r ON r.id=o.primaryReceipt WHERE o.id=? AND r.refundedAt IS NOT NULL AND o.product='stars' AND EXISTS(SELECT 1 FROM star_transfers WHERE id='purchase:'||o.id) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(now, o.id),
    // Remove only unused time of this purchased interval. Later purchases retain
    // their full duration; separate administrator entitlements are never shortened.
    d
      .prepare(
        `UPDATE premium_purchases SET startsAt=startsAt-(SELECT MAX(0,p.expiresAt-MAX(?,p.startsAt)) FROM premium_purchases p WHERE p.orderId=?),expiresAt=expiresAt-(SELECT MAX(0,p.expiresAt-MAX(?,p.startsAt)) FROM premium_purchases p WHERE p.orderId=?) WHERE userId=? AND orderId<>? AND revokedAt=0 AND startsAt>=(SELECT expiresAt FROM premium_purchases WHERE orderId=?) AND EXISTS(SELECT 1 FROM premium_purchases WHERE ${reversed} AND revokedAt=0)`,
      )
      .bind(now, o.id, now, o.id, o.userId, o.id, o.id, o.id),
    d
      .prepare(
        `UPDATE premium_purchases SET revokedAt=? WHERE ${reversed} AND revokedAt=0`,
      )
      .bind(now, o.id),
    d
      .prepare(
        `UPDATE payment_orders SET reversedAt=? WHERE id=? AND reversedAt IS NULL AND EXISTS(SELECT 1 FROM payment_receipts r WHERE r.id=primaryReceipt AND r.refundedAt IS NOT NULL)`,
      )
      .bind(now, o.id),
    d
      .prepare(
        `UPDATE payment_orders SET reviewReason=CASE WHEN primaryReceipt<>? THEN 'duplicate_charge_refund_required' WHEN NOT EXISTS(SELECT 1 FROM users u WHERE u.id=userId AND u.deletedAt=0) THEN 'account_deleted_refund_required' ELSE reviewReason END WHERE id=?`,
      )
      .bind(id, o.id),
  ]);
  return publicOrder((await paymentOrder(o.id))!);
}
export async function botPayments(b: Record<string, unknown>) {
  const action = String(b.action);
  if (!action.startsWith('payment')) return null;
  if (action === 'paymentDiagnostics') {
    const counts = await db()
      .prepare(
        "SELECT (SELECT COUNT(*) FROM payment_support) AS supportRequests,(SELECT COUNT(*) FROM payment_orders WHERE reviewReason<>'') AS ordersForReview,(SELECT COUNT(*) FROM payment_orders WHERE fulfilledAt IS NOT NULL) AS fulfilledOrders",
      )
      .first();
    return {
      ...counts,
      ...(b.details === true
        ? {
            support: (
              await db()
                .prepare(
                  'SELECT id,telegramId,text,created FROM payment_support ORDER BY created DESC LIMIT 50',
                )
                .all()
            ).results,
            reviews: (
              await db()
                .prepare(
                  "SELECT id,provider,reviewReason,created FROM payment_orders WHERE reviewReason<>'' ORDER BY created DESC LIMIT 50",
                )
                .all()
            ).results,
          }
        : {}),
    };
  }
  if (action === 'paymentReconcile') {
    const rows = await db()
      .prepare(
        "SELECT * FROM payment_orders WHERE provider='crypto' AND fulfilledAt IS NULL AND reversedAt IS NULL AND providerInvoiceId IS NOT NULL ORDER BY checkedAt,created LIMIT 5",
      )
      .all<PaymentOrder>();
    let checked = 0;
    for (const order of rows.results) {
      await db()
        .prepare('UPDATE payment_orders SET checkedAt=? WHERE id=?')
        .bind(Date.now(), order.id)
        .run();
      try {
        await verifyCrypto(order);
        checked++;
      } catch {
        /* Rotate failures too; a stale invoice must not starve newer payments. */
      }
    }
    return { checked };
  }
  if (action === 'paymentRefunds')
    return {
      receipts: (
        await db()
          .prepare(
            `SELECT r.chargeId,r.orderId AS id,r.payerId AS telegramId,r.amountMinor AS amount,r.currency FROM payment_receipts r JOIN payment_orders o ON o.id=r.orderId JOIN users u ON u.id=o.userId WHERE r.provider='telegram' AND r.currency='XTR' AND r.paidAt IS NOT NULL AND r.refundedAt IS NULL AND r.amountMinor=o.amountMinor AND r.payerId=o.telegramId AND (o.primaryReceipt<>r.id OR (o.primaryReceipt=r.id AND u.deletedAt>0 AND o.fulfilledAt IS NULL AND NOT EXISTS(SELECT 1 FROM star_transfers t WHERE t.id='purchase:'||o.id) AND NOT EXISTS(SELECT 1 FROM premium_purchases p WHERE p.orderId=o.id))) LIMIT 20`,
          )
          .all()
      ).results,
    };
  if (action === 'paymentResolveReceipt') {
    const receipt = await db()
      .prepare(
        "SELECT orderId FROM payment_receipts WHERE provider='telegram' AND chargeId=?",
      )
      .bind(value(b.chargeId, 256))
      .first<{ orderId: string }>();
    return { id: receipt?.orderId || null };
  }
  const telegramId = value(b.telegramId, 16);
  if (!/^[1-9]\d{0,15}$/.test(telegramId))
    throw new ApiError(400, 'Некорректный Telegram аккаунт');
  if (action === 'paymentSupport') {
    await rateLimit('payment-support', telegramId, 5, 3600);
    const text = value(b.text, 1500),
      key = value(b.key, 100);
    await db()
      .prepare(
        'INSERT INTO payment_support(id,telegramId,text,created) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',
      )
      .bind(key, telegramId, text, Date.now())
      .run();
    return { ok: true };
  }
  if (action === 'paymentReceipt')
    return recordPayment({
      provider: 'telegram',
      chargeId: value(b.chargeId, 256),
      orderId: value(b.id, 36),
      currency: String(b.currency),
      amountMinor: Number(b.amount),
      payerId: telegramId,
      refund: b.refund === true,
    });
  if (action === 'paymentHistory')
    return {
      orders: (
        await db()
          .prepare(
            'SELECT id,sku,product,units,amountMinor,currency,created,fulfilledAt,reversedAt FROM payment_orders WHERE telegramId=? ORDER BY created DESC LIMIT 10',
          )
          .bind(telegramId)
          .all()
      ).results,
    };
  if (action === 'paymentCreate') {
    await rateLimit('payment-bot-create', telegramId, 30, 3600);
    const link = await db()
      .prepare('SELECT userId FROM telegram_links WHERE telegramId=?')
      .bind(telegramId)
      .first<{ userId: string }>();
    if (!link) throw new ApiError(409, 'Привяжите Telegram на сайте');
    const order = await createPayment(link.userId, {
      ...b,
      provider: 'telegram',
    });
    return { order: publicOrder(order) };
  }
  const order = await paymentOrder(value(b.id, 36));
  if (
    !order ||
    order.provider !== 'telegram' ||
    order.telegramId !== telegramId
  )
    throw new ApiError(404, 'Счёт недоступен');
  await assertWritable(order.userId);
  if (
    !(await db()
      .prepare(
        'SELECT 1 FROM telegram_links WHERE id=? AND userId=? AND telegramId=?',
      )
      .bind(order.linkId, order.userId, telegramId)
      .first())
  )
    throw new ApiError(409, 'Привязка изменилась. Создай новый счёт на сайте.');
  if (order.fulfilledAt || order.reversedAt || order.expiresAt < Date.now())
    throw new ApiError(409, 'Счёт уже оплачен, отменён или истёк');
  if (
    action === 'paymentPrecheck' &&
    (b.currency !== 'XTR' || b.amount !== order.amountMinor)
  )
    throw new ApiError(409, 'Сумма счёта изменилась');
  if (action === 'paymentPrecheck') {
    const precheckoutId = value(b.precheckoutId, 200);
    const locked = await db()
      .prepare(
        `UPDATE payment_orders SET precheckoutId=? WHERE id=? AND (precheckoutId IS NULL OR precheckoutId=?) AND fulfilledAt IS NULL AND reversedAt IS NULL AND expiresAt>? AND EXISTS(SELECT 1 FROM telegram_links l WHERE l.id=payment_orders.linkId AND l.userId=payment_orders.userId AND l.telegramId=payment_orders.telegramId)`,
      )
      .bind(precheckoutId, order.id, precheckoutId, Date.now())
      .run();
    if (!locked.meta.changes)
      throw new ApiError(
        409,
        'Этот счёт уже обрабатывается. Проверь историю или создай новый.',
      );
  }
  if (action !== 'paymentPrecheck' && action !== 'paymentInvoice')
    throw new ApiError(400, 'Неизвестное действие');
  return {
    order: publicOrder(order),
    invoice: {
      title: catalog.find((p) => p.id === order.sku)!.title,
      description:
        order.product === 'premium'
          ? 'Noct Premium на 30 дней, без автопродления.'
          : 'Внутренняя валюта NoctGram для подарков и поддержки авторов.',
      payload: order.id,
      currency: 'XTR',
      provider_token: '',
      prices: [
        {
          label: catalog.find((p) => p.id === order.sku)!.title,
          amount: order.amountMinor,
        },
      ],
    },
  };
}
