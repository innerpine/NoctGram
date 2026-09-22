import { appearanceColumns } from '@/lib/premium-access';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { cookies } from 'next/headers';
import { db, clean, ApiError } from './server';
import { setting } from './auth-session';
import { assertReadable, visibleAccount } from './account-access';
import { published, sqlNow } from './channel-access';
import { messageVisible } from './chat-access';
import { callAllowed } from './calls';

export function validPushEndpoint(endpoint: string) {
  const u = new URL(endpoint),
    host = u.hostname.toLowerCase();
  const allowed =
    host === 'fcm.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    host.endsWith('.push.apple.com') ||
    host.endsWith('.notify.windows.com');
  if (
    endpoint.length > 2048 ||
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.hash ||
    (u.port && u.port !== '443') ||
    !allowed
  )
    throw new ApiError(400, 'Неподдерживаемый адрес push-сервиса');
  return endpoint;
}
function decode(value: string, length: number) {
  if (!/^[\w-]+$/.test(value)) throw new ApiError(400, 'Неверный push-ключ');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(
      atob(value.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0),
    );
  } catch {
    throw new ApiError(400, 'Неверный push-ключ');
  }
  if (bytes.length !== length) throw new ApiError(400, 'Неверный push-ключ');
  return bytes;
}
function config() {
  const publicKey = setting('NOCT_VAPID_PUBLIC_KEY'),
    privateKey = setting('NOCT_VAPID_PRIVATE_KEY'),
    subject = setting('NOCT_VAPID_SUBJECT');
  return publicKey && privateKey && subject
    ? { publicKey, privateKey, subject }
    : null;
}
async function device(create = false) {
  const c = await cookies();
  let value = c.get('noct_push_device')?.value;
  if (!value && create) {
    value = crypto.randomUUID();
    c.set('noct_push_device', value, {
      httpOnly: true,
      sameSite: 'strict',
      secure: setting('NODE_ENV') === 'production',
      path: '/',
      maxAge: 31536000,
    });
  }
  return value || '';
}
export async function removePushDevice(me?: string) {
  const id = await device();
  if (id)
    await db()
      .prepare(
        'DELETE FROM push_subscriptions WHERE device=?' +
          (me ? ' AND userId=?' : ''),
      )
      .bind(id, ...(me ? [me] : []))
      .run();
}
function notificationVisible() {
  // Likes and comments reach the author, or the owner of the channel that published.
  const ownPost = `(p.userId=n.userId OR EXISTS(SELECT 1 FROM users pc WHERE pc.id=p.userId AND pc.kind='channel' AND pc.ownerId=n.userId))`;
  return `${visibleAccount('u')} AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker=n.userId AND b.blocked IN(u.id,u.ownerId)) OR (b.blocker IN(u.id,u.ownerId) AND b.blocked=n.userId))
    AND ((n.kind='message' AND EXISTS(SELECT 1 FROM messages m WHERE m.id=n.targetId AND m.recipient=n.userId AND ${messageVisible('m', 'n.userId')}))
      OR (n.kind='gift' AND EXISTS(SELECT 1 FROM received_gifts g JOIN users gr ON gr.id=g.recipient
        WHERE g.id=n.targetId AND g.sender=n.actorId AND ${visibleAccount('gr')}
          AND (g.recipient=n.userId OR (gr.kind='channel' AND gr.ownerId=n.userId
            AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker=n.actorId AND b.blocked=gr.id) OR(b.blocker=gr.id AND b.blocked=n.actorId))))
          AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.giftReceiptId=g.id AND NOT (${messageVisible('m', 'n.userId')}))))
      OR n.kind='call' OR (n.kind='post' AND EXISTS(SELECT 1 FROM posts p WHERE p.id=n.targetId AND ${published('p')}
        AND NOT EXISTS(SELECT 1 FROM user_privacy pref WHERE pref.userId=n.userId AND pref.hideAdult=1 AND p.adult=1)))
      OR (n.kind='like' AND EXISTS(SELECT 1 FROM posts p JOIN likes l ON l.postId=p.id WHERE p.id=n.targetId AND l.userId=n.actorId
        AND ${published('p')} AND ${ownPost}))
      OR (n.kind='comment' AND EXISTS(SELECT 1 FROM comments c JOIN posts p ON p.id=c.postId WHERE c.id=n.targetId AND c.userId=n.actorId
        AND ${published('p')} AND ${ownPost}))
      OR (n.kind='follow' AND EXISTS(SELECT 1 FROM follows f WHERE f.follower=n.actorId AND f.following=n.userId))
      OR (n.kind='support' AND EXISTS(SELECT 1 FROM star_transfers t WHERE t.id=n.targetId AND t.kind='support' AND t.sender=n.actorId AND t.recipient=n.userId))
      OR (n.kind='market' AND EXISTS(SELECT 1 FROM market_listings l WHERE l.id=n.targetId AND l.status='sold' AND l.buyerId=n.actorId AND l.sellerId=n.userId)))`;
}
/**
 * Social activity. Likes are one row per post: a new like moves it to the top
 * again with the newest liker, and the others are counted when it is read.
 * Comments, followers, Stars support and market sales are one row each.
 * Every statement re-checks the event it describes, so a lost race inserts nothing.
 */
export function likeNotification(postId: string, me: string, liked: boolean) {
  const d = db();
  if (liked)
    return [
      d
        .prepare(`INSERT INTO notifications(id,userId,actorId,kind,targetId,created,read)
      SELECT 'like:'||p.id,COALESCE(u.ownerId,u.id),?,'like',p.id,?,0 FROM posts p JOIN users u ON u.id=p.userId
      WHERE p.id=? AND COALESCE(u.ownerId,u.id)<>? AND EXISTS(SELECT 1 FROM likes l WHERE l.postId=p.id AND l.userId=?)
      ON CONFLICT(id) DO UPDATE SET actorId=excluded.actorId,created=excluded.created,read=0`)
        .bind(me, Date.now(), postId, me, me),
    ];
  // Withdrawn like: hand the row to another liker, or drop it when nobody is left.
  return [
    d
      .prepare(`UPDATE notifications SET actorId=(SELECT l.userId FROM likes l WHERE l.postId=notifications.targetId AND l.userId<>notifications.userId LIMIT 1)
      WHERE id='like:'||? AND actorId=? AND EXISTS(SELECT 1 FROM likes l WHERE l.postId=notifications.targetId AND l.userId<>notifications.userId)`)
      .bind(postId, me),
    d
      .prepare("DELETE FROM notifications WHERE id='like:'||? AND actorId=?")
      .bind(postId, me),
  ];
}
export function commentNotification(commentId: string) {
  return db()
    .prepare(`INSERT OR IGNORE INTO notifications(id,userId,actorId,kind,targetId,created)
    SELECT 'comment:'||c.id,COALESCE(u.ownerId,u.id),c.userId,'comment',c.id,c.created FROM comments c
    JOIN posts p ON p.id=c.postId JOIN users u ON u.id=p.userId WHERE c.id=? AND COALESCE(u.ownerId,u.id)<>c.userId`)
    .bind(commentId);
}
// Only the first follow notifies: unfollowing and following again does not ping twice.
export function followNotification(follower: string, following: string) {
  return db()
    .prepare(`INSERT OR IGNORE INTO notifications(id,userId,actorId,kind,targetId,created)
    SELECT 'follow:'||f.follower||':'||f.following,f.following,f.follower,'follow',f.follower,? FROM follows f
    JOIN users u ON u.id=f.following WHERE f.follower=? AND f.following=? AND u.kind='person'`)
    .bind(Date.now(), follower, following);
}
// One query shape for the list and for the pop-ups: what happened, to which
// post or lot, and the snippet to show. 18+ media never becomes a thumbnail.
async function notificationRows(
  me: string,
  where: string,
  binds: unknown[],
  limit: number,
) {
  const rows = await db()
    .prepare(
      `SELECT x.*,(SELECT substr(p.text,1,140) FROM posts p WHERE p.id=x.postId) AS postText,
      (SELECT json_extract(p.media,'$[0].id') FROM posts p WHERE p.id=x.postId AND p.adult=0 AND json_extract(p.media,'$[0].type') LIKE 'image/%') AS postImage
      FROM (SELECT n.id,n.actorId,n.kind,n.targetId,n.created,n.read,u.name,u.avatar,${appearanceColumns('u')},h.handle,
        CASE n.kind WHEN 'gift' THEN (SELECT g.recipient FROM received_gifts g WHERE g.id=n.targetId) END AS giftRecipient,
        CASE n.kind WHEN 'like' THEN n.targetId WHEN 'post' THEN n.targetId
          WHEN 'comment' THEN (SELECT c.postId FROM comments c WHERE c.id=n.targetId)
          WHEN 'support' THEN (SELECT t.postId FROM star_transfers t WHERE t.id=n.targetId) END AS postId,
        CASE n.kind WHEN 'comment' THEN (SELECT substr(c.text,1,160) FROM comments c WHERE c.id=n.targetId) END AS commentText,
        CASE n.kind WHEN 'like' THEN (SELECT COUNT(*) FROM likes l WHERE l.postId=n.targetId AND l.userId NOT IN (n.userId,n.actorId)) ELSE 0 END AS others,
        CASE n.kind WHEN 'support' THEN (SELECT t.amount FROM star_transfers t WHERE t.id=n.targetId)
          WHEN 'market' THEN (SELECT l.price-l.fee FROM market_listings l WHERE l.id=n.targetId) ELSE 0 END AS amount,
        CASE n.kind WHEN 'market' THEN (SELECT t.postText FROM star_transfers t WHERE t.id='market:'||n.targetId) END AS lotTitle,
        CASE n.kind WHEN 'market' THEN (SELECT l.kind FROM market_listings l WHERE l.id=n.targetId) END AS lotKind,
        CASE n.kind WHEN 'market' THEN (SELECT CASE l.kind WHEN 'gift' THEN (SELECT c.family||':'||c.number FROM gift_upgrades c WHERE c.receiptId=l.assetId) ELSE l.assetId END
          FROM market_listings l WHERE l.id=n.targetId) END AS lotKey
        FROM notifications n JOIN users u ON u.id=n.actorId LEFT JOIN handles h ON h.userId=u.id AND h.main=1
        WHERE n.userId=? AND ${notificationVisible()} ${where} ORDER BY n.created DESC,n.id DESC LIMIT ?) x
      ORDER BY x.created DESC,x.id DESC`,
    )
    .bind(me, ...binds, limit)
    .all();
  return rows.results;
}
export async function fanoutPosts() {
  const d = db();
  const rows = await d
    .prepare(
      `SELECT p.id FROM posts p JOIN users u ON u.id=p.userId WHERE p.notifyPending=1 AND ${published('p')} AND ${visibleAccount('u')} ORDER BY p.created LIMIT 20`,
    )
    .all<{ id: string }>();
  for (const row of rows.results)
    await d.batch([
      d
        .prepare(`INSERT OR IGNORE INTO notifications(id,userId,actorId,kind,targetId,created)
      SELECT 'post:'||p.id||':'||f.follower,f.follower,p.userId,'post',p.id,p.created FROM posts p JOIN follows f ON f.following=p.userId
      WHERE p.id=? AND ${published('p')} AND f.follower<>p.userId AND f.follower<>COALESCE(p.publisherId,'')`)
        .bind(row.id),
      d.prepare('UPDATE posts SET notifyPending=0 WHERE id=?').bind(row.id),
    ]);
}
export async function notificationsGet(
  action: string,
  me: string,
  s = new URLSearchParams(),
): Promise<Response | null> {
  if (action === 'pushConfig') {
    const current = await db()
      .prepare(
        'SELECT id FROM push_subscriptions WHERE userId=? AND device=? AND expiresAt>?',
      )
      .bind(me, await device(), Date.now())
      .first();
    return Response.json({
      publicKey: config()?.publicKey || null,
      enabled: !!current,
    });
  }
  if (action !== 'notifications' && action !== 'notificationCount') return null;
  await fanoutPosts();
  if (action === 'notificationCount') {
    const row = await db()
      .prepare(`SELECT COUNT(*) AS unread FROM (
        SELECT 1 FROM notifications n JOIN users u ON u.id=n.actorId
        WHERE n.userId=? AND n.read=0 AND ${notificationVisible()} LIMIT 10
      )`)
      .bind(me)
      .first<{ unread: number }>();
    // The pop-ups: unread events newer than the server time the page last saw.
    const since = Number(s.get('since')) || 0;
    return Response.json({
      unread: row?.unread || 0,
      latest:
        since > 0
          ? await notificationRows(
              me,
              'AND n.read=0 AND n.created>?',
              [since],
              5,
            )
          : [],
      now: Date.now(),
    });
  }
  // Known kinds only: the filter list comes from the client.
  const kinds = (s.get('kinds') || '')
    .split(',')
    .filter((kind) =>
      [
        'message',
        'gift',
        'call',
        'post',
        'like',
        'comment',
        'follow',
        'support',
        'market',
      ].includes(kind),
    );
  const before = Number(s.get('before')) || 0;
  return Response.json(
    await notificationRows(
      me,
      `AND (?='[]' OR n.kind IN (SELECT value FROM json_each(?)))
      AND (?=0 OR n.created<? OR (n.created=? AND n.id<?))`,
      [
        JSON.stringify(kinds),
        JSON.stringify(kinds),
        before,
        before,
        before,
        s.get('beforeId') || '',
      ],
      30,
    ),
  );
}
export async function notificationsPost(
  action: string,
  b: Record<string, unknown>,
  me: string,
): Promise<Response | null> {
  if (
    !['readNotifications', 'pushSubscribe', 'pushUnsubscribe'].includes(action)
  )
    return null;
  await assertReadable(me);
  const d = db();
  if (action === 'readNotifications') {
    await d
      .prepare('UPDATE notifications SET read=1 WHERE userId=? AND created<=?')
      .bind(me, Math.min(Date.now(), Number(b.before) || 0))
      .run();
    return Response.json({ ok: true });
  }
  if (action === 'pushUnsubscribe') {
    await removePushDevice(me);
    return Response.json({ ok: true });
  }
  if (action !== 'pushSubscribe') return null;
  if (!config()) throw new ApiError(503, 'Push-уведомления ещё не настроены');
  const sub = b.subscription as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (!sub || !sub.keys) throw new ApiError(400, 'Неверная подписка');
  let endpoint: string;
  try {
    endpoint = validPushEndpoint(clean(sub.endpoint, 2048, true));
  } catch {
    throw new ApiError(400, 'Неподдерживаемый адрес push-сервиса');
  }
  const p256dh = clean(sub.keys.p256dh, 100, true),
    auth = clean(sub.keys.auth, 40, true);
  const key = decode(p256dh, 65);
  decode(auth, 16);
  try {
    await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
  } catch {
    throw new ApiError(400, 'Неверный push-ключ');
  }
  const id = Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)),
    ),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
  const dev = await device(true),
    now = Date.now();
  await d.batch([
    d
      .prepare('DELETE FROM push_subscriptions WHERE device=? AND userId<>?')
      .bind(dev, me),
    d
      .prepare(`INSERT INTO push_subscriptions(id,userId,device,endpoint,p256dh,auth,created,expiresAt) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM push_subscriptions WHERE userId=?)<10 OR EXISTS(SELECT 1 FROM push_subscriptions WHERE id=?)
      ON CONFLICT(id) DO UPDATE SET userId=excluded.userId,device=excluded.device,p256dh=excluded.p256dh,auth=excluded.auth,expiresAt=excluded.expiresAt WHERE push_subscriptions.device=excluded.device OR push_subscriptions.userId=excluded.userId`)
      .bind(
        id,
        me,
        dev,
        endpoint,
        p256dh,
        auth,
        now,
        now + 30 * 86400000,
        me,
        id,
      ),
  ]);
  if (
    !(await d
      .prepare(
        'SELECT id FROM push_subscriptions WHERE id=? AND userId=? AND device=?',
      )
      .bind(id, me, dev)
      .first())
  )
    throw new ApiError(
      409,
      'Не удалось подключить устройство: лимит или существующая подписка',
    );
  return Response.json({ ok: true });
}
export async function flushPush(notificationId?: string) {
  const targeted = notificationId !== undefined;
  // Request-triggered delivery must not scan or mutate the global notification queue.
  if (!targeted) await fanoutPosts();
  const cfg = config();
  if (!cfg) return { configured: false, sent: 0 };
  const d = db(),
    now = Date.now();
  if (!targeted)
    await d
      .prepare('DELETE FROM push_subscriptions WHERE expiresAt<?')
      .bind(now)
      .run();
  await d
    .prepare(`INSERT OR IGNORE INTO push_deliveries(notificationId,subscriptionId)
    SELECT n.id,s.id FROM notifications n JOIN push_subscriptions s ON s.userId=n.userId WHERE n.created>=s.created AND n.created>? AND s.expiresAt>? AND n.read=0${targeted ? ' AND n.id=?' : ''}`)
    .bind(now - 86400000, now, ...(targeted ? [notificationId] : []))
    .run();
  const rows = await d
    .prepare(`SELECT pd.*,n.kind,n.actorId,n.targetId,n.created,n.read,n.userId,s.endpoint,s.p256dh,s.auth,u.name,
      (SELECT g.recipient FROM received_gifts g WHERE n.kind='gift' AND g.id=n.targetId) AS giftRecipient,
      CASE n.kind WHEN 'comment' THEN (SELECT c.postId FROM comments c WHERE c.id=n.targetId)
        WHEN 'support' THEN (SELECT t.postId FROM star_transfers t WHERE t.id=n.targetId) ELSE n.targetId END AS postId,
      (SELECT substr(c.text,1,120) FROM comments c WHERE n.kind='comment' AND c.id=n.targetId) AS commentText,
      (SELECT t.amount FROM star_transfers t WHERE n.kind='support' AND t.id=n.targetId) AS amount,
      (SELECT t.postText FROM star_transfers t WHERE n.kind='market' AND t.id='market:'||n.targetId) AS lotTitle
    FROM push_deliveries pd JOIN notifications n ON n.id=pd.notificationId JOIN push_subscriptions s ON s.id=pd.subscriptionId JOIN users u ON u.id=n.actorId
    WHERE pd.state='pending' AND pd.retryAt<=? AND pd.attempts<5${targeted ? ' AND pd.notificationId=?' : ''} ORDER BY (n.kind='call') DESC,n.created,n.id,pd.subscriptionId LIMIT 10`)
    .bind(now, ...(targeted ? [notificationId] : []))
    .all();
  let sent = 0;
  const deliver = async (r: (typeof rows.results)[number]) => {
    const lease = crypto.randomUUID(),
      claimNow = Date.now();
    const claim = await d
      .prepare(
        "UPDATE push_deliveries SET lease=?,retryAt=?,attempts=attempts+1 WHERE notificationId=? AND subscriptionId=? AND state='pending' AND attempts<5 AND retryAt<=?",
      )
      .bind(
        lease,
        claimNow + 30000,
        r.notificationId,
        r.subscriptionId,
        claimNow,
      )
      .run();
    if (!claim.meta.changes) return;
    const valid = await d
      .prepare(
        `SELECT n.id FROM notifications n JOIN users u ON u.id=n.actorId WHERE n.id=? AND n.read=0 AND EXISTS(SELECT 1 FROM push_deliveries pd JOIN push_subscriptions ps ON ps.id=pd.subscriptionId WHERE pd.notificationId=n.id AND pd.subscriptionId=? AND pd.lease=? AND ps.userId=n.userId AND ps.expiresAt>${sqlNow}) AND ${notificationVisible()} AND (n.kind<>'call' OR EXISTS(SELECT 1 FROM calls c JOIN users s ON s.id=c.caller JOIN users r ON r.id=c.callee WHERE c.id=n.targetId AND c.caller=n.actorId AND c.callee=n.userId AND c.status='ringing' AND c.expiresAt>? AND ${callAllowed()}))`,
      )
      .bind(r.notificationId, r.subscriptionId, lease, Date.now())
      .first();
    let state = 'skipped',
      retryAt = 0;
    if (valid)
      try {
        validPushEndpoint(String(r.endpoint));
        const post = '/?post=' + encodeURIComponent(String(r.postId));
        const payload = {
          title: String(r.name),
          body:
            r.kind === 'gift'
              ? r.giftRecipient && r.giftRecipient !== r.userId
                ? 'Твоему каналу подарили подарок'
                : 'Тебе подарили подарок'
              : r.kind === 'call'
                ? 'Входящий аудиозвонок'
                : r.kind === 'post'
                  ? 'Новая публикация'
                  : r.kind === 'like'
                    ? 'Нравится твоя публикация'
                    : r.kind === 'comment'
                      ? 'Комментарий: ' +
                        ((r.commentText as string | null) || '')
                      : r.kind === 'follow'
                        ? 'Новый подписчик'
                        : r.kind === 'support'
                          ? `Поддержка публикации: ${Number(r.amount)} Stars`
                          : r.kind === 'market'
                            ? `Покупка в Маркете: ${(r.lotTitle as string | null) || 'лот'}`
                            : 'Новое сообщение',
          url:
            r.kind === 'gift'
              ? r.giftRecipient
                ? '/?profile=' +
                  encodeURIComponent(r.giftRecipient as string) +
                  '&tab=gifts'
                : '/?gifts=1'
              : ['post', 'like', 'comment', 'support'].includes(String(r.kind))
                ? post
                : r.kind === 'follow'
                  ? '/?profile=' + encodeURIComponent(String(r.actorId))
                  : r.kind === 'market'
                    ? '/market?view=assets'
                    : '/?chat=' + encodeURIComponent(String(r.actorId)),
          tag: r.kind + ':' + r.targetId,
        };
        const init = await buildPushPayload(
          {
            data: payload,
            options: {
              ttl: r.kind === 'call' ? 30 : 3600,
              urgency: r.kind === 'call' ? 'high' : 'normal',
            },
          },
          {
            endpoint: String(r.endpoint),
            expirationTime: null,
            keys: { p256dh: String(r.p256dh), auth: String(r.auth) },
          },
          cfg,
        );
        const res = await fetch(String(r.endpoint), {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(7000),
        });
        await res.body?.cancel();
        if (res.status === 404 || res.status === 410)
          await d
            .prepare('DELETE FROM push_subscriptions WHERE id=?')
            .bind(r.subscriptionId)
            .run();
        if (res.ok) {
          state = 'sent';
          sent++;
        } else {
          state = Number(r.attempts) >= 4 ? 'failed' : 'pending';
          retryAt =
            Date.now() + Math.min(3600000, 30000 * 2 ** Number(r.attempts));
        }
      } catch {
        state = Number(r.attempts) >= 4 ? 'failed' : 'pending';
        retryAt =
          Date.now() + Math.min(3600000, 30000 * 2 ** Number(r.attempts));
      }
    await d
      .prepare(
        'UPDATE push_deliveries SET state=?,retryAt=?,lease=NULL WHERE notificationId=? AND subscriptionId=? AND lease=?',
      )
      .bind(state, retryAt, r.notificationId, r.subscriptionId, lease)
      .run();
  };
  // At most ten subscriptions per account. Four workers fit their 7s network
  // timeouts into three waves; claims happen only when a worker is ready to send.
  let next = 0;
  const workers = await Promise.allSettled(
    Array.from(
      { length: targeted ? Math.min(4, rows.results.length) : 1 },
      async () => {
        for (;;) {
          const row = rows.results[next++];
          if (!row) return;
          await deliver(row);
        }
      },
    ),
  );
  // Await every active send even if one database operation fails. The durable
  // queue and expired leases remain available to the scheduled retry worker.
  if (workers.some((result) => result.status === 'rejected'))
    throw new Error('Push delivery batch did not complete');
  return { configured: true, sent };
}
