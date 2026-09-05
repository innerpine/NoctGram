import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export function db() {
  return (env as unknown as { DB: D1Database }).DB;
}
export function bucket() {
  return (env as unknown as { FILES: R2Bucket }).FILES;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function viewer() {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError(401, 'Войдите, чтобы продолжить');
  const d = db();
  const existing = await d
    .prepare('SELECT id FROM users WHERE id=?')
    .bind(user.userId)
    .first();
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
        'INSERT OR IGNORE INTO posts (id,userId,text,poll,created) VALUES (?,?,?,?,?)',
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
        'INSERT OR IGNORE INTO posts (id,userId,text,poll,created) VALUES (?,?,?,?,?)',
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
export function failure(e: unknown) {
  if (e instanceof ApiError)
    return Response.json({ error: e.message }, { status: e.status });
  console.error(e instanceof Error ? e.message : 'API failure');
  return Response.json(
    { error: 'Не удалось сохранить изменения. Попробуйте ещё раз.' },
    { status: 500 },
  );
}
export async function profile(id: string, me: string) {
  const d = db();
  const user = await d
    .prepare(
      'SELECT *, (SELECT handle FROM handles WHERE userId=users.id AND main=1 LIMIT 1) as handle, (SELECT COUNT(*) FROM follows WHERE following=users.id) as followers, (SELECT COUNT(*) FROM follows WHERE follower=users.id) as following, (SELECT COUNT(*) FROM posts WHERE userId=users.id) as postCount, EXISTS(SELECT 1 FROM follows WHERE follower=? AND following=users.id) as followed FROM users WHERE id=?',
    )
    .bind(me, id)
    .first();
  if (!user) throw new ApiError(404, 'Профиль не найден');
  const hs = await d
    .prepare(
      'SELECT handle FROM handles WHERE userId=? ORDER BY main DESC,handle',
    )
    .bind(id)
    .all();
  return { ...user, handles: hs.results.map((h) => h.handle) };
}
export async function feed(
  me: string,
  mode: string,
  q: string,
  user: string,
  before: number,
) {
  const d = db();
  let where = 'p.created < ?';
  const args: unknown[] = [me, me, me, before];
  if (mode === 'following') {
    where +=
      ' AND (p.userId=? OR EXISTS(SELECT 1 FROM follows WHERE follower=? AND following=p.userId))';
    args.push(me, me);
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
  const rows = await d
    .prepare(
      `SELECT p.*,u.name,u.avatar,h.handle,(SELECT COUNT(*) FROM likes WHERE postId=p.id) as likes,(SELECT COUNT(*) FROM comments WHERE postId=p.id) as comments,EXISTS(SELECT 1 FROM likes WHERE postId=p.id AND userId=?) as liked,EXISTS(SELECT 1 FROM bookmarks WHERE postId=p.id AND userId=?) as saved,(SELECT option FROM votes WHERE postId=p.id AND userId=?) as voted FROM posts p JOIN users u ON u.id=p.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE ${where} ORDER BY p.created DESC LIMIT 30`,
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
