import { db } from './storage';
import { ApiError } from './api-error';
import { clean } from './server';
import {
  assertWritable,
  assertPostVisible,
  requireModerator,
  moderatorWriteAllowed,
  visibleAccount,
} from './account-access';
import { requireAdministrator } from './administrator-access';
import {
  allowed,
  channelPermission,
  writableTarget,
  published,
} from './channel-access';
import { mediaPermission } from './media-access';
import { canSend } from './rooms';
import { groupSenderVisible } from './antispam-access';
import { spamSettings } from './antispam';
import type { SpamReview, SpamPayload } from './antispam-types';

type StoredReview = Omit<SpamReview, 'payload' | 'reasons'> & {
  payload: string;
  reasons: string;
};
const staffGate = moderatorWriteAllowed('?');
const queueGate = `EXISTS(SELECT 1 FROM antispam_queue aq WHERE aq.id=? AND aq.status='pending') AND ${staffGate}`;
const tableFor = {
  post: 'posts',
  comment: 'comments',
  group: 'chat_room_messages',
} as const;

export async function spamModerationGet(
  action: string,
  params: URLSearchParams,
  me: string,
) {
  if (action !== 'spamQueue') return null;
  await requireModerator(me);
  const status = params.get('status') || 'pending';
  if (!['pending', 'approved', 'rejected'].includes(status))
    throw new ApiError(400, 'Неверный статус');
  const before = Number(params.get('before')) || Date.now() + 1;
  const beforeId = params.get('beforeId') || '\uffff';
  const rows = await db()
    .prepare(`SELECT q.*,u.name,h.handle,
    CASE WHEN q.kind='group' THEN (SELECT r.name FROM chat_rooms r WHERE r.id=q.contextId)
    WHEN q.kind='post' THEN (SELECT p.name FROM users p WHERE p.id=q.contextId) ELSE 'Комментарии к публикации' END AS contextName
    FROM antispam_queue q JOIN users u ON u.id=q.actorId LEFT JOIN handles h ON h.userId=u.id AND h.main=1
    WHERE q.status=? AND (q.created<? OR(q.created=? AND q.id<?)) AND ${staffGate} ORDER BY q.created DESC,q.id DESC LIMIT 51`)
    .bind(status, before, before, beforeId, me)
    .all<StoredReview>();
  const page = rows.results.slice(0, 50).map((row) => ({
    ...row,
    payload: JSON.parse(row.payload) as SpamPayload,
    reasons: JSON.parse(row.reasons) as string[],
  }));
  return Response.json({
    settings: await spamSettings(),
    items: page,
    hasMore: rows.results.length > 50,
  });
}

async function approve(review: StoredReview, me: string, note: string) {
  const d = db(),
    p = JSON.parse(review.payload) as SpamPayload;
  const { targetId, actorId, contextId, kind, id } = review;
  await assertWritable(actorId);
  const table = tableFor[kind];
  if (
    await d.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(targetId).first()
  )
    throw new ApiError(409, 'Публикация уже существует. Обновите очередь.');
  let insert;
  const now = Date.now();
  if (kind === 'post') {
    if (!(await allowed(contextId, actorId)))
      throw new ApiError(403, 'Автор больше не может публиковать здесь');
    const media = JSON.parse(p.media || '[]') as { id: string }[];
    insert = d
      .prepare(`WITH input AS(SELECT ? AS actor,? AS media)
      INSERT INTO posts(id,userId,text,media,poll,code,codeLang,adult,created,publishAt,publisherId,notifyPending)
      SELECT ?,u.id,?,?,?,?,?,?,?,?,?,1 FROM users u,input i WHERE u.id=? AND ${channelPermission('u')} AND ${writableTarget('u')}
      AND NOT EXISTS(SELECT 1 FROM json_each(i.media) j LEFT JOIN uploads up ON up.id=j.value AND up.userId=i.actor
        WHERE up.id IS NULL OR NOT (${mediaPermission('up.id', 'i.actor')})) AND ${queueGate}`)
      .bind(
        actorId,
        JSON.stringify(media.map((file) => file.id)),
        targetId,
        p.text,
        p.media || '[]',
        p.poll || '[]',
        p.code || '',
        p.codeLang || 'text',
        p.adult || 0,
        Math.max(now, p.publishAt || 0),
        p.publishAt || 0,
        actorId,
        contextId,
        actorId,
        actorId,
        actorId,
        actorId,
        id,
        me,
      );
  } else if (kind === 'comment') {
    await assertPostVisible(contextId, actorId);
    insert = d
      .prepare(`INSERT INTO comments(id,postId,userId,text,created)
      SELECT ?,p.id,a.id,?,? FROM posts p JOIN users u ON u.id=p.userId,users a WHERE p.id=? AND a.id=?
      AND ${published('p')} AND ${visibleAccount('u')} AND a.deletedAt=0 AND a.onboardingComplete=1
      AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE (ar.userId=a.id OR (ar.userId IN(u.id,u.ownerId) AND ar.mode='blocked')) AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))
      AND NOT EXISTS(SELECT 1 FROM user_blocks ub WHERE (ub.blocker=a.id AND ub.blocked IN(u.id,u.ownerId)) OR (ub.blocked=a.id AND ub.blocker IN(u.id,u.ownerId)))
      AND ${queueGate}`)
      .bind(targetId, p.text, now, contextId, actorId, id, me);
  } else {
    insert = d
      .prepare(`INSERT INTO chat_room_messages(id,roomId,sender,text,ciphertext,replyTo,created)
      SELECT ?,r.id,u.id,?,NULL,?,MAX(?,COALESCE((SELECT MAX(previous.created)+1 FROM chat_room_messages previous WHERE previous.roomId=r.id),0))
      FROM chat_rooms r,users u WHERE r.id=? AND u.id=? AND r.kind='group' AND ${canSend('r', 'u.id')}
      AND (? IS NULL OR EXISTS(SELECT 1 FROM chat_room_messages rp WHERE rp.id=? AND rp.roomId=r.id AND rp.deletedAt=0 AND ${groupSenderVisible('rp')})) AND ${queueGate}`)
      .bind(
        targetId,
        p.text,
        p.replyTo || null,
        now,
        contextId,
        actorId,
        p.replyTo || null,
        p.replyTo || null,
        id,
        me,
      );
  }
  const authorColumn =
    kind === 'post' ? 'publisherId' : kind === 'comment' ? 'userId' : 'sender';
  const results = await d.batch([
    insert,
    d
      .prepare(`UPDATE antispam_queue SET status='approved',reviewedAt=?,reviewedBy=?,note=?
      WHERE id=? AND status='pending' AND ${staffGate}
      AND EXISTS(SELECT 1 FROM ${table} published WHERE published.id=antispam_queue.targetId AND published.${authorColumn}=antispam_queue.actorId)`)
      .bind(now, me, note, id, me),
    // An approved comment reaches the post's author like any other comment.
    ...(kind === 'comment'
      ? [
          d
            .prepare(
              `INSERT OR IGNORE INTO notifications(id,userId,actorId,kind,targetId,created)
              SELECT 'comment:'||c.id,COALESCE(u.ownerId,u.id),c.userId,'comment',c.id,c.created FROM comments c
              JOIN posts p ON p.id=c.postId JOIN users u ON u.id=p.userId WHERE c.id=? AND COALESCE(u.ownerId,u.id)<>c.userId`,
            )
            .bind(targetId),
        ]
      : []),
  ]);
  if (!results[0].meta.changes || !results[1].meta.changes)
    throw new ApiError(409, 'Отправка или права изменились. Обновите очередь.');
}

export async function spamModerationPost(
  action: string,
  body: Record<string, unknown>,
  me: string,
) {
  if (!['spamSettings', 'spamReview'].includes(action)) return null;
  if (action === 'spamSettings') {
    await requireAdministrator(me);
    if (
      !Array.isArray(body.domains) ||
      body.domains.length > 50 ||
      typeof body.raid !== 'boolean'
    )
      throw new ApiError(400, 'Укажите домены и состояние режима');
    const domains = [
      ...new Set(
        body.domains.map((domain) => clean(domain, 253, true).toLowerCase()),
      ),
    ];
    if (
      domains.some(
        (domain) =>
          !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(
            domain,
          ),
      )
    )
      throw new ApiError(400, 'Укажите домены без https://, путей и пробелов');
    if (!Number.isSafeInteger(body.expectedUpdated))
      throw new ApiError(400, 'Обновите настройки');
    const now = Math.max(Date.now(), Number(body.expectedUpdated) + 1);
    const result = await db()
      .prepare(`UPDATE antispam_settings SET domains=?,raidUntil=?,updated=? WHERE id=1 AND updated=?
      AND EXISTS(SELECT 1 FROM administrators a WHERE a.userId=?) AND ${staffGate}`)
      .bind(
        JSON.stringify(domains),
        body.raid ? now + 86400000 : 0,
        now,
        body.expectedUpdated,
        me,
        me,
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        409,
        'Настройки или права изменились. Обновите страницу.',
      );
    return Response.json(await spamSettings());
  }
  await requireModerator(me);
  const id = clean(body.id, 120, true),
    decision = body.decision;
  if (decision !== 'approve' && decision !== 'reject')
    throw new ApiError(400, 'Выберите решение');
  const note = clean(body.note || '', 500);
  const review = await db()
    .prepare('SELECT * FROM antispam_queue WHERE id=?')
    .bind(id)
    .first<StoredReview>();
  if (!review || review.status !== 'pending')
    throw new ApiError(409, 'Отправка уже рассмотрена. Обновите очередь.');
  if (decision === 'approve') await approve(review, me, note);
  else {
    const result = await db()
      .prepare(
        `UPDATE antispam_queue SET status='rejected',reviewedAt=?,reviewedBy=?,note=? WHERE id=? AND status='pending' AND ${staffGate}`,
      )
      .bind(Date.now(), me, note, id, me)
      .run();
    if (!result.meta.changes)
      throw new ApiError(409, 'Отправка или права изменились');
  }
  return Response.json({ ok: true });
}
