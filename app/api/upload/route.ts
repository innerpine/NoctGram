import { assertWritable } from '@/lib/account-access';
import { bucket, db, viewer, ApiError, failure } from '@/lib/server';
import { readMultipart } from '@/lib/request-body';
import { reserveUpload } from '@/lib/upload-storage';
import { rateLimit } from '@/lib/rate-limit';
import {
  avatarSizes,
  avatarVariantKey,
  avatarVariantLimit,
  validAvatarVariant,
} from '@/lib/avatar-variants';
export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin)
      throw new ApiError(403, 'Недопустимый источник');
    const me = await viewer(true);
    await assertWritable(me);
    await rateLimit('uploads', me, 15, 60);
    const account = await db()
      .prepare('SELECT onboardingComplete FROM users WHERE id=?')
      .bind(me)
      .first<{ onboardingComplete: number }>();
    const pending = !account?.onboardingComplete;
    const max = (pending ? 5 : 25) * 1024 * 1024;
    const form = await readMultipart(
      req,
      max + avatarSizes.length * avatarVariantLimit + 16384,
      ['file', ...avatarSizes.map((size) => `avatar${size}`)],
    );
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > max)
      throw new ApiError(
        400,
        pending
          ? 'Выберите аватарку размером до 5 МБ.'
          : 'Выберите файл размером до 25 МБ',
      );
    if (pending && !file.type.startsWith('image/'))
      throw new ApiError(400, 'Для аватарки выберите изображение.');
    if (
      ![
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'video/mp4',
        'video/webm',
        'video/quicktime',
      ].includes(file.type)
    )
      throw new ApiError(
        400,
        'Поддерживаются JPG, PNG, WebP, GIF, MP4, WebM и MOV',
      );
    const bytes = await file.arrayBuffer();
    const u = new Uint8Array(bytes);
    const valid =
      file.type === 'image/jpeg'
        ? u[0] === 255 && u[1] === 216
        : file.type === 'image/png'
          ? u[0] === 137 && u[1] === 80
          : file.type === 'image/gif'
            ? u[0] === 71 && u[1] === 73
            : file.type === 'image/webp'
              ? new TextDecoder().decode(u.slice(8, 12)) === 'WEBP'
              : file.type === 'video/webm'
                ? u[0] === 26 && u[1] === 69
                : new TextDecoder().decode(u.slice(4, 8)) === 'ftyp';
    if (!valid)
      throw new ApiError(400, 'Содержимое файла не соответствует формату');
    const variants: {
      size: (typeof avatarSizes)[number];
      bytes: ArrayBuffer;
    }[] = [];
    for (const size of avatarSizes) {
      const preview = form.get(`avatar${size}`);
      if (preview === null) continue;
      if (
        !file.type.startsWith('image/') ||
        !(preview instanceof File) ||
        preview.type !== 'image/webp' ||
        preview.size > avatarVariantLimit
      )
        throw new ApiError(400, 'Некорректное превью аватара');
      const bytes = await preview.arrayBuffer();
      if (!validAvatarVariant(new Uint8Array(bytes), size))
        throw new ApiError(400, 'Некорректное превью аватара');
      variants.push({ size, bytes });
    }
    const id = crypto.randomUUID();
    await reserveUpload(id, me, {
      name: file.name,
      type: file.type,
      size: file.size + variants.reduce((n, v) => n + v.bytes.byteLength, 0),
    });
    try {
      await bucket(me).put(id, bytes, {
        httpMetadata: { contentType: file.type },
      });
      await Promise.all(
        variants.map((v) =>
          bucket(me).put(avatarVariantKey(id, v.size), v.bytes, {
            httpMetadata: { contentType: 'image/webp' },
          }),
        ),
      );
      const stored = await db()
        .prepare(
          "UPDATE uploads SET state='ready' WHERE id=? AND state='uploading'",
        )
        .bind(id)
        .run();
      if (!stored.meta.changes)
        throw new ApiError(409, 'Загрузка прервана. Попробуйте ещё раз.');
    } catch (e) {
      await db()
        .prepare("UPDATE uploads SET state='deleting' WHERE id=?")
        .bind(id)
        .run();
      throw e;
    }
    return Response.json({
      id,
      type: file.type,
      name: file.name,
      url: '/api/media/' + id,
    });
  } catch (e) {
    return failure(e);
  }
}
