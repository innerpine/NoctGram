import { db } from './storage';
import { ApiError } from './api-error';
import { visibleAccount } from './account-access';
import { messageAllowed } from './privacy';
import { balance, ensureWallet } from './star-wallet';
import { availableGiftDefinition, type ReceivedGift } from './gift-catalog';
import { rateLimit, socialRateLimit } from './rate-limit';
import { collectibleFromRow } from './gift-collectibles';

const treasury = 'noctgram_gifts';
function text(input: unknown, max: number, required = true) {
  if (
    typeof input !== 'string' ||
    input.length > max ||
    (required && !input.trim())
  )
    throw new ApiError(400, 'Проверь данные подарка');
  return input.trim();
}
export async function sendGift(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  const gift = availableGiftDefinition(body.giftId);
  if (!gift) throw new ApiError(400, 'Этот подарок недоступен');
  const recipient = text(body.recipient, 100),
    key = text(body.key, 80);
  const message = text(body.message ?? '', 240, false);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key))
    throw new ApiError(400, 'Некорректный запрос');
  const id = `gift:${me}:${key}`;
  const payload = JSON.stringify({ recipient, giftId: gift.id, message });
  const existing = await db()
    .prepare('SELECT postText FROM star_transfers WHERE id=?')
    .bind(id)
    .first<{ postText: string }>();
  if (existing && existing.postText !== payload)
    throw new ApiError(
      409,
      'Этот запрос уже использован. Выбери подарок заново.',
    );
  // Person gifts create a private message; channel gifts belong to the channel.
  // The recipient kind and permissions are checked again in the debit statement.
  // Both consume the mutation budget; committed retries create no new work.
  if (!existing) {
    await socialRateLimit(me, recipient === me ? 'unclassified' : 'message');
    await rateLimit('gifts', me, 10, 60);
    await rateLimit('gift-recipient', JSON.stringify([me, recipient]), 5, 60);
  }
  await ensureWallet(me);
  await db().batch([
    db()
      .prepare(`INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created)
      SELECT ?,s.id,?,?,?,'gift',? FROM users s,users r
      WHERE s.id=? AND r.id=? AND s.kind='person' AND r.kind IN ('person','channel')
        AND ${visibleAccount('s')} AND ${visibleAccount('r')}
        AND (s.id=r.id OR (r.kind='person' AND (${messageAllowed})) OR (r.kind='channel'
          AND EXISTS(SELECT 1 FROM users owner WHERE owner.id=r.ownerId AND owner.kind='person' AND ${visibleAccount('owner')})
          AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker=s.id AND blocked IN(r.id,r.ownerId)) OR(blocker IN(r.id,r.ownerId) AND blocked=s.id))
          AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId IN(r.id,r.ownerId) AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))))
        AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=s.id AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))
        AND ? <= (SELECT COALESCE(SUM(CASE WHEN recipient=s.id THEN amount ELSE -amount END),0) FROM star_transfers WHERE recipient=s.id OR sender=s.id)
      ON CONFLICT(id) DO NOTHING`)
      .bind(id, treasury, payload, gift.price, now, me, recipient, gift.price),
    db()
      .prepare(`INSERT INTO received_gifts(id,transferId,giftId,sender,recipient,message,created)
      SELECT id,id,?,?,?, ?,created FROM star_transfers WHERE id=? AND sender=? AND kind='gift' AND postText=?
      ON CONFLICT(id) DO NOTHING`)
      .bind(gift.id, me, recipient, message, id, me, payload),
    db()
      .prepare(`INSERT INTO messages(id,sender,recipient,text,created,giftReceiptId)
      SELECT 'gift-message:' || id,sender,recipient,?,created,id FROM received_gifts WHERE id=? AND sender<>recipient
        AND EXISTS(SELECT 1 FROM users r WHERE r.id=received_gifts.recipient AND r.kind='person')
      ON CONFLICT(giftReceiptId) DO NOTHING`)
      .bind(`🎁 Подарок «${gift.name}»${message ? '\n' + message : ''}`, id),
    db()
      .prepare(`INSERT OR IGNORE INTO notifications(id,userId,actorId,kind,targetId,created)
      SELECT g.id,CASE WHEN r.kind='channel' THEN r.ownerId ELSE r.id END,g.sender,'gift',g.id,g.created
      FROM received_gifts g JOIN users r ON r.id=g.recipient WHERE g.id=?
        AND g.sender<>CASE WHEN r.kind='channel' THEN r.ownerId ELSE r.id END`)
      .bind(id),
  ]);
  const receipt = await db()
    .prepare(
      'SELECT giftId,recipient,message FROM received_gifts WHERE id=? AND sender=?',
    )
    .bind(id, me)
    .first<{ giftId: string; recipient: string; message: string }>();
  if (
    receipt &&
    (receipt.giftId !== gift.id ||
      receipt.recipient !== recipient ||
      receipt.message !== message)
  )
    throw new ApiError(
      409,
      'Этот запрос уже использован. Выбери подарок заново.',
    );
  const remaining = await balance(me);
  if (!receipt) {
    if (remaining < gift.price)
      throw new ApiError(409, 'Не хватает Noct Stars');
    throw new ApiError(
      403,
      'Подарок недоступен из-за настроек приватности или ограничений аккаунта',
    );
  }
  return { id, balance: remaining };
}
export async function listGifts(
  me: string,
  recipient: string,
  before = '',
  onlyId = '',
) {
  const profile = await db()
    .prepare(`SELECT u.id,(u.id=? OR (u.kind='channel' AND (u.ownerId=?
      OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channelId=u.id AND cm.userId=? AND cm.role='admin')))) AS canManage
    FROM users u WHERE u.id=? AND u.kind IN ('person','channel') AND ${visibleAccount('u')}
      AND (u.kind='person' OR EXISTS(SELECT 1 FROM users owner WHERE owner.id=u.ownerId AND owner.kind='person' AND ${visibleAccount('owner')}))
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker=? AND blocked IN(u.id,u.ownerId)) OR(blocker IN(u.id,u.ownerId) AND blocked=?))`)
    .bind(me, me, me, recipient, me, me)
    .first<{ id: string; canManage: number }>();
  if (!profile) throw new ApiError(404, 'Профиль недоступен');
  const canManage = !!profile.canManage;
  const rows = await db()
    .prepare(`SELECT g.*,u.name AS senderName,u.avatar AS senderAvatar,COALESCE(h.handle,'') AS senderHandle,
    (${visibleAccount('u')} AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker IN (?,g.recipient) AND blocked=u.id) OR(blocker=u.id AND blocked IN (?,g.recipient)))) AS senderVisible,
    c.family AS collectibleFamily,c.number AS collectibleNumber,c.attributes AS collectibleAttributes,
    c.keepOriginal AS collectibleKeepOriginal,c.created AS collectibleCreated
    FROM received_gifts g JOIN users u ON u.id=g.sender LEFT JOIN handles h ON h.userId=u.id AND h.main=1
    LEFT JOIN gift_upgrades c ON c.receiptId=g.id
    WHERE g.recipient=? AND (g.hidden=0 OR ?=1)
      AND NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=g.id)
      AND NOT EXISTS(SELECT 1 FROM gift_consumptions WHERE receiptId=g.id)
      AND (c.receiptId IS NOT NULL OR (${visibleAccount('u')} AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker IN (?,g.recipient) AND blocked=u.id) OR(blocker=u.id AND blocked IN (?,g.recipient)))))
      AND (?='' OR g.id=? OR ('collectible:'||c.family||':'||c.number)=?)
      AND (?='' OR (g.created,g.id)<(SELECT bg.created,bg.id FROM received_gifts bg LEFT JOIN gift_upgrades bc ON bc.receiptId=bg.id WHERE (bg.id=? OR ('collectible:'||bc.family||':'||bc.number)=?) AND bg.recipient=?))
    ORDER BY g.created DESC,g.id DESC LIMIT 25`)
    .bind(
      me,
      me,
      recipient,
      Number(canManage),
      me,
      me,
      onlyId,
      onlyId,
      onlyId,
      before,
      before,
      before,
      recipient,
    )
    .all<
      ReceivedGift & {
        transferId: string;
        senderVisible: number;
        collectibleFamily: string | null;
        collectibleNumber: number;
        collectibleAttributes: string | null;
        collectibleKeepOriginal: number;
        collectibleCreated: number;
      }
    >();
  const publicId = (row: (typeof rows.results)[number]) =>
    !canManage && row.collectibleFamily
      ? `collectible:${row.collectibleFamily}:${row.collectibleNumber}`
      : row.id;
  return {
    gifts: rows.results.slice(0, 24).map((row) => {
      const {
        collectibleFamily,
        collectibleNumber,
        collectibleAttributes,
        collectibleKeepOriginal,
        collectibleCreated,
        senderVisible,
        transferId,
        ...stored
      } = row;
      const gift = {
        ...stored,
        id: publicId(row),
        ...(recipient === me ? { transferId } : {}),
      };
      const collectible =
        collectibleFamily && collectibleAttributes
          ? collectibleFromRow({
              family: collectibleFamily,
              number: collectibleNumber,
              attributes: collectibleAttributes,
              keepOriginal: collectibleKeepOriginal,
              created: collectibleCreated,
            })
          : null;
      // Original details remain in the private purchase receipt, but must not be
      // exposed through a public collectible when the owner did not keep them.
      if (
        collectible &&
        (!senderVisible || (!collectible.keepOriginal && recipient !== me))
      )
        return {
          ...gift,
          collectible,
          sender: '',
          senderName: '',
          senderAvatar: '',
          senderHandle: '',
          message: '',
          created: collectible.upgradedAt,
        };
      return { ...gift, collectible };
    }),
    next: rows.results.length > 24 ? publicId(rows.results[23]) : null,
  };
}
export async function giftVisibility(
  me: string,
  body: Record<string, unknown>,
) {
  const id = text(body.id, 220);
  if (typeof body.hidden !== 'boolean')
    throw new ApiError(400, 'Укажи видимость подарка');
  const result = await db()
    .prepare(
      `UPDATE received_gifts SET hidden=? WHERE id=?
        AND NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=received_gifts.id)
        AND NOT EXISTS(SELECT 1 FROM gift_consumptions WHERE receiptId=received_gifts.id)
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=received_gifts.recipient AND ${visibleAccount('u')}
          AND (u.id=? OR (u.kind='channel' AND (u.ownerId=? OR EXISTS(
            SELECT 1 FROM channel_members cm WHERE cm.channelId=u.id AND cm.userId=? AND cm.role='admin'))
            AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=? AND actor.kind='person' AND ${visibleAccount('actor')})
            AND EXISTS(SELECT 1 FROM users owner WHERE owner.id=u.ownerId AND owner.kind='person' AND ${visibleAccount('owner')})
            AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId IN(u.id,u.ownerId,?)
              AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000)))))`,
    )
    .bind(Number(body.hidden), id, me, me, me, me, me)
    .run();
  if (!result.meta.changes) throw new ApiError(404, 'Подарок не найден');
  return { ok: true };
}
