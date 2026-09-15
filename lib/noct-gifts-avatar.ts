import { ApiError } from './api-error';
import { bucket, db } from './storage';
import { avatarVariantKey } from './avatar-variants';
import { noctGiftsIdentity, noctGiftsLinkedUser } from './noct-gifts-account';

// Telegram WebViews do not have the website's email-session cookie. Serve only
// this verified, linked user's current profile image, never an arbitrary file ID.
export async function noctGiftsAvatar(body: Record<string, unknown>) {
  const auth = await noctGiftsIdentity(body.initData);
  const me = auth.user;
  if (!me)
    throw new ApiError(
      409,
      'Сначала привяжите Telegram к NoctGram.',
      'TELEGRAM_NOT_LINKED',
    );
  const id = /^\/api\/media\/([a-zA-Z0-9_-]+)$/.exec(me.avatar)?.[1];
  if (!id) throw new ApiError(404, 'Аватар не найден');
  const upload = await db()
    .prepare(`SELECT up.type FROM uploads up
    JOIN users u ON u.id=? AND u.avatar='/api/media/'||up.id
    WHERE up.id=? AND up.userId=u.id AND up.state='ready'
      AND NOT EXISTS(SELECT 1 FROM moderated_uploads m WHERE m.uploadId=up.id)
      AND NOT EXISTS(SELECT 1 FROM chat_uploads c WHERE c.uploadId=up.id)
      AND NOT EXISTS(SELECT 1 FROM room_uploads r WHERE r.uploadId=up.id)`)
    .bind(me.id, id)
    .first<{ type: string }>();
  if (!upload || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(upload.type))
    throw new ApiError(404, 'Аватар не найден');
  const thumbnail = await bucket().get(avatarVariantKey(id, 384));
  const image = thumbnail || (await bucket().get(id));
  if (!image) throw new ApiError(404, 'Аватар не найден');
  if (
    (await noctGiftsLinkedUser(auth.telegramId, auth.authenticatedAt))
      ?.linkId !== me.linkId
  )
    throw new ApiError(
      401,
      'Привязка Telegram изменилась. Откройте приложение заново.',
      'TELEGRAM_LINK_CHANGED',
    );
  return new Response(image.body, {
    headers: {
      'Content-Type': thumbnail ? 'image/webp' : upload.type,
      'Content-Length': String(image.size),
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
