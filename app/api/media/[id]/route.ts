import { assertMediaRead } from '@/lib/media-access';
import { assertReadable, assertUploadAvailable } from '@/lib/account-access';
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
        "SELECT up.userId,up.name,u.onboardingComplete,u.deletedAt,c.kind FROM uploads up JOIN users u ON u.id=up.userId LEFT JOIN chat_uploads c ON c.uploadId=up.id WHERE up.id=? AND up.state='ready'",
      )
      .bind(id)
      .first<{
        userId: string;
        name: string;
        kind: string | null;
        onboardingComplete: number;
        deletedAt: number;
      }>();
    if (!upload) throw new ApiError(404, 'Файл не найден');
    const account = await db()
      .prepare('SELECT onboardingComplete FROM users WHERE id=?')
      .bind(me)
      .first<{ onboardingComplete: number }>();
    if (
      upload.userId !== me &&
      (!account?.onboardingComplete ||
        (!upload.onboardingComplete && !upload.deletedAt))
    )
      throw new ApiError(403, 'Завершите настройку профиля.');
    await assertUploadAvailable(id);
    await assertMediaRead(id, me, upload.userId);
    const range = req.headers.get('range');
    const object = await bucket().get(
      id,
      range ? { range: req.headers } : undefined,
    );
    if (!object) throw new ApiError(404, 'Файл не найден');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    if (
      upload.kind === 'file' ||
      new URL(req.url).searchParams.has('download')
    ) {
      headers.set(
        'Content-Disposition',
        `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(upload.name).replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16))}`,
      );
      if (upload.kind === 'file')
        headers.set('Content-Type', 'application/octet-stream');
    }
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
