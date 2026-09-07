import {
  assertReadable,
  assertAccountVisible,
  assertUploadAvailable,
} from '@/lib/account-access';
import { bucket, db, viewer, ApiError, failure } from '@/lib/server';
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await viewer(true);
    await assertReadable(me);
    const { id } = await params;
    const upload = await db()
      .prepare(
        'SELECT up.userId,u.onboardingComplete FROM uploads up JOIN users u ON u.id=up.userId WHERE up.id=?',
      )
      .bind(id)
      .first<{ userId: string; onboardingComplete: number }>();
    if (!upload) throw new ApiError(404, 'Файл не найден');
    const account = await db()
      .prepare('SELECT onboardingComplete FROM users WHERE id=?')
      .bind(me)
      .first<{ onboardingComplete: number }>();
    if (
      upload.userId !== me &&
      (!account?.onboardingComplete || !upload.onboardingComplete)
    )
      throw new ApiError(403, 'Завершите настройку профиля.');
    if (upload.userId !== me || upload.onboardingComplete)
      await assertAccountVisible(upload.userId);
    await assertUploadAvailable(id);
    const range = req.headers.get('range');
    const object = await bucket().get(
      id,
      range ? { range: req.headers } : undefined,
    );
    if (!object) throw new ApiError(404, 'Файл не найден');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('ETag', object.httpEtag);
    let status = 200;
    if (
      range &&
      object.range &&
      'offset' in object.range &&
      object.range.offset !== undefined
    ) {
      const start = object.range.offset;
      const length = object.range.length || object.size;
      headers.set(
        'Content-Range',
        `bytes ${start}-${start + length - 1}/${object.size}`,
      );
      headers.set('Content-Length', String(length));
      status = 206;
    } else headers.set('Content-Length', String(object.size));
    return new Response(object.body, { headers, status });
  } catch (e) {
    return failure(e);
  }
}
