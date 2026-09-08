import { assertStaticAvatar } from './avatar-media';
import { appearanceColumns } from '@/lib/premium-access';
import { assertMediaRead, mediaAssignment } from '@/lib/media-access';
import {
  allowed,
  channelRights,
  channelPermission,
  writableTarget,
} from './channel-access';
import { personalVisibility } from './privacy';
import {
  visibleAccount,
  assertAccountVisible,
  assertUploadAvailable,
} from './account-access';
import { db, clean, ApiError, profile } from '@/lib/server';

export async function canPublish(id: string, me: string) {
  return allowed(id, me, 'publish');
}
async function ensureWallet(me: string) {
  await db()
    .prepare(
      "INSERT OR IGNORE INTO star_transfers(id,recipient,amount,kind,created) VALUES(?,?,10000,'grant',?)",
    )
    .bind('grant:' + me, me, Date.now())
    .run();
}
async function balance(me: string) {
  const row = await db()
    .prepare(
      'SELECT COALESCE(SUM(CASE WHEN recipient=? THEN amount ELSE -amount END),0) AS balance FROM star_transfers WHERE recipient=? OR sender=?',
    )
    .bind(me, me, me)
    .first<{ balance: number }>();
  return row?.balance || 0;
}
async function validImage(url: unknown, me: string, existing?: string) {
  const value = clean(url || '', 200);
  if (
    value &&
    value !== existing &&
    !(await db()
      .prepare(
        "SELECT id FROM uploads WHERE id=? AND userId=? AND type LIKE 'image/%'",
      )
      .bind(value.replace('/api/media/', ''), me)
      .first())
  )
    throw new ApiError(400, 'Изображение не найдено');
  if (value) {
    const mediaId = value.replace('/api/media/', '');
    await assertUploadAvailable(mediaId);
    if (value !== existing) await assertMediaRead(mediaId, me, me);
  }
  return value;
}
function handle(value: unknown) {
  const name = clean(value, 25, true).replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{4,24}$/.test(name))
    throw new ApiError(400, 'Юзернейм: 4–24 латинские буквы, цифры или _');
  return name;
}
export async function featureGet(
  action: string,
  s: URLSearchParams,
  me: string,
): Promise<Response | null> {
  const d = db();
  if (action === 'connections') {
    const target = s.get('id') || me;
    await assertAccountVisible(target);
    const kind = s.get('kind');
    if (kind !== 'followers' && kind !== 'following')
      throw new ApiError(400, 'Выберите подписчиков или подписки');
    if (
      !(await d.prepare('SELECT id FROM users WHERE id=?').bind(target).first())
    )
      throw new ApiError(404, 'Профиль не найден');
    // Only these fixed column names can enter SQL; ids and cursors stay bound.
    const personColumn = kind === 'followers' ? 'follower' : 'following';
    const profileColumn = kind === 'followers' ? 'following' : 'follower';
    const rows = (
      await d
        .prepare(
          `SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},u.kind,h.handle FROM follows f JOIN users u ON u.id=f.` +
            personColumn +
            ' JOIN handles h ON h.userId=u.id AND h.main=1 WHERE f.' +
            profileColumn +
            `=? AND u.id>? AND ${visibleAccount('u')} AND ${personalVisibility('u')} ORDER BY u.id ASC LIMIT 31`,
        )
        .bind(target, s.get('after') || '', me)
        .all<{
          id: string;
          name: string;
          avatar: string;
          kind: string;
          handle: string;
        }>()
    ).results;
    const people = rows.slice(0, 30);
    const hasMore = rows.length > 30;
    return Response.json({
      people,
      hasMore,
      nextCursor: hasMore ? people.at(-1)!.id : null,
    });
  }
  if (action === 'channels') {
    const q = '%' + (s.get('q') || '').replace(/^@/, '').slice(0, 100) + '%';
    const rows = await d
      .prepare(`SELECT u.id FROM users u JOIN handles h ON h.userId=u.id AND h.main=1
      WHERE (${visibleAccount('u')} OR u.ownerId=?) AND ${personalVisibility('u')} AND u.kind='channel' AND (u.name LIKE ? OR h.handle LIKE ?)
      ORDER BY (u.ownerId=? OR EXISTS(SELECT 1 FROM channel_members WHERE channelId=u.id AND userId=?)) DESC,u.created DESC LIMIT 50`)
      .bind(me, me, q, q, me, me)
      .all<{ id: string }>();
    return Response.json(
      await Promise.all(rows.results.map((r) => profile(r.id, me))),
    );
  }
  if (action === 'wallet') {
    await ensureWallet(me);
    const before = Number(s.get('before')) || Date.now() + 1;
    const rows = await d
      .prepare(
        `WITH viewer AS(SELECT ? AS id) SELECT t.*,COALESCE(a.name,'Noct Stars') AS name,COALESCE(a.avatar,'') AS avatar,${appearanceColumns('a')} FROM star_transfers t CROSS JOIN viewer v LEFT JOIN users a ON a.id=CASE WHEN t.sender=v.id THEN t.recipient ELSE t.sender END WHERE (t.sender=v.id OR t.recipient=v.id) AND (t.created<? OR(t.created=? AND t.id<?)) ORDER BY t.created DESC,t.id DESC LIMIT 50`,
      )
      .bind(me, before, before, s.get('beforeId') || '')
      .all();
    const totals = await d
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN recipient=? AND kind='support' THEN amount ELSE 0 END),0) AS received,COALESCE(SUM(CASE WHEN sender=? THEN amount ELSE 0 END),0) AS sent,COALESCE(SUM(CASE WHEN recipient=? AND kind IN ('telegram_test','admin_grant') THEN 1 ELSE 0 END),0) AS topupCount,COALESCE(SUM(CASE WHEN recipient=? AND kind IN ('telegram_test','admin_grant') THEN amount ELSE 0 END),0) AS topupTotal FROM star_transfers WHERE sender=? OR recipient=?",
      )
      .bind(me, me, me, me, me, me)
      .first();
    return Response.json({
      balance: await balance(me),
      testMode: true,
      ...totals,
      transactions: rows.results,
    });
  }
  return null;
}
export async function featurePost(
  action: string,
  b: Record<string, unknown>,
  me: string,
): Promise<Response | null> {
  const d = db(),
    id = typeof b.id === 'string' ? b.id : '';
  if (action === 'view') {
    await d
      .prepare(
        'INSERT OR IGNORE INTO post_views(postId,userId,created) SELECT p.id,?,? FROM posts p JOIN users u ON u.id=p.userId WHERE p.id=? AND p.userId<>? AND (u.ownerId IS NULL OR u.ownerId<>?)',
      )
      .bind(me, Date.now(), id, me, me)
      .run();
    return Response.json(
      await d
        .prepare('SELECT COUNT(*) AS views FROM post_views WHERE postId=?')
        .bind(id)
        .first(),
    );
  }
  if (action === 'createChannel') {
    const name = clean(b.name, 40, true),
      bio = clean(b.bio || '', 300),
      h = handle(b.handle),
      avatar = await validImage(b.avatar, me);
    if (avatar) await assertStaticAvatar(avatar);
    const channelId = 'channel_' + crypto.randomUUID();
    try {
      await d.batch([
        d
          .prepare(
            `WITH input AS(SELECT ? AS actor,? AS avatar) INSERT INTO users(id,name,bio,avatar,kind,ownerId,created) SELECT ?,?,?,i.avatar,'channel',i.actor,? FROM input i WHERE ${mediaAssignment("''", 'i.avatar', 'i.actor')} AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=i.actor AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))`,
          )
          .bind(me, avatar, channelId, name, bio, Date.now()),
        d
          .prepare(
            'INSERT INTO handles(handle,userId,main) SELECT ?,?,1 WHERE EXISTS(SELECT 1 FROM users WHERE id=?)',
          )
          .bind(h, channelId, channelId),
      ]);
    } catch (e) {
      if (
        await d
          .prepare('SELECT handle FROM handles WHERE handle=?')
          .bind(h)
          .first()
      )
        throw new ApiError(409, 'Этот юзернейм уже занят');
      throw e;
    }
    if (
      !(await d
        .prepare('SELECT id FROM users WHERE id=?')
        .bind(channelId)
        .first())
    )
      throw new ApiError(409, 'Права на публикацию или вложение изменились');
    return Response.json(await profile(channelId, me));
  }
  if (action === 'profile') {
    const target = id || me;
    if (!(await allowed(target, me, 'profile')))
      throw new ApiError(403, 'Нельзя редактировать чужой профиль');
    const current = await d
      .prepare('SELECT avatar,cover FROM users WHERE id=?')
      .bind(target)
      .first<{ avatar: string; cover: string }>();
    const rights = await channelRights(target, me);
    const name = clean(b.name, 40, true),
      bio = clean(b.bio, 300),
      avatar = await validImage(b.avatar, me, current?.avatar),
      cover = await validImage(b.cover, me, current?.cover);
    if (avatar && avatar !== current?.avatar) await assertStaticAvatar(avatar);
    const statements = [];
    // mediaAssignment repeats its expressions; use an input CTE to bind each value once.
    const eligibility = `WITH input AS(SELECT ? AS actor,? AS avatar,? AS cover),eligible AS(SELECT u.id FROM users u,input i WHERE u.id=? AND ${mediaAssignment('u.avatar', 'i.avatar', 'i.actor')} AND ${mediaAssignment('u.cover', 'i.cover', 'i.actor')})`;
    const eligibilityArgs = [me, avatar, cover, target];
    if (b.mainHandle !== undefined && rights.canManageMembers) {
      if (!Array.isArray(b.extraHandles) || b.extraHandles.length > 4)
        throw new ApiError(
          400,
          'Можно сохранить основной и до четырёх дополнительных юзернеймов',
        );
      const names = [
        handle(b.mainHandle),
        ...b.extraHandles
          .filter((v) => typeof v === 'string' && v.trim())
          .map(handle),
      ];
      if (new Set(names).size !== names.length)
        throw new ApiError(400, 'Юзернеймы не должны повторяться');
      const occupied = await d
        .prepare(
          'SELECT handle FROM handles WHERE userId<>? AND handle IN (' +
            names.map(() => '?').join(',') +
            ')',
        )
        .bind(target, ...names)
        .first();
      if (occupied)
        throw new ApiError(409, 'Юзернейм @' + occupied.handle + ' уже занят');
      statements.push(
        d
          .prepare(
            `${eligibility} DELETE FROM handles WHERE userId=? AND userId IN(SELECT id FROM eligible) AND EXISTS(SELECT 1 FROM users u WHERE u.id=handles.userId AND ${channelPermission('u', 'members')} AND ${writableTarget('u')})`,
          )
          .bind(...eligibilityArgs, target, me, me, me),
      );
      names.forEach((h, i) =>
        statements.push(
          d
            .prepare(
              `${eligibility} INSERT INTO handles(handle,userId,main) SELECT ?,u.id,? FROM users u WHERE u.id=? AND u.id IN(SELECT id FROM eligible) AND ${channelPermission('u', 'members')} AND ${writableTarget('u')}`,
            )
            .bind(...eligibilityArgs, h, i === 0 ? 1 : 0, target, me, me, me),
        ),
      );
    }
    statements.push(
      d
        .prepare(
          `${eligibility} UPDATE users AS u SET name=?,bio=?,avatar=?,cover=? WHERE id=? AND id IN(SELECT id FROM eligible) AND ${channelPermission('u', 'profile')} AND ${writableTarget('u')}`,
        )
        .bind(
          ...eligibilityArgs,
          name,
          bio,
          avatar,
          cover,
          target,
          me,
          me,
          me,
          me,
        ),
    );
    statements.unshift(
      d
        .prepare(
          `${eligibility} UPDATE profile_appearance SET avatarMotion='',avatarMotionType='' WHERE userId=? AND userId IN(SELECT id FROM eligible) AND EXISTS(SELECT 1 FROM users u WHERE u.id=profile_appearance.userId AND u.avatar<>? AND ${channelPermission('u', 'profile')} AND ${writableTarget('u')})`,
        )
        .bind(...eligibilityArgs, target, avatar, me, me, me, me),
    );
    try {
      const result = await d.batch(statements);
      if (!result.at(-1)?.meta.changes)
        throw new ApiError(409, 'Права доступа изменились. Обнови профиль.');
    } catch (e) {
      if (String(e).includes('UNIQUE'))
        throw new ApiError(409, 'Юзернейм занят. Изменения не сохранены.');
      throw e;
    }
    return Response.json(await profile(target, me));
  }
  if (action === 'support') {
    const amount = b.amount,
      key = clean(b.key, 100, true);
    if (
      !Number.isInteger(amount) ||
      Number(amount) < 1 ||
      Number(amount) > 10000
    )
      throw new ApiError(400, 'Выберите от 1 до 10 000 звёзд');
    const post = await d
      .prepare(
        'SELECT p.text,COALESCE(u.ownerId,u.id) AS recipient FROM posts p JOIN users u ON u.id=p.userId WHERE p.id=?',
      )
      .bind(id)
      .first<{ text: string; recipient: string }>();
    if (!post) throw new ApiError(404, 'Публикация не найдена');
    if (post.recipient === me)
      throw new ApiError(400, 'Нельзя поддержать себя');
    const transferId = 'support:' + me + ':' + key;
    const existing = await d
      .prepare('SELECT * FROM star_transfers WHERE id=?')
      .bind(transferId)
      .first();
    if (existing) {
      if (existing.amount !== amount || existing.postId !== id)
        throw new ApiError(
          409,
          'Этот запрос уже использован для другой операции',
        );
      return Response.json({ ok: true, balance: await balance(me) });
    }
    await ensureWallet(me);
    await ensureWallet(post.recipient);
    // One SQLite write statement checks the current ledger and debits/credits together.
    const result = await d
      .prepare(
        "INSERT INTO star_transfers(id,sender,recipient,postId,postText,amount,kind,created) SELECT ?,?,?,?,?,?,'support',? WHERE ? <= (SELECT COALESCE(SUM(CASE WHEN recipient=? THEN amount ELSE -amount END),0) FROM star_transfers WHERE recipient=? OR sender=?) AND ? + (SELECT COALESCE(SUM(amount),0) FROM star_transfers WHERE sender=? AND postId=? AND kind='support') <= 10000 ON CONFLICT(id) DO NOTHING",
      )
      .bind(
        transferId,
        me,
        post.recipient,
        id,
        post.text.slice(0, 120),
        amount,
        Date.now(),
        amount,
        me,
        me,
        me,
        amount,
        me,
        id,
      )
      .run();
    if (!result.meta.changes) {
      const retry = await d
        .prepare('SELECT amount,postId FROM star_transfers WHERE id=?')
        .bind(transferId)
        .first();
      if (retry && (retry.amount !== amount || retry.postId !== id))
        throw new ApiError(409, 'Запрос уже использован');
      if (!retry)
        throw new ApiError(
          409,
          'Недостаточно звёзд или достигнут лимит 10 000 на этот пост',
        );
    }
    return Response.json({ ok: true, balance: await balance(me) });
  }
  return null;
}
