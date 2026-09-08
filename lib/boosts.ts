import { db, clean, ApiError, profile } from './server';
import {
  assertReadable,
  assertWritable,
  assertAccountVisible,
  visibleAccount,
} from './account-access';
import { assertCanInteract, personalVisibility } from './privacy';
import { channelRights, sqlNow } from './channel-access';
import {
  premiumActive,
  appearanceColumns,
  appearanceFrom,
} from './premium-access';
import {
  boostChannelActive,
  boostPersonActive,
  activeBoosts,
  channelCanAct,
} from './boost-access';
import { boostRules, boostLevel } from './boost-rules';

async function status(id: string, me: string) {
  await assertReadable(me);
  await assertAccountVisible(id);
  await assertCanInteract(me, id);
  const channel = await db()
    .prepare(
      `SELECT id,CASE WHEN ${boostChannelActive('u')} THEN ${activeBoosts('u.id')} ELSE 0 END AS count FROM users u WHERE u.id=? AND u.kind='channel' AND ${visibleAccount('u')}`,
    )
    .bind(id)
    .first<{ id: string; count: number }>();
  if (!channel) throw new ApiError(404, 'Канал не найден');
  const level = boostLevel(channel.count);
  const entitlement = await db()
    .prepare(
      `SELECT pe.expiresAt FROM premium_entitlements pe JOIN users u ON u.id=pe.userId WHERE pe.userId=? AND ${premiumActive('u.id')} AND ${boostPersonActive('u')}`,
    )
    .bind(me)
    .first<{ expiresAt: number }>();
  const rows = await db()
    .prepare(`SELECT bs.slot,bs.channelId,bs.availableAt,c.id,c.name,c.avatar,h.handle FROM channel_boost_slots bs
    LEFT JOIN users c ON c.id=bs.channelId AND ${visibleAccount('c')} AND ${personalVisibility('c')}
    LEFT JOIN handles h ON h.userId=c.id AND h.main=1 WHERE bs.userId=? ORDER BY bs.slot`)
    .bind(me, me)
    .all();
  const rights = await channelRights(id, me);
  const boosters = rights.canEditProfile
    ? (
        await db()
          .prepare(`SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle,COUNT(*) AS boosts
    FROM channel_boost_slots bs JOIN users u ON u.id=bs.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1
    WHERE bs.channelId=? AND ${boostPersonActive('u')} AND ${premiumActive('u.id')} AND ${personalVisibility('u')}
    AND EXISTS(SELECT 1 FROM users bc,users ba WHERE bc.id=bs.channelId AND ba.id=? AND ${visibleAccount('ba')} AND ${visibleAccount('bc')} AND ${channelCanAct('bc', 'ba.id', true)})
    GROUP BY u.id ORDER BY MAX(bs.changedAt) DESC,u.id LIMIT 20`)
          .bind(id, me, me)
          .all()
      ).results.map((row) => ({ ...row, ...appearanceFrom(row) }))
    : [];
  return {
    channelId: id,
    count: channel.count,
    level,
    maxLevel: boostRules.maxLevel,
    perLevel: boostRules.perLevel,
    currentThreshold: level * boostRules.perLevel,
    nextThreshold:
      level < boostRules.maxLevel ? (level + 1) * boostRules.perLevel : null,
    premium: !!entitlement,
    premiumExpiresAt: entitlement?.expiresAt ?? null,
    serverTime: Date.now(),
    slots: Array.from({ length: boostRules.slots }, (_, i) => {
      const row = rows.results.find((v) => v.slot === i + 1);
      return {
        slot: i + 1,
        channelId: row?.channelId ?? null,
        availableAt: row?.availableAt ?? 0,
        channel: row?.id
          ? {
              id: row.id,
              name: row.name,
              avatar: row.avatar,
              handle: row.handle,
              kind: 'channel',
            }
          : null,
      };
    }),
    canManage: rights.canEditProfile,
    boosters,
  };
}
export async function boostsGet(
  action: string,
  s: URLSearchParams,
  me: string,
): Promise<Response | null> {
  if (action !== 'boosts') return null;
  return Response.json(await status(clean(s.get('id'), 200, true), me), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
export async function boostsPost(
  action: string,
  b: Record<string, unknown>,
  me: string,
): Promise<Response | null> {
  if (action !== 'boost') return null;
  await assertWritable(me);
  const id = clean(b.id, 200, true),
    slots = b.slots;
  if (
    !Array.isArray(slots) ||
    slots.length < 1 ||
    slots.length > boostRules.slots ||
    new Set(slots).size !== slots.length ||
    slots.some((v) => !Number.isInteger(v) || v < 1 || v > boostRules.slots)
  )
    throw new ApiError(400, 'Выбери от 1 до 4 разных бустов');
  await assertAccountVisible(id);
  await assertCanInteract(me, id);
  const result = await db()
    .prepare(`WITH input AS(SELECT ? AS actor,? AS target,? AS slots)
    INSERT INTO channel_boost_slots(userId,slot,channelId,changedAt,availableAt)
    SELECT u.id,CAST(j.value AS INTEGER),c.id,${sqlNow},${sqlNow}+${boostRules.cooldown}
    FROM input i,users u,users c,json_each(i.slots) j
    WHERE u.id=i.actor AND c.id=i.target AND ${boostPersonActive('u')} AND ${premiumActive('u.id')} AND ${boostChannelActive('c')}
    AND NOT EXISTS(SELECT 1 FROM user_blocks bb WHERE (bb.blocker=u.id AND bb.blocked IN(c.id,c.ownerId)) OR (bb.blocker IN(c.id,c.ownerId) AND bb.blocked=u.id))
    AND NOT EXISTS(SELECT 1 FROM channel_boost_slots old WHERE old.userId=u.id AND old.slot IN(SELECT value FROM json_each(i.slots)) AND old.channelId IS NOT c.id AND old.availableAt>${sqlNow})
    ON CONFLICT(userId,slot) DO UPDATE SET channelId=excluded.channelId,
    changedAt=CASE WHEN channel_boost_slots.channelId IS excluded.channelId THEN channel_boost_slots.changedAt ELSE excluded.changedAt END,
    availableAt=CASE WHEN channel_boost_slots.channelId IS excluded.channelId THEN channel_boost_slots.availableAt ELSE excluded.availableAt END`)
    .bind(me, id, JSON.stringify(slots))
    .run();
  if (!result.meta.changes)
    throw new ApiError(
      409,
      'Нужен действующий Noct Premium, доступный канал и бусты без ожидания переноса. Обнови список бустов.',
    );
  return Response.json({
    ...(await status(id, me)),
    profile: await profile(id, me),
  });
}
