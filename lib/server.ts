import { personalVisibility, contentPreference } from './privacy';
import {
  visibleAccount,
  restriction,
  blockingRestriction,
  isModerator,
} from './account-access';
import { db } from './storage';
import { ApiError } from './api-error';
import { identity } from './auth-session';
export { db, bucket } from './storage';
export { ApiError, failure } from './api-error';
export async function viewer(allowIncomplete = false) {
  const user = await identity();
  if (!user) throw new ApiError(401, 'Войдите, чтобы продолжить');
  const d = db();
  const existing = await d
    .prepare('SELECT id,onboardingComplete FROM users WHERE id=?')
    .bind(user.userId)
    .first();
  if (!existing && user.source === 'email')
    throw new ApiError(401, 'Войдите, чтобы продолжить');
  if (existing && !existing.onboardingComplete && !allowIncomplete)
    throw new ApiError(
      428,
      'Завершите настройку профиля',
      'ONBOARDING_REQUIRED',
    );
  if (!existing) {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    await d.batch([
      d
        .prepare('INSERT OR IGNORE INTO users (id,name,created) VALUES (?,?,?)')
        .bind(user.userId, user.fullName || 'Ночной житель', Date.now()),
      d
        .prepare(
          'INSERT OR IGNORE INTO handles (handle,userId,main) SELECT ?,?,1 WHERE NOT EXISTS (SELECT 1 FROM handles WHERE userId=?)',
        )
        .bind('user_' + suffix, user.userId, user.userId),
    ]);
  }
  await d
    .prepare('UPDATE users SET lastSeen=? WHERE id=? AND lastSeen<?')
    .bind(Date.now(), user.userId, Date.now() - 60000)
    .run();
  return user.userId;
}
export async function seed() {
  const d = db();
  await d.batch([
    d
      .prepare(
        "INSERT OR IGNORE INTO users (id,name,bio,created) VALUES ('noctgram','Noctgram','Обновления и жизнь Noctgram. Место для тех, кто на своей волне.',?)",
      )
      .bind(1788609600000),
    d.prepare(
      "INSERT OR IGNORE INTO handles (handle,userId,main) VALUES ('noctgram','noctgram',1)",
    ),
    d
      .prepare(
        "INSERT OR IGNORE INTO posts (id,userId,text,poll,created) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM content_removals WHERE targetType='post' AND targetId='welcome')",
      )
      .bind(
        'welcome',
        'noctgram',
        'У каждого времени суток есть своё настроение. У этой ночи теперь есть своё место.\n\nДелись мыслями, фотографиями и моментами. Начинай разговоры и находи своих. Добро пожаловать в Noctgram ☾',
        '[]',
        1788609600000,
      ),
    d
      .prepare(
        "INSERT OR IGNORE INTO posts (id,userId,text,poll,created) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM content_removals WHERE targetType='post' AND targetId='first-poll')",
      )
      .bind(
        'first-poll',
        'noctgram',
        'Что не даёт тебе уснуть?',
        [
          'Мысли обо всём',
          'Музыка и новые открытия',
          'Разговоры с близкими',
          'Просто люблю ночь',
        ].length
          ? JSON.stringify([
              'Мысли обо всём',
              'Музыка и новые открытия',
              'Разговоры с близкими',
              'Просто люблю ночь',
            ])
          : '[]',
        1788609500000,
      ),
  ]);
}
export function clean(value: unknown, max: number, required = false) {
  if (
    typeof value !== 'string' ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    throw new ApiError(400, 'Проверьте заполненные поля');
  return value.trim();
}
export async function profile(id: string, me: string) {
  const d = db();
  const user = await d
    .prepare(
      `SELECT *, (SELECT id FROM posts WHERE userId=users.id AND pinned=1 LIMIT 1) as pinnedPostId, (SELECT handle FROM handles WHERE userId=users.id AND main=1 LIMIT 1) as handle, (SELECT COUNT(*) FROM follows f JOIN users fu ON fu.id=f.follower WHERE f.following=users.id AND ${visibleAccount('fu')}) as followers, (SELECT COUNT(*) FROM follows f JOIN users fu ON fu.id=f.following WHERE f.follower=users.id AND ${visibleAccount('fu')}) as following, (SELECT COUNT(*) FROM posts WHERE userId=users.id) as postCount, EXISTS(SELECT 1 FROM follows WHERE follower=? AND following=users.id) as followed FROM users WHERE id=?`,
    )
    .bind(me, id)
    .first();
  if (!user) throw new ApiError(404, 'Профиль не найден');
  if (!user.onboardingComplete && id !== me)
    throw new ApiError(404, 'Профиль не найден');
  const hs = await d
    .prepare(
      'SELECT handle FROM handles WHERE userId=? ORDER BY main DESC,handle',
    )
    .bind(id)
    .all();
  if (id !== me) {
    const blocked = await blockingRestriction(id);
    if (blocked)
      return {
        id,
        name:
          user.kind === 'channel'
            ? 'Канал заблокирован'
            : 'Аккаунт заблокирован',
        handle: user.handle,
        kind: user.kind,
        avatar: '',
        cover: '',
        bio: '',
        handles: [],
        created: user.created,
        followers: 0,
        following: 0,
        postCount: 0,
        followed: 0,
        lastSeen: 0,
        blocked: true,
        blockedAt: blocked.created,
        ...(user.ownerId === me
          ? { ownerId: me, restriction: await restriction(id) }
          : {}),
      };
  }
  const own = id === me;
  return {
    ...user,
    handles: hs.results.map((h) => h.handle),
    ...(user.ownerId === me ? { restriction: await restriction(id) } : {}),
    ...(own
      ? {
          restriction: await restriction(me),
          canModerate: await isModerator(me),
          appeal: await d
            .prepare(
              'SELECT a.id,a.eventId,a.status,a.text,a.reviewNote,a.created FROM moderation_appeals a WHERE a.userId=? ORDER BY a.created DESC LIMIT 1',
            )
            .bind(me)
            .first(),
        }
      : {}),
  };
}
export async function feed(
  me: string,
  mode: string,
  q: string,
  user: string,
  before: number,
  postId = '',
  mediaOnly = false,
  afterId = '',
) {
  const d = db();
  let where = '(p.created < ? OR (p.created=? AND p.id<?))';
  const args: unknown[] = [me, me, me, me, me, before, before, afterId];
  if (postId) {
    where = 'p.id=?';
    args.splice(5, 3, postId);
  }
  if (!postId) {
    where +=
      ' AND NOT EXISTS (SELECT 1 FROM hidden_posts WHERE postId=p.id AND userId=?)';
    args.push(me);
  }
  if (mediaOnly) where += " AND p.media <> '[]'";
  if (mode === 'following') {
    where +=
      ' AND (p.userId=? OR u.ownerId=? OR EXISTS(SELECT 1 FROM follows WHERE follower=? AND following=p.userId))';
    args.push(me, me, me);
  }
  if (mode === 'saved') {
    where +=
      ' AND EXISTS(SELECT 1 FROM bookmarks WHERE userId=? AND postId=p.id)';
    args.push(me);
  }
  if (user) {
    where += ' AND p.userId=?';
    args.push(user);
  }
  if (q) {
    where += ' AND (p.text LIKE ? OR u.name LIKE ? OR h.handle LIKE ?)';
    args.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
  }
  where +=
    ' AND ' +
    visibleAccount('u') +
    ' AND ' +
    personalVisibility('u') +
    ' AND ' +
    contentPreference('p');
  args.push(me, me);
  const rows = await d
    .prepare(
      `SELECT p.*,u.name,u.avatar,u.ownerId,u.kind,h.handle,(SELECT COUNT(*) FROM post_views WHERE postId=p.id) as views,(SELECT COALESCE(SUM(amount),0) FROM star_transfers WHERE postId=p.id AND kind='support') as stars,(SELECT COALESCE(SUM(amount),0) FROM star_transfers WHERE postId=p.id AND sender=? AND kind='support') as mySupport,(SELECT COUNT(*) FROM likes WHERE postId=p.id) as likes,(SELECT COUNT(*) FROM comments c JOIN users cu ON cu.id=c.userId WHERE c.postId=p.id AND ${visibleAccount('cu')} AND ${personalVisibility('cu')}) as comments,EXISTS(SELECT 1 FROM likes WHERE postId=p.id AND userId=?) as liked,EXISTS(SELECT 1 FROM bookmarks WHERE postId=p.id AND userId=?) as saved,(SELECT option FROM votes WHERE postId=p.id AND userId=?) as voted FROM posts p JOIN users u ON u.id=p.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE ${where} ORDER BY p.created DESC,p.id DESC LIMIT 30`,
    )
    .bind(...args)
    .all();
  return Promise.all(
    rows.results.map(async (p) => {
      const v = await d
        .prepare(
          'SELECT option,COUNT(*) as count FROM votes WHERE postId=? GROUP BY option',
        )
        .bind(p.id)
        .all();
      return {
        ...p,
        media: JSON.parse(String(p.media)),
        poll: JSON.parse(String(p.poll)),
        votes: v.results,
      };
    }),
  );
}
