import { ApiError } from './api-error';
import { setting } from './auth-session';
import { db } from './storage';
import { listGifts } from './gifts';
import { giftDefinition } from './gift-catalog';
import { balance } from './star-wallet';
import { paymentCatalog, createPayment, checkout } from './payments';
import { rateLimit } from './rate-limit';
import { readJsonBody } from './request-body';
import { verifyNoctGiftsInitData } from './noct-gifts-auth';
import { noctGiftsGameCatalog } from './noct-gifts-catalog';

type LinkedUser = {
  linkId: string;
  id: string;
  name: string;
  handle: string;
  avatar: string;
  kind: string;
  deletedAt: number;
  onboardingComplete: number;
  sessionsRevokedAt: number;
  blocked: number;
};
export const noctGiftsHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
};
export async function noctGiftsBody(req: Request, allowed: readonly string[]) {
  if (
    (req.headers.get('origin') &&
      req.headers.get('origin') !== new URL(req.url).origin) ||
    req.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new ApiError(403, 'Недопустимый источник запроса');
  if (
    !req.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new ApiError(415, 'Ожидается JSON');
  const body = await readJsonBody(req, 16384);
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new ApiError(400, 'Некорректные поля запроса');
  return body;
}
export async function noctGiftsLinkedUser(
  telegramId: string,
  authenticatedAt: number,
) {
  const row = await db()
    .prepare(`SELECT l.id AS linkId,u.id,u.name,u.avatar,u.kind,u.deletedAt,u.onboardingComplete,u.sessionsRevokedAt,COALESCE(h.handle,'') AS handle,
    EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=u.id AND ar.mode='blocked' AND (ar.expiresAt IS NULL OR ar.expiresAt>?)) AS blocked
    FROM telegram_links l JOIN users u ON u.id=l.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE l.telegramId=?`)
    .bind(Date.now(), telegramId)
    .first<LinkedUser>();
  if (!row) return null;
  if (
    row.kind !== 'person' ||
    row.deletedAt ||
    !row.onboardingComplete ||
    row.blocked
  )
    throw new ApiError(
      403,
      'Аккаунт NoctGram недоступен.',
      'ACCOUNT_UNAVAILABLE',
    );
  if (row.sessionsRevokedAt > authenticatedAt)
    throw new ApiError(
      401,
      'Сеансы отозваны. Откройте приложение заново в Telegram.',
      'TELEGRAM_AUTH_EXPIRED',
    );
  return row;
}
export async function noctGiftsIdentity(raw: unknown) {
  const auth = await verifyNoctGiftsInitData(
    raw,
    setting('NOCT_GIFTS_BOT_TOKEN'),
  );
  await rateLimit('noct-gifts-read', auth.telegramId, 90, 60);
  return {
    ...auth,
    user: await noctGiftsLinkedUser(auth.telegramId, auth.authenticatedAt),
  };
}
function links(origin: string) {
  const siteUrl = new URL('/', origin).href;
  const username = setting('NOCT_BOT_USERNAME');
  return {
    siteUrl,
    linkAccountUrl: siteUrl,
    topupUrl: siteUrl,
    linkAccountHint:
      'Войдите в NoctGram → Noct Stars → Telegram → Привязать Telegram. Затем вернитесь сюда.',
    topupHint:
      'Оплата проходит в действующем боте NoctGram. После оплаты вернитесь и обновите баланс.',
    topupBotUrl: /^[a-zA-Z][a-zA-Z0-9_]{1,28}bot$/i.test(username)
      ? `https://t.me/${username}?start=balance`
      : null,
  };
}
function assetUrl(origin: string, path: string) {
  return new URL(path, origin).href;
}
function safeAvatar(origin: string, avatar: string) {
  try {
    const url = new URL(avatar, origin);
    return avatar &&
      (url.origin === origin || url.protocol === 'https:') &&
      !url.username &&
      !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}
export async function noctGiftsAccount(
  body: Record<string, unknown>,
  origin: string,
) {
  const before = body.before ?? '';
  if (typeof before !== 'string' || before.length > 220)
    throw new ApiError(400, 'Некорректный курсор');
  const auth = await noctGiftsIdentity(body.initData);
  const shared = {
    authExpiresAt: auth.authExpiresAt,
    links: links(origin),
    capabilities: { sharedAccount: true, caseOpening: true, upgrading: true },
    games: noctGiftsGameCatalog(origin),
  };
  if (!auth.user) return { status: 'unlinked' as const, ...shared };
  const me = auth.user;
  const [wallet, page, history] = await Promise.all([
    balance(me.id),
    listGifts(me.id, me.id, before),
    db()
      .prepare(
        `SELECT id,kind,CASE WHEN recipient=? THEN amount ELSE -amount END AS amount,created FROM star_transfers WHERE recipient=? OR sender=? ORDER BY created DESC,id DESC LIMIT 25`,
      )
      .bind(me.id, me.id, me.id)
      .all<{ id: string; kind: string; amount: number; created: number }>(),
  ]);
  // Re-check the live link after reads: unlinking must not leave a bearer session.
  if (
    (await noctGiftsLinkedUser(auth.telegramId, auth.authenticatedAt))
      ?.linkId !== me.linkId
  )
    throw new ApiError(
      401,
      'Привязка Telegram изменилась. Обновите аккаунт.',
      'TELEGRAM_LINK_CHANGED',
    );
  const catalog = paymentCatalog();
  return {
    status: 'linked' as const,
    ...shared,
    user: {
      id: me.id,
      name: me.name,
      handle: me.handle,
      avatar: safeAvatar(origin, me.avatar),
    },
    balance: wallet,
    gifts: page.gifts.map((gift) => {
      const definition = giftDefinition(gift.giftId);
      const collectible = gift.collectible ?? null;
      const art =
        collectible?.model.asset &&
        /^collectible-[a-z_]+-[a-f0-9]{12}$/.test(collectible.model.asset)
          ? collectible.model.asset
          : gift.giftId;
      const known = !!definition && /^[a-z0-9_]+$/.test(gift.giftId);
      return {
        id: gift.id,
        giftId: gift.giftId,
        name: definition?.name || 'Подарок',
        imageUrl: known ? assetUrl(origin, `/assets/gifts/${art}.webp`) : null,
        animationUrl: known
          ? assetUrl(
              origin,
              `/assets/gifts/${art}${art.startsWith('collectible-') ? '.tgs' : '.json'}`,
            )
          : null,
        price: definition?.price ?? null,
        color: definition?.color || '#C7ACE8',
        hidden: !!gift.hidden,
        created: gift.created,
        collectible,
      };
    }),
    next: page.next,
    history: history.results,
    catalog: {
      telegram:
        catalog.telegram && setting('NOCT_GIFTS_PAYMENTS_DISABLED') !== '1',
      products: catalog.products.filter(
        (product) => product.product === 'stars',
      ),
    },
  };
}
export async function noctGiftsTopup(body: Record<string, unknown>) {
  // A preview database must never create orders for the production payment bot.
  if (setting('NOCT_GIFTS_PAYMENTS_DISABLED') === '1')
    throw new ApiError(
      503,
      'Пополнение в этом превью отключено. Используйте основной NoctGram.',
      'NOCT_GIFTS_PAYMENTS_DISABLED',
    );
  const auth = await noctGiftsIdentity(body.initData);
  if (!auth.user)
    throw new ApiError(
      409,
      'Сначала привяжите Telegram к NoctGram.',
      'TELEGRAM_NOT_LINKED',
    );
  if (
    !paymentCatalog().products.some(
      (product) => product.id === body.sku && product.product === 'stars',
    )
  )
    throw new ApiError(400, 'Выберите пакет Noct Stars');
  await rateLimit('payment-create', auth.user.id, 12, 3600);
  const order = await createPayment(auth.user.id, {
    sku: body.sku,
    key: body.key,
    acceptedTerms: body.acceptedTerms,
    provider: 'telegram',
  });
  if (
    order.telegramId !== auth.telegramId ||
    order.linkId !== auth.user.linkId ||
    (await noctGiftsLinkedUser(auth.telegramId, auth.authenticatedAt))
      ?.linkId !== auth.user.linkId
  )
    throw new ApiError(
      409,
      'Привязка Telegram изменилась. Создайте новый счёт.',
      'TELEGRAM_LINK_CHANGED',
    );
  return checkout(order);
}
