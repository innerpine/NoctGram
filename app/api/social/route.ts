import {
  db,
  viewer,
  seed,
  profile,
  feed,
  clean,
  ApiError,
  failure,
} from '@/lib/server';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const me = await viewer();
    await seed();
    const s = new URL(req.url).searchParams;
    const action = s.get('action') || 'feed';
    const d = db();
    if (action === 'bootstrap') {
      const people = await d
        .prepare(
          'SELECT u.id,u.name,u.avatar,h.handle,EXISTS(SELECT 1 FROM follows WHERE follower=? AND following=u.id) as followed FROM users u JOIN handles h ON h.userId=u.id AND h.main=1 WHERE u.id<>? ORDER BY u.created DESC LIMIT 15',
        )
        .bind(me, me)
        .all();
      return Response.json({
        me: await profile(me, me),
        people: people.results,
        posts: await feed(me, 'all', '', '', Date.now() + 1),
      });
    }
    if (action === 'profile')
      return Response.json(await profile(s.get('id') || me, me));
    if (action === 'feed')
      return Response.json(
        await feed(
          me,
          s.get('mode') || 'all',
          (s.get('q') || '').slice(0, 200),
          s.get('user') || '',
          Number(s.get('before')) || Date.now() + 1,
        ),
      );
    if (action === 'people') {
      const q = (s.get('q') || '').replace(/^@/, '').slice(0, 100);
      return Response.json(
        (
          await d
            .prepare(
              'SELECT u.id,u.name,u.avatar,h.handle FROM users u JOIN handles h ON h.userId=u.id AND h.main=1 WHERE u.id<>? AND (u.name LIKE ? OR h.handle LIKE ? OR EXISTS(SELECT 1 FROM handles WHERE userId=u.id AND handle LIKE ?)) LIMIT 30',
            )
            .bind(me, '%' + q + '%', '%' + q + '%', '%' + q + '%')
            .all()
        ).results,
      );
    }
    if (action === 'comments')
      return Response.json(
        (
          await d
            .prepare(
              'SELECT c.*,u.name,u.avatar,h.handle FROM comments c JOIN users u ON u.id=c.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE c.postId=? ORDER BY c.created LIMIT 200',
            )
            .bind(s.get('post') || '')
            .all()
        ).results,
      );
    if (action === 'threads') {
      return Response.json(
        (
          await d
            .prepare(
              'SELECT u.id,u.name,u.avatar,h.handle,(SELECT text FROM messages WHERE (sender=? AND recipient=u.id) OR (sender=u.id AND recipient=?) ORDER BY created DESC LIMIT 1) as lastText,(SELECT MAX(created) FROM messages WHERE (sender=? AND recipient=u.id) OR (sender=u.id AND recipient=?)) as lastTime,(SELECT COUNT(*) FROM messages WHERE sender=u.id AND recipient=? AND read=0) as unread FROM users u JOIN handles h ON h.userId=u.id AND h.main=1 WHERE EXISTS(SELECT 1 FROM messages WHERE (sender=? AND recipient=u.id) OR (sender=u.id AND recipient=?)) ORDER BY lastTime DESC LIMIT 100',
            )
            .bind(me, me, me, me, me, me, me)
            .all()
        ).results,
      );
    }
    if (action === 'messages') {
      const peer = s.get('peer') || '';
      await d
        .prepare('UPDATE messages SET read=1 WHERE sender=? AND recipient=?')
        .bind(peer, me)
        .run();
      return Response.json(
        (
          await d
            .prepare(
              'SELECT * FROM (SELECT * FROM messages WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?) ORDER BY created DESC LIMIT 300) ORDER BY created',
            )
            .bind(me, peer, peer, me)
            .all()
        ).results,
      );
    }
    throw new ApiError(404, 'Не найдено');
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin)
      throw new ApiError(403, 'Недопустимый источник запроса');
    const me = await viewer();
    const d = db();
    if (Number(req.headers.get('content-length')) > 64000)
      throw new ApiError(413, 'Слишком большой запрос');
    const b = (await req.json()) as Record<string, unknown>;
    const action = b.action;
    const id = typeof b.id === 'string' ? b.id : '';
    if (action === 'profile') {
      const name = clean(b.name, 40, true),
        bio = clean(b.bio, 300);
      for (const k of ['avatar', 'cover']) {
        const v = clean(b[k] || '', 200);
        if (
          v &&
          !(await d
            .prepare(
              'SELECT id FROM uploads WHERE id=? AND userId=? AND type LIKE ?',
            )
            .bind(v.replace('/api/media/', ''), me, 'image/%')
            .first())
        )
          throw new ApiError(400, 'Изображение не найдено');
      }
      await d
        .prepare('UPDATE users SET name=?,bio=?,avatar=?,cover=? WHERE id=?')
        .bind(name, bio, b.avatar || '', b.cover || '', me)
        .run();
      return Response.json(await profile(me, me));
    }
    if (action === 'handle') {
      const handle = clean(b.handle, 24, true).toLowerCase().replace(/^@/, '');
      if (!/^[a-z][a-z0-9_]{3,23}$/.test(handle))
        throw new ApiError(
          400,
          'Юзернейм: 4–24 латинских символа, цифры и _. Начните с буквы.',
        );
      if (
        ['admin', 'support', 'system', 'noctgram', 'premium'].includes(handle)
      )
        throw new ApiError(409, 'Этот юзернейм недоступен');
      const taken = await d
        .prepare('SELECT userId FROM handles WHERE handle=?')
        .bind(handle)
        .first();
      if (taken && taken.userId !== me)
        throw new ApiError(409, 'Этот юзернейм уже занят');
      const count = await d
        .prepare('SELECT COUNT(*) as n FROM handles WHERE userId=?')
        .bind(me)
        .first();
      if (!taken && Number(count?.n) >= 5)
        throw new ApiError(400, 'Можно добавить до пяти юзернеймов');
      try {
        // Batch is atomic: a concurrent claimant cannot clear the old main handle.
        await d.batch([
          ...(!taken
            ? [
                d
                  .prepare(
                    'INSERT INTO handles (handle,userId,main) SELECT ?,?,0 WHERE (SELECT COUNT(*) FROM handles WHERE userId=?) < 5',
                  )
                  .bind(handle, me, me),
              ]
            : []),
          d
            .prepare(
              'UPDATE handles SET main=CASE WHEN handle=? THEN 1 ELSE 0 END WHERE userId=? AND EXISTS (SELECT 1 FROM handles WHERE handle=? AND userId=?)',
            )
            .bind(handle, me, handle, me),
        ]);
      } catch {
        throw new ApiError(409, 'Юзернейм занят. Выберите другой.');
      }
      if (
        !(await d
          .prepare('SELECT handle FROM handles WHERE handle=? AND userId=?')
          .bind(handle, me)
          .first())
      )
        throw new ApiError(400, 'Можно добавить до пяти юзернеймов');
      return Response.json(await profile(me, me));
    }
    if (action === 'removeHandle') {
      const h = clean(b.handle, 24, true);
      await d
        .prepare('DELETE FROM handles WHERE handle=? AND userId=? AND main=0')
        .bind(h, me)
        .run();
      return Response.json(await profile(me, me));
    }
    if (action === 'post') {
      const text = clean(b.text, 5000);
      const media = Array.isArray(b.media) ? b.media : [];
      const poll = Array.isArray(b.poll)
        ? b.poll.map((x) => clean(x, 100, true))
        : [];
      if (
        media.length > 4 ||
        poll.length > 6 ||
        (poll.length > 0 && poll.length < 2) ||
        (!text && !media.length) ||
        (poll.length && !text) ||
        (poll.length && media.length)
      )
        throw new ApiError(
          400,
          'Добавьте текст, до 4 файлов или опрос с 2–6 ответами',
        );
      const verified = [];
      for (const entry of media) {
        if (typeof entry !== 'string') throw new ApiError(400, 'Неверный файл');
        const item = await d
          .prepare('SELECT id,type,name FROM uploads WHERE id=? AND userId=?')
          .bind(entry, me)
          .first();
        if (!item) throw new ApiError(400, 'Файл не найден');
        verified.push(item);
      }
      await d
        .prepare(
          'INSERT INTO posts (id,userId,text,media,poll,created) VALUES (?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          me,
          text,
          JSON.stringify(verified),
          JSON.stringify(poll),
          Date.now(),
        )
        .run();
      return Response.json({ ok: true });
    }
    if (
      ['like', 'save', 'comment', 'vote', 'delete'].includes(String(action))
    ) {
      const p = await d
        .prepare('SELECT userId,poll FROM posts WHERE id=?')
        .bind(id)
        .first();
      if (!p) throw new ApiError(404, 'Публикация не найдена');
      if (action === 'delete') {
        if (p.userId !== me)
          throw new ApiError(403, 'Можно удалить только свою публикацию');
        await d.prepare('DELETE FROM posts WHERE id=?').bind(id).run();
      } else if (action === 'like' || action === 'save') {
        const table = action === 'like' ? 'likes' : 'bookmarks';
        if (b.value)
          await d
            .prepare(
              `INSERT OR IGNORE INTO ${table} (postId,userId) VALUES (?,?)`,
            )
            .bind(id, me)
            .run();
        else
          await d
            .prepare(`DELETE FROM ${table} WHERE postId=? AND userId=?`)
            .bind(id, me)
            .run();
      } else if (action === 'comment') {
        await d
          .prepare(
            'INSERT INTO comments (id,postId,userId,text,created) VALUES (?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            id,
            me,
            clean(b.text, 2000, true),
            Date.now(),
          )
          .run();
      } else {
        const options = JSON.parse(String(p.poll));
        if (
          !Number.isInteger(b.option) ||
          Number(b.option) < 0 ||
          Number(b.option) >= options.length
        )
          throw new ApiError(400, 'Выберите вариант');
        await d
          .prepare(
            'INSERT INTO votes (postId,userId,option) VALUES (?,?,?) ON CONFLICT(postId,userId) DO UPDATE SET option=excluded.option',
          )
          .bind(id, me, b.option)
          .run();
      }
      return Response.json({ ok: true });
    }
    if (action === 'follow') {
      if (
        id === me ||
        !(await d.prepare('SELECT id FROM users WHERE id=?').bind(id).first())
      )
        throw new ApiError(400, 'Выберите другой профиль');
      if (b.value)
        await d
          .prepare(
            'INSERT OR IGNORE INTO follows (follower,following) VALUES (?,?)',
          )
          .bind(me, id)
          .run();
      else
        await d
          .prepare('DELETE FROM follows WHERE follower=? AND following=?')
          .bind(me, id)
          .run();
      return Response.json({ ok: true });
    }
    if (action === 'message') {
      if (
        id === me ||
        id === 'noctgram' ||
        !(await d.prepare('SELECT id FROM users WHERE id=?').bind(id).first())
      )
        throw new ApiError(400, 'Выберите участника для личного диалога');
      await d
        .prepare(
          'INSERT INTO messages (id,sender,recipient,text,created) VALUES (?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          me,
          id,
          clean(b.text, 4000, true),
          Date.now(),
        )
        .run();
      return Response.json({ ok: true });
    }
    throw new ApiError(400, 'Неизвестное действие');
  } catch (e) {
    return failure(e);
  }
}
