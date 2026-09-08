import { db } from './storage';
import { ApiError } from './api-error';
import { visibleAccount } from './account-access';
import { messageAllowed } from './privacy';
import { balance, ensureWallet } from './star-wallet';
import { availableGiftDefinition, type ReceivedGift } from './gift-catalog';

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
  if (recipient === me)
    throw new ApiError(400, 'Выбери друга, которому хочешь сделать подарок');
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
  await ensureWallet(me);
  await db().batch([
    db()
      .prepare(`INSERT INTO star_transfers(id,sender,recipient,postText,amount,kind,created)
      SELECT ?,s.id,?,?,?,'gift',? FROM users s,users r
      WHERE s.id=? AND r.id=? AND s.id<>r.id AND s.kind='person' AND r.kind='person'
        AND ${visibleAccount('s')} AND ${visibleAccount('r')} AND ${messageAllowed}
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
      SELECT 'gift-message:' || id,sender,recipient,?,created,id FROM received_gifts WHERE id=?
      ON CONFLICT(giftReceiptId) DO NOTHING`)
      .bind(`🎁 Подарок «${gift.name}»${message ? '\n' + message : ''}`, id),
    db()
      .prepare(`INSERT OR IGNORE INTO notifications(id,userId,actorId,kind,targetId,created)
      SELECT id,recipient,sender,'gift',id,created FROM received_gifts WHERE id=?`)
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
  const person = await db()
    .prepare(`SELECT u.id FROM users u WHERE u.id=? AND u.kind='person' AND ${visibleAccount('u')}
    AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker=? AND blocked=u.id) OR(blocker=u.id AND blocked=?))`)
    .bind(recipient, me, me)
    .first();
  if (!person) throw new ApiError(404, 'Профиль недоступен');
  const rows = await db()
    .prepare(`SELECT g.*,u.name AS senderName,u.avatar AS senderAvatar,COALESCE(h.handle,'') AS senderHandle
    FROM received_gifts g JOIN users u ON u.id=g.sender LEFT JOIN handles h ON h.userId=u.id AND h.main=1
    WHERE g.recipient=? AND (g.hidden=0 OR g.recipient=?) AND ${visibleAccount('u')}
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker IN (?,g.recipient) AND blocked=u.id) OR(blocker=u.id AND blocked IN (?,g.recipient)))
      AND (?='' OR g.id=?) AND (?='' OR (g.created,g.id)<(SELECT created,id FROM received_gifts WHERE id=? AND recipient=?))
    ORDER BY g.created DESC,g.id DESC LIMIT 25`)
    .bind(recipient, me, me, me, onlyId, onlyId, before, before, recipient)
    .all<ReceivedGift>();
  return {
    gifts: rows.results.slice(0, 24),
    next: rows.results.length > 24 ? rows.results[23].id : null,
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
    .prepare('UPDATE received_gifts SET hidden=? WHERE id=? AND recipient=?')
    .bind(Number(body.hidden), id, me)
    .run();
  if (!result.meta.changes) throw new ApiError(404, 'Подарок не найден');
  return { ok: true };
}
