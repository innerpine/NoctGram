import { appearanceColumns } from '@/lib/premium-access';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { cookies } from 'next/headers';
import { db, clean, ApiError } from './server';
import { setting } from './auth-session';
import { assertReadable, visibleAccount } from './account-access';
import { published, sqlNow } from './channel-access';
import { messageVisible } from './chat-access';

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
  return `${visibleAccount('u')} AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker=n.userId AND b.blocked IN(u.id,u.ownerId)) OR (b.blocker IN(u.id,u.ownerId) AND b.blocked=n.userId))
    AND ((n.kind='message' AND EXISTS(SELECT 1 FROM messages m WHERE m.id=n.targetId AND m.recipient=n.userId AND ${messageVisible('m', 'n.userId')}))
      OR (n.kind='gift' AND EXISTS(SELECT 1 FROM received_gifts g WHERE g.id=n.targetId AND g.recipient=n.userId AND g.sender=n.actorId AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.giftReceiptId=g.id AND NOT (${messageVisible('m', 'n.userId')}))))
      OR n.kind='call' OR (n.kind='post' AND EXISTS(SELECT 1 FROM posts p WHERE p.id=n.targetId AND ${published('p')}
        AND NOT EXISTS(SELECT 1 FROM user_privacy pref WHERE pref.userId=n.userId AND pref.hideAdult=1 AND p.adult=1))))`;
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
    return Response.json({ unread: row?.unread || 0 });
  }
  const rows = await db()
    .prepare(
      `SELECT n.*,u.name,u.avatar,${appearanceColumns('u')},h.handle FROM notifications n JOIN users u ON u.id=n.actorId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE n.userId=? AND ${notificationVisible()} ORDER BY n.created DESC,n.id DESC LIMIT 50`,
    )
    .bind(me)
    .all();
  return Response.json(rows.results);
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
export async function flushPush() {
  await fanoutPosts();
  const cfg = config();
  if (!cfg) return { configured: false, sent: 0 };
  const d = db(),
    now = Date.now();
  await d
    .prepare('DELETE FROM push_subscriptions WHERE expiresAt<?')
    .bind(now)
    .run();
  await d
    .prepare(`INSERT OR IGNORE INTO push_deliveries(notificationId,subscriptionId)
    SELECT n.id,s.id FROM notifications n JOIN push_subscriptions s ON s.userId=n.userId WHERE n.created>=s.created AND n.created>? AND n.read=0`)
    .bind(now - 86400000)
    .run();
  const rows = await d
    .prepare(`SELECT pd.*,n.kind,n.actorId,n.targetId,n.created,n.read,s.endpoint,s.p256dh,s.auth,u.name
    FROM push_deliveries pd JOIN notifications n ON n.id=pd.notificationId JOIN push_subscriptions s ON s.id=pd.subscriptionId JOIN users u ON u.id=n.actorId
    WHERE pd.state='pending' AND pd.retryAt<=? AND pd.attempts<5 ORDER BY (n.kind='call') DESC,n.created LIMIT 10`)
    .bind(now)
    .all();
  let sent = 0;
  for (const r of rows.results) {
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
    if (!claim.meta.changes) continue;
    const valid = await d
      .prepare(
        `SELECT n.id FROM notifications n JOIN users u ON u.id=n.actorId WHERE n.id=? AND n.read=0 AND EXISTS(SELECT 1 FROM push_deliveries pd JOIN push_subscriptions ps ON ps.id=pd.subscriptionId WHERE pd.notificationId=n.id AND pd.subscriptionId=? AND pd.lease=? AND ps.userId=n.userId AND ps.expiresAt>${sqlNow}) AND ${notificationVisible()} AND (n.kind<>'call' OR EXISTS(SELECT 1 FROM calls WHERE id=n.targetId AND status='ringing' AND expiresAt>?))`,
      )
      .bind(r.notificationId, r.subscriptionId, lease, Date.now())
      .first();
    let state = 'skipped',
      retryAt = 0;
    if (valid)
      try {
        validPushEndpoint(String(r.endpoint));
        const payload = {
          title: String(r.name),
          body:
            r.kind === 'gift'
              ? 'Тебе подарили подарок'
              : r.kind === 'call'
                ? 'Входящий аудиозвонок'
                : r.kind === 'post'
                  ? 'Новая публикация'
                  : 'Новое сообщение',
          url:
            r.kind === 'gift'
              ? '/?gifts=1'
              : r.kind === 'post'
                ? '/?post=' + encodeURIComponent(String(r.targetId))
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
  }
  return { configured: true, sent };
}
