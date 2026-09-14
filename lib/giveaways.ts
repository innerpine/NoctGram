import { db } from './storage';
import { assertUnqueuedPublicWrite } from './antispam';
import { ApiError } from './api-error';
import { balance, ensureWallet } from './star-wallet';
import { rateLimit, socialRateLimit } from './rate-limit';
import { entitlementExpiry } from './premium-predicate';
import {
  GIVEAWAY_PREMIUM_COST,
  GIVEAWAY_PREMIUM_DAYS,
  type Giveaway,
} from './giveaways-types';

const treasury = 'noctgram_giveaways';
const clock = "(strftime('%s','now')*1000)";
const readable = (
  u: string,
) => `${u}.kind='person' AND ${u}.deletedAt=0 AND ${u}.onboardingComplete=1
  AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=${u}.id AND ar.mode='blocked' AND (ar.expiresAt IS NULL OR ar.expiresAt>${clock}))`;
const writable = (u: string) =>
  `${readable(u)} AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=${u}.id AND (ar.expiresAt IS NULL OR ar.expiresAt>${clock}))`;
const unblocked = (a: string, b: string) =>
  `NOT EXISTS(SELECT 1 FROM user_blocks ub WHERE (ub.blocker=${a} AND ub.blocked=${b}) OR (ub.blocker=${b} AND ub.blocked=${a}))`;
const channelVisible = (
  c: string,
) => `${c}.kind='channel' AND ${c}.deletedAt=0 AND ${c}.onboardingComplete=1
  AND EXISTS(SELECT 1 FROM users own WHERE own.id=${c}.ownerId AND ${readable('own')})
  AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=${c}.id AND ar.mode='blocked' AND (ar.expiresAt IS NULL OR ar.expiresAt>${clock}))`;
const groupVisible = (r: string) =>
  `${r}.kind='group' AND ${r}.deletedAt=0 AND EXISTS(SELECT 1 FROM users own WHERE own.id=${r}.ownerId AND ${readable('own')})`;

// The same predicates are used at preflight and inside the debit transaction.
function mayCreate(kind: string, target: string, actor: string) {
  const person = `EXISTS(SELECT 1 FROM users actor WHERE actor.id=${actor} AND ${writable('actor')})`;
  return kind === 'group'
    ? `${person} AND EXISTS(SELECT 1 FROM chat_rooms r JOIN chat_room_members m ON m.roomId=r.id WHERE r.id=${target} AND ${groupVisible('r')} AND m.userId=${actor} AND m.status='active' AND ${unblocked(actor, 'r.ownerId')})`
    : `${person} AND EXISTS(SELECT 1 FROM users c WHERE c.id=${target} AND ${channelVisible('c')}
      AND c.ownerId=${actor}
      AND ${unblocked(actor, 'c.id')} AND ${unblocked(actor, 'c.ownerId')}
      AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId IN(c.id,c.ownerId) AND (ar.expiresAt IS NULL OR ar.expiresAt>${clock})))`;
}
function mayRead(kind: string, target: string, actor: string) {
  return (
    `EXISTS(SELECT 1 FROM users viewu WHERE viewu.id=${actor} AND ${readable('viewu')}) AND ` +
    (kind === 'group'
      ? `EXISTS(SELECT 1 FROM chat_rooms r JOIN chat_room_members m ON m.roomId=r.id WHERE r.id=${target} AND ${groupVisible('r')} AND m.userId=${actor} AND m.status='active' AND ${unblocked(actor, 'r.ownerId')})`
      : `EXISTS(SELECT 1 FROM users c WHERE c.id=${target} AND ${channelVisible('c')} AND ${unblocked(actor, 'c.id')} AND ${unblocked(actor, 'c.ownerId')})`)
  );
}
// g is the giveaway, u is a possible participant. Alias strings are internal.
function eligible(g = 'g', u = 'u') {
  return `${readable(u)} AND ${u}.id<>${g}.creator AND
    ((${g}.targetKind='group' AND EXISTS(SELECT 1 FROM chat_room_members em JOIN chat_rooms er ON er.id=em.roomId WHERE er.id=${g}.targetId AND ${groupVisible('er')} AND em.userId=${u}.id AND em.status='active' AND ${unblocked(`${u}.id`, 'er.ownerId')}))
    OR (${g}.targetKind='channel' AND EXISTS(SELECT 1 FROM follows ef JOIN users ec ON ec.id=ef.following WHERE ec.id=${g}.targetId AND ${channelVisible('ec')} AND ef.follower=${u}.id AND ${unblocked(`${u}.id`, 'ec.id')} AND ${unblocked(`${u}.id`, 'ec.ownerId')})))`;
}
type StoredGiveaway = Omit<Giveaway, 'winners' | 'participating'> & {
  payload: string;
  drawToken: string;
};
function rejected(status: number, message: string) {
  return new ApiError(status, message, 'GIVEAWAY_REJECTED');
}
// Payment acknowledgement is the creator's own receipt, not a fresh read of
// the group's membership. Revoking access after COMMIT must never turn a paid
// request into an apparent failure. Private winners are read only by GET.
function creationReceipt(row: StoredGiveaway): Giveaway {
  return {
    id: row.id,
    targetKind: row.targetKind,
    targetId: row.targetId,
    creator: row.creator,
    prize: row.prize,
    winnerCount: row.winnerCount,
    starsPerWinner: row.starsPerWinner,
    premiumDays: row.premiumDays,
    totalCost: row.totalCost,
    created: row.created,
    endsAt: row.endsAt,
    status: row.status,
    completedAt: row.completedAt,
    participantCount: row.participantCount,
    participating: false,
    winners: [],
    refund: row.refund,
  };
}
function string(value: unknown, max = 100) {
  if (typeof value !== 'string' || !value || value.length > max)
    throw rejected(400, 'Проверь данные розыгрыша');
  return value;
}
function integer(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw rejected(400, 'Проверь количество призов и стоимость');
  return value;
}
async function keyId(me: string, key: string) {
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(['giveaway-v1', me, key])),
    ),
  );
  return (
    'giveaway:' +
    Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
  );
}
export async function createGiveaway(
  me: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  const key = string(body.key, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      key,
    )
  )
    throw rejected(400, 'Некорректный ключ розыгрыша');
  const targetKind = body.targetKind,
    targetId = string(body.targetId),
    prize = body.prize;
  if (
    !['group', 'channel'].includes(String(targetKind)) ||
    !['stars', 'premium'].includes(String(prize))
  )
    throw rejected(400, 'Выбери группу или канал и тип призов');
  const winnerCount = integer(body.winnerCount, 1, 50);
  const starsPerWinner =
    prize === 'stars' ? integer(body.starsPerWinner, 1, 100000) : 0;
  const totalCost =
    winnerCount *
    (prize === 'premium' ? GIVEAWAY_PREMIUM_COST : starsPerWinner);
  if (totalCost > 1000000)
    throw rejected(400, 'Максимальный бюджет розыгрыша — 1 000 000 Noct Stars');
  const endsAt = integer(body.endsAt, 1, Number.MAX_SAFE_INTEGER);
  const id = await keyId(me, key);
  const payload = JSON.stringify({
    targetKind,
    targetId,
    prize,
    winnerCount,
    starsPerWinner,
    endsAt,
  });
  const prior = await db()
    .prepare('SELECT * FROM giveaways WHERE id=? AND creator=?')
    .bind(id, me)
    .first<StoredGiveaway>();
  if (prior) {
    if (prior.payload !== payload)
      throw rejected(
        409,
        'Этот запрос уже использован. Создай новый розыгрыш.',
      );
    return {
      giveaway: creationReceipt(prior),
      balance: await balance(me),
    };
  }
  if (endsAt < now + 5 * 60000 || endsAt > now + 30 * 86400000)
    throw rejected(
      400,
      'Завершение — от 5 минут до 30 дней от текущего времени',
    );
  const kind = targetKind as 'group' | 'channel';
  if (
    !(await db()
      .prepare(`SELECT 1 WHERE ${mayCreate(kind, '?1', '?2')}`)
      .bind(targetId, me)
      .first())
  )
    throw rejected(
      403,
      kind === 'group'
        ? 'Для создания розыгрыша нужно быть участником группы без ограничений на отправку'
        : 'Создать розыгрыш в канале может только его владелец',
    );
  await socialRateLimit(me, kind === 'channel' ? 'post' : 'message');
  await rateLimit('giveaways', me, 5, 3600);
  await assertUnqueuedPublicWrite(me, '', targetId);
  await ensureWallet(me);
  const gate = `${mayCreate(kind, '?1', '?2')}
    AND NOT EXISTS(SELECT 1 FROM giveaways WHERE id=?3)
    AND (SELECT COUNT(*) FROM giveaways WHERE creator=?2 AND status='active')<10
    AND ?4<=(SELECT COALESCE(SUM(CASE WHEN recipient=?2 THEN amount ELSE -amount END),0) FROM star_transfers WHERE recipient=?2 OR sender=?2)`;
  const title =
    prize === 'premium'
      ? `Розыгрыш: ${winnerCount} × Noct Premium на 30 дней`
      : `Розыгрыш: ${winnerCount} × ${starsPerWinner} Noct Stars`;
  // Insert/debit/publication are one transaction. A retry cannot debit twice,
  // and a failure at any stage leaves neither a paid-but-missing card nor debt.
  await db().batch([
    db()
      .prepare(`INSERT INTO giveaways(id,creator,targetKind,targetId,prize,winnerCount,starsPerWinner,premiumDays,totalCost,payload,created,endsAt)
      SELECT ?3,?2,?5,?1,?6,?7,?8,30,?4,?9,?10,?11 WHERE ${gate}`)
      .bind(
        targetId,
        me,
        id,
        totalCost,
        kind,
        prize,
        winnerCount,
        starsPerWinner,
        payload,
        now,
        endsAt,
      ),
    db()
      .prepare(`INSERT INTO star_transfers(id,sender,recipient,amount,kind,postText,created)
      SELECT 'giveaway-debit:'||id,creator,?,totalCost,'giveaway_debit',payload,created FROM giveaways WHERE id=? AND creator=? AND payload=?
      ON CONFLICT(id) DO NOTHING`)
      .bind(treasury, id, me, payload),
    db()
      .prepare(`INSERT INTO posts(id,userId,publisherId,text,created,publishAt,notifyPending,giveawayId)
      SELECT 'giveaway-post:'||id,targetId,creator,?,created,created,1,id FROM giveaways WHERE id=? AND targetKind='channel'
      ON CONFLICT(giveawayId) DO NOTHING`)
      .bind(title, id),
    db()
      .prepare(`INSERT INTO chat_room_messages(id,roomId,sender,text,created,giveawayId)
      SELECT 'giveaway-message:'||id,targetId,creator,?,created,id FROM giveaways WHERE id=? AND targetKind='group'
      ON CONFLICT(giveawayId) DO NOTHING`)
      .bind(title, id),
    db()
      .prepare(
        `UPDATE chat_rooms SET updatedAt=MAX(updatedAt,?) WHERE id=(SELECT targetId FROM giveaways WHERE id=? AND creator=? AND payload=? AND targetKind='group')`,
      )
      .bind(now, id, me, payload),
  ]);
  const saved = await db()
    .prepare('SELECT * FROM giveaways WHERE id=? AND creator=?')
    .bind(id, me)
    .first<StoredGiveaway>();
  if (!saved) {
    if ((await balance(me)) < totalCost)
      throw rejected(409, 'Не хватает Noct Stars');
    throw rejected(
      409,
      'Не удалось создать розыгрыш: проверь права и количество активных розыгрышей',
    );
  }
  if (saved.payload !== payload)
    throw rejected(409, 'Этот запрос уже использован.');
  return {
    giveaway: creationReceipt(saved),
    balance: await balance(me),
  };
}

function randomBelow(exclusive: number) {
  // Rejection sampling removes modulo bias; never use Math.random/SQLite random.
  const ceiling = 4294967296 - (4294967296 % exclusive);
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while (value[0] >= ceiling);
  return value[0] % exclusive;
}
function winningIndices(population: number, amount: number) {
  const picked = new Set<number>();
  // Floyd's sample has O(prize count) memory even for the shared community.
  for (let i = population - amount; i < population; i++) {
    const pick = randomBelow(i + 1);
    picked.add(picked.has(pick) ? i : pick);
  }
  return Array.from(picked).sort((a, b) => a - b);
}
export async function settleGiveaway(id: string, now = Date.now()) {
  const stored = await db()
    .prepare(
      "SELECT id FROM giveaways WHERE id=? AND status='active' AND endsAt<=?",
    )
    .bind(id, now)
    .first();
  if (!stored) return false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await db()
      .prepare(
        `SELECT g.winnerCount,(SELECT COUNT(*) FROM users u WHERE ${eligible()}) AS count FROM giveaways g WHERE g.id=? AND g.status='active' AND g.endsAt<=?`,
      )
      .bind(id, now)
      .first<{ winnerCount: number; count: number }>();
    if (!state) return false;
    if (
      !Number.isSafeInteger(state.count) ||
      state.count < 0 ||
      state.count > 4294967295
    )
      throw new Error(
        'Giveaway population is outside the secure sampler range',
      );
    const selected = winningIndices(
      state.count,
      Math.min(state.winnerCount, state.count),
    );
    const token = crypto.randomUUID();
    const gate = "g.id=?1 AND g.status='settling' AND g.drawToken=?2";
    const result = await db().batch([
      // COUNT and all eligibility checks run again under the transaction lock.
      // If membership changed, no statement can pay until a fresh uniform draw.
      db()
        .prepare(`UPDATE giveaways AS g SET status='settling',drawToken=?2,participantCount=?3
        WHERE g.id=?1 AND g.status='active' AND g.endsAt<=?4 AND (SELECT COUNT(*) FROM users u WHERE ${eligible()})=?3`)
        .bind(id, token, state.count, now),
      db()
        .prepare(`WITH eligible AS (SELECT u.id,ROW_NUMBER() OVER(ORDER BY u.id)-1 AS position FROM users u JOIN giveaways g ON g.id=?1 WHERE ${gate} AND ${eligible()})
        INSERT INTO giveaway_winners(giveawayId,userId,position,created)
        SELECT ?1,e.id,e.position,?3 FROM eligible e JOIN json_each(?4) chosen ON chosen.value=e.position`)
        .bind(id, token, now, JSON.stringify(selected)),
      db()
        .prepare(`INSERT INTO star_transfers(id,sender,recipient,amount,kind,created)
        SELECT 'giveaway-prize:'||g.id||':'||w.userId,?3,w.userId,g.starsPerWinner,'giveaway_prize',?4 FROM giveaways g JOIN giveaway_winners w ON w.giveawayId=g.id WHERE ${gate} AND g.prize='stars'`)
        .bind(id, token, treasury, now),
      db()
        .prepare(`INSERT INTO premium_entitlements(userId,startsAt,expiresAt,revokedAt,source,created)
        SELECT w.userId,?3,MAX(?3,${entitlementExpiry('w.userId')})+?4,0,'giveaway',?3
        FROM giveaways g JOIN giveaway_winners w ON w.giveawayId=g.id WHERE ${gate} AND g.prize='premium'
        ON CONFLICT(userId) DO UPDATE SET startsAt=MIN(premium_entitlements.startsAt,excluded.startsAt),expiresAt=excluded.expiresAt,revokedAt=0,source='giveaway'`)
        .bind(id, token, now, GIVEAWAY_PREMIUM_DAYS * 86400000),
      db()
        .prepare(`INSERT INTO star_transfers(id,sender,recipient,amount,kind,created)
        SELECT 'giveaway-refund:'||g.id,?3,g.creator,g.totalCost-(SELECT COUNT(*) FROM giveaway_winners w WHERE w.giveawayId=g.id)*(CASE WHEN g.prize='premium' THEN ${GIVEAWAY_PREMIUM_COST} ELSE g.starsPerWinner END),'giveaway_refund',?4
        FROM giveaways g WHERE ${gate} AND (SELECT COUNT(*) FROM giveaway_winners w WHERE w.giveawayId=g.id)<g.winnerCount`)
        .bind(id, token, treasury, now),
      db()
        .prepare(
          `UPDATE giveaways AS g SET status='completed',completedAt=?3,drawToken='',refund=COALESCE((SELECT amount FROM star_transfers WHERE id='giveaway-refund:'||g.id),0) WHERE ${gate}`,
        )
        .bind(id, token, now),
    ]);
    if (result[0].meta.changes) return true;
  }
  // High membership churn can defer the draw. It remains active and funded;
  // the next read/job retries instead of storing a partial result or losing money.
  return false;
}

export async function getGiveaway(
  me: string,
  input: string,
  now = Date.now(),
): Promise<Giveaway> {
  const id = string(input, 80);
  let row = await db()
    .prepare('SELECT * FROM giveaways WHERE id=?')
    .bind(id)
    .first<StoredGiveaway>();
  if (
    !row ||
    !(await db()
      .prepare(`SELECT 1 WHERE ${mayRead(row.targetKind, '?1', '?2')}`)
      .bind(row.targetId, me)
      .first())
  )
    throw new ApiError(404, 'Розыгрыш недоступен');
  if (row.status === 'active' && row.endsAt <= now) {
    await settleGiveaway(id, now);
    row = (await db()
      .prepare('SELECT * FROM giveaways WHERE id=?')
      .bind(id)
      .first<StoredGiveaway>())!;
  }
  const participants = await db()
    .prepare(
      `SELECT COUNT(*) AS count,COALESCE(MAX(u.id=?2),0) AS participating FROM users u JOIN giveaways g ON g.id=?1 WHERE ${eligible()}`,
    )
    .bind(id, me)
    .first<{ count: number; participating: number }>();
  const winnerVisible = `${readable('u')} AND ${unblocked('u.id', '?2')}`;
  const winners =
    row.status === 'completed'
      ? (
          await db()
            .prepare(`SELECT u.id,CASE WHEN ${winnerVisible} THEN u.name ELSE 'Пользователь' END AS name,
    CASE WHEN ${winnerVisible} THEN u.avatar ELSE '' END AS avatar,
    CASE WHEN ${winnerVisible} THEN COALESCE((SELECT handle FROM handles WHERE userId=u.id AND main=1),'') ELSE '' END AS handle
    FROM giveaway_winners w JOIN users u ON u.id=w.userId WHERE w.giveawayId=?1 ORDER BY w.position`)
            .bind(id, me)
            .all<Giveaway['winners'][number]>()
        ).results
      : [];
  return {
    id: row.id,
    targetKind: row.targetKind,
    targetId: row.targetId,
    creator: row.creator,
    prize: row.prize,
    winnerCount: row.winnerCount,
    starsPerWinner: row.starsPerWinner,
    premiumDays: row.premiumDays,
    totalCost: row.totalCost,
    created: row.created,
    endsAt: row.endsAt,
    status: row.status,
    completedAt: row.completedAt,
    participantCount:
      row.status === 'completed'
        ? row.participantCount
        : participants?.count || 0,
    participating: row.status === 'active' && !!participants?.participating,
    winners,
    refund: row.refund,
  };
}
export async function settleDueGiveaways(now = Date.now(), limit = 10) {
  const due = await db()
    .prepare(
      "SELECT id FROM giveaways WHERE status='active' AND endsAt<=? ORDER BY endsAt,id LIMIT ?",
    )
    .bind(now, Math.max(1, Math.min(20, limit)))
    .all<{ id: string }>();
  let completed = 0,
    failed = 0;
  for (const item of due.results) {
    try {
      if (await settleGiveaway(item.id, now)) completed++;
    } catch {
      failed++;
    }
  }
  return { completed, failed };
}
