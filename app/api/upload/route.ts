import { assertWritable } from '@/lib/account-access';
import { bucket, db, viewer, ApiError, failure } from '@/lib/server';
export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin)
      throw new ApiError(403, 'Недопустимый источник');
    const me = await viewer(true);
    await assertWritable(me);
    const account = await db()
      .prepare('SELECT onboardingComplete FROM users WHERE id=?')
      .bind(me)
      .first<{ onboardingComplete: number }>();
    const pending = !account?.onboardingComplete;
    const max = (pending ? 5 : 25) * 1024 * 1024;
    if (Number(req.headers.get('content-length')) > max + 16384)
      throw new ApiError(
        413,
        pending ? 'Аватарка — до 5 МБ.' : 'Файл должен быть меньше 25 МБ',
      );
    const form = await req.formData();
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
    const id = crypto.randomUUID();
    await bucket().put(id, bytes, { httpMetadata: { contentType: file.type } });
    try {
      await db()
        .prepare(
          'INSERT INTO uploads (id,userId,type,name,created) VALUES (?,?,?,?,?)',
        )
        .bind(id, me, file.type, file.name.slice(0, 200), Date.now())
        .run();
    } catch (e) {
      await bucket().delete(id);
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
