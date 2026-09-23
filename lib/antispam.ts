import { db } from './storage';
import { ApiError } from './api-error';
import { tokenHash } from './auth-session';
import { rateLimit } from './rate-limit';
import { detectSpamDomain, spamFingerprint } from './antispam-detection';
import type {
  QueuedSubmission,
  SpamSettings,
  SpamSubmission,
} from './antispam-types';

// Keep this role-only lookup independent of account-access's public-feed imports.
// Callers already enforce writable account state; Premium never bypasses filtering.
async function trustedSpamActor(id: string) {
  return !!(await db()
    .prepare(
      'SELECT userId FROM moderators WHERE userId=? UNION SELECT userId FROM administrators WHERE userId=?',
    )
    .bind(id, id)
    .first());
}

export async function spamSettings(): Promise<SpamSettings> {
  const row = await db()
    .prepare(
      'SELECT domains,raidUntil,updated FROM antispam_settings WHERE id=1',
    )
    .first<{ domains: string; raidUntil: number; updated: number }>();
  if (!row) throw new ApiError(503, 'Защита от спама ещё не настроена.');
  return { ...row, domains: JSON.parse(row.domains) as string[] };
}
export async function assertSpamIdentity(actorId: string, ...fields: string[]) {
  if (await trustedSpamActor(actorId)) return;
  const settings = await spamSettings();
  if (fields.some((field) => detectSpamDomain(field, settings.domains, true)))
    throw new ApiError(
      400,
      'В оформлении профиля или группы обнаружена запрещённая реклама. Измените имя, юзернейм или описание.',
      'SPAM_IDENTITY',
    );
}
export const queuedNotice =
  'Отправлено на проверку модератору. До одобрения другие пользователи этого не увидят.';
// Surfaces with financial side effects must reject before charging, not quarantine
// an already-funded event. Stories use the same guard without a queue kind.
export async function assertUnqueuedPublicWrite(
  actorId: string,
  text = '',
  targetId = actorId,
) {
  if (await trustedSpamActor(actorId)) return;
  const d = db(),
    settings = await spamSettings(),
    now = Date.now();
  const actor = await d
    .prepare(`SELECT u.created,u.name,u.bio,COALESCE(pa.ringText,'') AS ringText,
    (SELECT group_concat(h.handle,' ') FROM handles h WHERE h.userId=u.id) AS handles,
    (SELECT location||'|'||website||'|'||instagram||'|'||tiktok||'|'||youtube FROM profile_details WHERE userId=u.id) AS details
    FROM users u LEFT JOIN profile_appearance pa ON pa.userId=u.id WHERE u.id=?`)
    .bind(actorId)
    .first<{
      created: number;
      name: string;
      bio: string;
      ringText: string;
      handles: string;
      details: string | null;
    }>();
  if (!actor) throw new ApiError(401, 'Аккаунт не найден');
  const target =
    targetId === actorId
      ? null
      : await d
          .prepare("SELECT name,bio FROM users WHERE id=? AND kind='channel'")
          .bind(targetId)
          .first<{ name: string; bio: string }>();
  if (
    [
      actor.name,
      actor.bio,
      actor.ringText,
      actor.handles || '',
      actor.details || '',
      target?.name || '',
      target?.bio || '',
    ].some((value) => detectSpamDomain(value, settings.domains, true)) ||
    detectSpamDomain(text, settings.domains)
  )
    throw new ApiError(
      400,
      'Публикация содержит запрещённую рекламу. Проверьте текст и оформление профиля.',
      'SPAM_IDENTITY',
    );
  if (settings.raidUntil > now && now - actor.created < 86400000) {
    if (
      !(await d
        .prepare(
          "SELECT id FROM antispam_queue WHERE actorId=? AND status='approved' LIMIT 1",
        )
        .bind(actorId)
        .first())
    )
      throw new ApiError(
        403,
        'Включён антирейд. Сначала отправьте сообщение в группу или пост в ленту и дождитесь одобрения модератора.',
        'SPAM_NEW_ACCOUNT',
      );
    await rateLimit('antiraid:feed', actorId, 1, 300);
  }
}
function queued(id: string): QueuedSubmission {
  return { ok: true, queued: true, id, notice: queuedNotice };
}
/** Only validated public/plaintext content enters this queue. Secret chats never call it. */
export async function reviewSpam(
  submission: SpamSubmission,
): Promise<QueuedSubmission | null> {
  const d = db(),
    { kind, actorId, targetId, contextId, payload } = submission;
  const id = kind + ':' + targetId;
  const encoded = JSON.stringify(payload);
  const existing = await d
    .prepare(
      'SELECT id,actorId,contextId,payload,status FROM antispam_queue WHERE id=?',
    )
    .bind(id)
    .first<{
      id: string;
      actorId: string;
      contextId: string;
      payload: string;
      status: string;
    }>();
  if (existing) {
    if (
      existing.actorId !== actorId ||
      existing.contextId !== contextId ||
      existing.payload !== encoded
    )
      throw new ApiError(
        409,
        'Данные отправки изменились. Отправьте сообщение заново.',
      );
    if (existing.status === 'pending') return queued(existing.id);
    if (existing.status === 'rejected')
      throw new ApiError(
        403,
        'Модератор отклонил эту отправку.',
        'SPAM_REJECTED',
      );
    return null;
  }
  if (await trustedSpamActor(actorId)) return null;
  const hash = await tokenHash(
    JSON.stringify([actorId, kind, contextId, payload]),
  );
  const duplicate = await d
    .prepare(
      "SELECT id FROM antispam_queue WHERE digest=? AND status='pending'",
    )
    .bind(hash)
    .first<{ id: string }>();
  if (duplicate) return queued(duplicate.id);
  const settings = await spamSettings(),
    now = Date.now();
  const actor = await d
    .prepare(`SELECT u.created,u.name,u.bio,COALESCE(pa.ringText,'') AS ringText,
    (SELECT group_concat(h.handle,' ') FROM handles h WHERE h.userId=u.id) AS handles,
    (SELECT location||'|'||website||'|'||instagram||'|'||tiktok||'|'||youtube FROM profile_details WHERE userId=u.id) AS details
    FROM users u LEFT JOIN profile_appearance pa ON pa.userId=u.id WHERE u.id=?`)
    .bind(actorId)
    .first<{
      created: number;
      name: string;
      bio: string;
      ringText: string;
      handles: string;
      details: string | null;
    }>();
  if (!actor) throw new ApiError(401, 'Аккаунт не найден');
  const reasons: string[] = [];
  const text = [payload.text, payload.code || '', payload.poll || ''].join(
    '\n',
  );
  const domain = detectSpamDomain(text, settings.domains);
  if (domain)
    reasons.push('Рекламный домен или его кодированное написание: ' + domain);
  if (
    [
      actor.name,
      actor.bio,
      actor.ringText,
      actor.handles || '',
      actor.details || '',
    ].some((field) => detectSpamDomain(field, settings.domains, true))
  )
    reasons.push('Рекламное написание в профиле отправителя');
  if (kind === 'post' && contextId !== actorId) {
    const channel = await d
      .prepare(
        `SELECT u.name,u.bio,(SELECT group_concat(h.handle,' ') FROM handles h WHERE h.userId=u.id) AS handles FROM users u WHERE u.id=?`,
      )
      .bind(contextId)
      .first<{ name: string; bio: string; handles: string }>();
    if (
      channel &&
      [channel.name, channel.bio, channel.handles || ''].some((value) =>
        detectSpamDomain(value, settings.domains, true),
      )
    )
      reasons.push('Рекламное написание в оформлении канала');
  }
  const fingerprint = spamFingerprint(text);
  const digest = await tokenHash(
    JSON.stringify([
      kind,
      kind === 'post' ? 'public-feed' : contextId,
      fingerprint,
    ]),
  );
  if (settings.raidUntil > now && now - actor.created < 86400000) {
    await rateLimit(
      'antiraid:' + (kind === 'group' ? 'group' : 'feed'),
      actorId,
      1,
      kind === 'group' ? 15 : 300,
    );
    const approved = await d
      .prepare(
        "SELECT id FROM antispam_queue WHERE actorId=? AND status='approved' LIMIT 1",
      )
      .bind(actorId)
      .first();
    if (!approved)
      reasons.push('Антирейд: первая публичная отправка нового аккаунта');
  }
  // One id per group send preserves retry semantics. All workers share these rows.
  await d
    .prepare(
      'INSERT OR IGNORE INTO antispam_activity(id,actorId,fingerprint,created) VALUES(?,?,?,?)',
    )
    .bind(id, actorId, digest, now)
    .run();
  const counts = await d
    .prepare(`SELECT COUNT(DISTINCT a.actorId) AS actors,
    COUNT(DISTINCT CASE WHEN u.created>? THEN a.actorId END) AS newcomers,
    SUM(CASE WHEN a.actorId=? AND a.created>? THEN 1 ELSE 0 END) AS own
    FROM antispam_activity a JOIN users u ON u.id=a.actorId WHERE a.fingerprint=? AND a.created>?`)
    .bind(now - 86400000, actorId, now - 300000, digest, now - 600000)
    .first<{ actors: number; newcomers: number; own: number }>();
  if (fingerprint.length >= 16 && Number(counts?.own) >= 3)
    reasons.push('Повторная отправка одинакового текста');
  if (
    fingerprint.length >= 32 &&
    (Number(counts?.actors) >= 5 || Number(counts?.newcomers) >= 3)
  )
    reasons.push('Одинаковый текст от нескольких аккаунтов');
  if (!reasons.length) return null;
  await rateLimit('spam-queue', actorId, 10, 3600);
  await d
    .prepare(`INSERT OR IGNORE INTO antispam_queue(id,kind,targetId,actorId,contextId,text,payload,reasons,digest,created)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      id,
      kind,
      targetId,
      actorId,
      contextId,
      text,
      encoded,
      JSON.stringify(reasons),
      hash,
      now,
    )
    .run();
  const saved = await d
    .prepare(
      "SELECT id FROM antispam_queue WHERE digest=? AND status='pending'",
    )
    .bind(hash)
    .first<{ id: string }>();
  if (!saved) throw new ApiError(409, 'Повторите отправку');
  return queued(saved.id);
}
export async function cleanSpamActivity() {
  await db()
    .prepare('DELETE FROM antispam_activity WHERE created<?')
    .bind(Date.now() - 86400000)
    .run();
  await db()
    .prepare(
      "UPDATE antispam_queue SET status='rejected',reviewedAt=?,note='Срок проверки истёк' WHERE status='pending' AND created<?",
    )
    .bind(Date.now(), Date.now() - 7 * 86400000)
    .run();
  await db()
    .prepare(
      "DELETE FROM antispam_queue WHERE status<>'pending' AND reviewedAt<?",
    )
    .bind(Date.now() - 30 * 86400000)
    .run();
}
