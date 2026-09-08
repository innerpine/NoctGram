import { telegramGet, telegramPost } from '@/lib/telegram';
import { boostsGet, boostsPost } from '@/lib/boosts';
import { administrationGet, administrationPost } from '@/lib/administration';
import { socialRateLimit } from '@/lib/rate-limit';
import { premiumGet, premiumPost } from '@/lib/premium';
import { appearanceColumns } from '@/lib/premium-access';
import { assertMediaRead, mediaPermission } from '@/lib/media-access';
import { callsGet, callsPost } from '@/lib/calls';
import { notificationsGet, notificationsPost } from '@/lib/notifications';
import {
  channelFeatureGet,
  channelFeaturePost,
  scheduleTime,
} from '@/lib/channel-features';
import { storiesGet, storiesPost } from '@/lib/stories';
import {
  published,
  allowed,
  channelPermission,
  writableTarget,
} from '@/lib/channel-access';
import {
  privacyGet,
  privacyPost,
  personalVisibility,
  contentPreference,
  assertCanInteract,
  sendPrivateMessage,
} from '@/lib/privacy';
import { moderationGet, moderationPost } from '@/lib/moderation';
import { readJsonBody } from '@/lib/request-body';
import {
  visibleAccount,
  restriction,
  assertReadable,
  assertWritable,
  assertAccountVisible,
  assertPostVisible,
  assertUploadAvailable,
} from '@/lib/account-access';
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
import { featureGet, featurePost, canPublish } from '@/lib/social-features';
import { readConversation, pinMessage } from '@/lib/chat-messages';
import {
  deleteMessages,
  editMessage,
  forwardMessages,
} from '@/lib/chat-actions';
import { messageVisible } from '@/lib/chat-access';
import { readChatTheme, saveChatTheme } from '@/lib/chat-theme-settings';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const me = await viewer();
    await seed();
    const s = new URL(req.url).searchParams;
    const action = s.get('action') || 'feed';
    const administration = await administrationGet(action, s, me);
    if (administration) return administration;
    const moderation = await moderationGet(action, s, me);
    if (moderation) return moderation;
    if (action === 'bootstrap' && (await restriction(me))?.mode === 'blocked')
      return Response.json({
        me: await profile(me, me),
        people: [],
        posts: [],
      });
    await assertReadable(me);
    const telegram = await telegramGet(action, me);
    if (telegram) return telegram;
    const premium = await premiumGet(action, me);
    if (premium) return premium;
    const boosts = await boostsGet(action, s, me);
    if (boosts) return boosts;
    const d = db();
    const realtime =
      (await callsGet(action, s, me)) || (await notificationsGet(action, me));
    if (realtime) return realtime;
    const privacy = await privacyGet(action, s, me);
    if (privacy) return privacy;
    const extended =
      (await channelFeatureGet(action, s, me)) ||
      (await storiesGet(action, s, me));
    if (extended) return extended;
    const feature = await featureGet(action, s, me);
    if (feature) return feature;
    if (action === 'bootstrap') {
      const people = await d
        .prepare(
          `SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle,EXISTS(SELECT 1 FROM follows WHERE follower=? AND following=u.id) as followed FROM users u JOIN handles h ON h.userId=u.id AND h.main=1 WHERE ${visibleAccount('u')} AND ${personalVisibility('u')} AND u.kind='person' AND u.id<>? ORDER BY u.created DESC LIMIT 15`,
        )
        .bind(me, me, me)
        .all();
      return Response.json({
        me: await profile(me, me),
        people: people.results,
        posts: await feed(me, 'all', '', '', Date.now() + 1),
      });
    }
    if (action === 'post') {
      const result = await feed(
        me,
        'all',
        '',
        '',
        Date.now() + 1,
        s.get('id') || 'missing',
      );
      if (!result[0]) throw new ApiError(404, 'Публикация не найдена');
      return Response.json(result[0]);
    }
    if (action === 'topics') {
      const rows = await d
        .prepare(
          `SELECT p.text FROM posts p JOIN users u ON u.id=p.userId WHERE ${published('p')} AND ${visibleAccount('u')} AND ${personalVisibility('u')} AND ${contentPreference('p')} AND NOT EXISTS (SELECT 1 FROM hidden_posts WHERE postId=p.id AND userId=?) ORDER BY p.created DESC LIMIT 500`,
        )
        .bind(me, me, me)
        .all<{ text: string }>();
      const counts = new Map<string, number>();
      for (const row of rows.results)
        for (const tag of new Set(row.text.match(/#[\p{L}\p{N}_]+/gu) || [])) {
          const key = tag.toLowerCase();
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      return Response.json(
        [...counts]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([tag, count]) => ({ tag, count })),
      );
    }
    if (action === 'profile') {
      let id = s.get('id') || me;
      if (s.has('handle')) {
        const handle = (s.get('handle') || '').replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_]{4,24}$/.test(handle))
          throw new ApiError(404, 'Профиль не найден');
        const row = await d
          .prepare('SELECT userId FROM handles WHERE handle=?')
          .bind(handle)
          .first<{ userId: string }>();
        if (!row) throw new ApiError(404, 'Профиль не найден');
        id = row.userId;
      }
      return Response.json(await profile(id, me));
    }
    if (action === 'feed')
      return Response.json(
        await feed(
          me,
          s.get('mode') || 'all',
          (s.get('q') || '').slice(0, 200),
          s.get('user') || '',
          Number(s.get('before')) || Date.now() + 1,
          '',
          s.get('media') === '1',
          s.get('afterId') || '',
        ),
      );
    if (action === 'people') {
      const q = (s.get('q') || '').replace(/^@/, '').slice(0, 100);
      return Response.json(
        (
          await d
            .prepare(
              `SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle FROM users u JOIN handles h ON h.userId=u.id AND h.main=1 WHERE ${visibleAccount('u')} AND ${personalVisibility('u')} AND u.kind='person' AND u.id<>? AND (u.name LIKE ? OR h.handle LIKE ? OR EXISTS(SELECT 1 FROM handles WHERE userId=u.id AND handle LIKE ?)) LIMIT 30`,
            )
            .bind(me, me, '%' + q + '%', '%' + q + '%', '%' + q + '%')
            .all()
        ).results,
      );
    }
    if (action === 'comments') {
      if (
        !(await d
          .prepare('SELECT id FROM posts WHERE id=?')
          .bind(s.get('post') || '')
          .first())
      )
        return Response.json([]);
      await assertPostVisible(s.get('post') || '', me);
      return Response.json(
        (
          await d
            .prepare(
              `SELECT * FROM (SELECT c.*,u.name,u.avatar,${appearanceColumns('u')},h.handle FROM comments c JOIN users u ON u.id=c.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE ${visibleAccount('u')} AND ${personalVisibility('u')} AND c.postId=? AND (c.created<? OR (c.created=? AND c.id<?)) ORDER BY c.created DESC,c.id DESC LIMIT 50) ORDER BY created,id`,
            )
            .bind(
              me,
              s.get('post') || '',
              Number(s.get('before')) || Date.now() + 1,
              Number(s.get('before')) || Date.now() + 1,
              s.get('beforeId') || '',
            )
            .all()
        ).results,
      );
    }
    if (action === 'threads') {
      return Response.json(
        (
          await d
            .prepare(
              `WITH visible_messages AS (SELECT m.* FROM messages m WHERE (m.sender=? OR m.recipient=?) AND ${messageVisible('m', '?')})
              SELECT u.id,u.name,u.avatar,${appearanceColumns('u')},h.handle,(SELECT CASE WHEN text<>'' THEN text WHEN json_array_length(media)>0 THEN CASE json_extract(media,'$[0].kind') WHEN 'image' THEN 'Фото' WHEN 'video' THEN 'Видео' ELSE 'Файл: '||json_extract(media,'$[0].name') END ELSE text END FROM visible_messages WHERE (sender=? AND recipient=u.id) OR (sender=u.id AND recipient=?) ORDER BY created DESC,id DESC LIMIT 1) as lastText,(SELECT MAX(created) FROM visible_messages WHERE (sender=? AND recipient=u.id) OR (sender=u.id AND recipient=?)) as lastTime,(SELECT COUNT(*) FROM visible_messages WHERE sender=u.id AND recipient=? AND read=0) as unread FROM users u JOIN handles h ON h.userId=u.id AND h.main=1 WHERE ${visibleAccount('u')} AND EXISTS(SELECT 1 FROM visible_messages WHERE (sender=? AND recipient=u.id) OR (sender=u.id AND recipient=?)) ORDER BY lastTime DESC LIMIT 100`,
            )
            .bind(me, me, me, me, me, me, me, me, me, me)
            .all()
        ).results,
      );
    }
    if (action === 'messages') {
      const peer = s.get('peer') || '';
      await assertAccountVisible(peer);
      if (s.get('includeTheme') === '1') {
        const [messages, theme] = await Promise.all([
          readConversation(me, peer, s.get('focus') || ''),
          readChatTheme(me, peer),
        ]);
        return Response.json({ messages, theme });
      }
      return Response.json(
        await readConversation(me, peer, s.get('focus') || ''),
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
    if (Number(req.headers.get('content-length')) > 64000)
      throw new ApiError(413, 'Слишком большой запрос');
    const b = await readJsonBody(req, 64000);
    const me = await viewer();
    const d = db();
    const action = typeof b.action === 'string' ? b.action : '';
    await socialRateLimit(me, action);
    const administration = await administrationPost(action, b, me);
    if (administration) return administration;
    if (action === 'chatTheme')
      return Response.json(await saveChatTheme(me, b));
    const telegram = await telegramPost(action, b, me);
    if (telegram) return telegram;
    const call = await callsPost(action, b, me);
    if (call) return call;
    const premium = await premiumPost(String(action), b, me);
    if (premium) return premium;
    const boosts = await boostsPost(String(action), b, me);
    if (boosts) return boosts;
    const notification = await notificationsPost(action, b, me);
    if (notification) return notification;
    const privacy = await privacyPost(action, b, me);
    if (privacy) return privacy;
    const story = await storiesPost(action, b, me);
    if (story) return story;
    const moderation = await moderationPost(action, b, me);
    if (moderation) return moderation;
    if (action === 'view') await assertReadable(me);
    else await assertWritable(me);
    if (action === 'messagePin') return Response.json(await pinMessage(me, b));
    if (action === 'messageDelete')
      return Response.json(await deleteMessages(me, b));
    if (action === 'messageEdit')
      return Response.json(await editMessage(me, b));
    if (action === 'messageForward')
      return Response.json(await forwardMessages(me, b));
    if (
      [
        'pin',
        'hide',
        'report',
        'like',
        'save',
        'comment',
        'vote',
        'support',
        'view',
      ].includes(action)
    )
      await assertPostVisible(typeof b.id === 'string' ? b.id : '', me);
    const channel = await channelFeaturePost(action, b, me);
    if (channel) return channel;
    const feature = await featurePost(action, b, me);
    if (feature) return feature;
    const id = typeof b.id === 'string' ? b.id : '';
    if (action === 'deleteComment') {
      const result = await d
        .prepare('DELETE FROM comments WHERE id=? AND userId=?')
        .bind(id, me)
        .run();
      if (!result.meta.changes)
        throw new ApiError(403, 'Можно удалить только свой комментарий');
      return Response.json({ ok: true });
    }
    if (['pin', 'hide'].includes(String(action))) {
      const post = await d
        .prepare('SELECT userId FROM posts WHERE id=?')
        .bind(id)
        .first();
      if (!post) throw new ApiError(404, 'Публикация не найдена');
      if (action === 'pin') {
        if (!(await allowed(String(post.userId), me, 'manage')))
          throw new ApiError(403, 'Можно закрепить только свою публикацию');
        const result = await d
          .prepare(
            `UPDATE posts SET pinned=CASE WHEN id=? THEN ? ELSE 0 END WHERE userId=? AND EXISTS(SELECT 1 FROM users u WHERE u.id=posts.userId AND ${channelPermission('u', 'manage')} AND ${writableTarget('u')})`,
          )
          .bind(id, b.value ? 1 : 0, post.userId, me, me, me, me)
          .run();
        if (!result.meta.changes)
          throw new ApiError(409, 'Права доступа изменились');
      } else if (action === 'hide') {
        if (b.value)
          await d
            .prepare(
              'INSERT OR IGNORE INTO hidden_posts(postId,userId) VALUES(?,?)',
            )
            .bind(id, me)
            .run();
        else
          await d
            .prepare('DELETE FROM hidden_posts WHERE postId=? AND userId=?')
            .bind(id, me)
            .run();
      }
      return Response.json({ ok: true });
    }
    if (action === 'handle') {
      const handle = clean(b.handle, 25, true).toLowerCase().replace(/^@/, '');
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
      const text = clean(b.text || '', 5000);
      const author = typeof b.as === 'string' && b.as ? b.as : me;
      if (!(await canPublish(author, me)))
        throw new ApiError(403, 'Публиковать в канале может только владелец');
      if (
        b.code !== undefined &&
        (typeof b.code !== 'string' || b.code.length > 20000)
      )
        throw new ApiError(400, 'Блок кода — до 20 000 символов');
      const code = typeof b.code === 'string' ? b.code : '';
      const codeLang = clean(b.codeLang || 'text', 24) || 'text';
      const postId = crypto.randomUUID();
      const media = Array.isArray(b.media) ? b.media : [];
      const poll = Array.isArray(b.poll)
        ? b.poll.map((x) => clean(x, 100, true))
        : [];
      if (
        media.length > 4 ||
        poll.length > 6 ||
        (poll.length > 0 && poll.length < 2) ||
        (!text && !media.length && !code.trim()) ||
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
        await assertUploadAvailable(entry);
        await assertMediaRead(entry, me, me);
        verified.push(item);
      }
      const publishAt = scheduleTime(b.publishAt);
      const inserted = await d
        .prepare(
          `WITH input AS (SELECT ? AS actor,? AS media) INSERT INTO posts (id,userId,text,media,poll,code,codeLang,adult,created,publishAt,publisherId,notifyPending) SELECT ?,u.id,?,?,?,?,?,?,?,?,?,1 FROM users u,input i WHERE u.id=? AND ${channelPermission('u')} AND ${writableTarget('u')} AND NOT EXISTS(SELECT 1 FROM json_each(i.media) j WHERE NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=j.value AND up.userId=i.actor AND ${mediaPermission('up.id', 'i.actor')}))`,
        )
        .bind(
          me,
          JSON.stringify(media),
          postId,
          text,
          JSON.stringify(verified),
          JSON.stringify(poll),
          code,
          codeLang,
          b.adult === true && media.length > 0 ? 1 : 0,
          publishAt || Date.now(),
          publishAt,
          me,
          author,
          me,
          me,
          me,
          me,
        )
        .run();
      if (!inserted.meta.changes)
        throw new ApiError(403, 'Права публикации изменились');
      return Response.json({ ok: true, id: postId, publishAt });
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
        if (!(await allowed(String(p.userId), me, 'manage')))
          throw new ApiError(403, 'Можно удалить только свою публикацию');
        const result = await d
          .prepare(
            `DELETE FROM posts WHERE id=? AND EXISTS(SELECT 1 FROM users u WHERE u.id=posts.userId AND ${channelPermission('u', 'manage')} AND ${writableTarget('u')})`,
          )
          .bind(id, me, me, me, me)
          .run();
        if (!result.meta.changes)
          throw new ApiError(409, 'Права доступа изменились');
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
        const commentId = crypto.randomUUID();
        await d
          .prepare(
            'INSERT INTO comments (id,postId,userId,text,created) VALUES (?,?,?,?,?)',
          )
          .bind(commentId, id, me, clean(b.text, 2000, true), Date.now())
          .run();
        return Response.json(
          await d
            .prepare(
              `SELECT c.*,u.name,u.avatar,${appearanceColumns('u')},h.handle FROM comments c JOIN users u ON u.id=c.userId LEFT JOIN handles h ON h.userId=u.id AND h.main=1 WHERE c.id=?`,
            )
            .bind(commentId)
            .first(),
        );
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
      await assertAccountVisible(id);
      if (b.value) await assertCanInteract(me, id);
      if (
        id === me ||
        !(await d.prepare('SELECT id FROM users WHERE id=?').bind(id).first())
      )
        throw new ApiError(400, 'Выберите другой профиль');
      if (b.value) {
        await d
          .prepare(`INSERT OR IGNORE INTO follows (follower,following)
            SELECT ?,u.id FROM users u WHERE u.id=? AND NOT EXISTS(SELECT 1 FROM user_blocks pb
            WHERE (pb.blocker=? AND pb.blocked IN(u.id,u.ownerId)) OR (pb.blocker IN(u.id,u.ownerId) AND pb.blocked=?))`)
          .bind(me, id, me, me)
          .run();
        await assertCanInteract(me, id);
      } else
        await d
          .prepare('DELETE FROM follows WHERE follower=? AND following=?')
          .bind(me, id)
          .run();
      return Response.json({ ok: true });
    }
    if (action === 'message') {
      await assertAccountVisible(id);
      if (
        id === me ||
        id === 'noctgram' ||
        !(await d
          .prepare("SELECT id FROM users WHERE id=? AND kind='person'")
          .bind(id)
          .first())
      )
        throw new ApiError(400, 'Выберите участника для личного диалога');
      return Response.json(
        await sendPrivateMessage(
          me,
          id,
          clean(b.text || '', 4000),
          b.attachments ?? [],
          b.key,
          b.replyTo ?? null,
        ),
      );
    }
    throw new ApiError(400, 'Неизвестное действие');
  } catch (e) {
    // Early Origin/size rejection must not strand a small POST body in the
    // local Worker proxy's keep-alive connection.
    if (req.body && !req.body.locked && !req.bodyUsed)
      await readJsonBody(req, 64000).catch(() => {});
    return failure(e);
  }
}
