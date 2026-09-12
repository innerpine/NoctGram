import { assertMediaRead } from '@/lib/media-access';
import { assertReadable, assertUploadAvailable } from '@/lib/account-access';
import { bucket, db, viewer, ApiError, failure } from '@/lib/server';
import { avatarSize, avatarVariantKey } from '@/lib/avatar-variants';
import { visibleAccount } from '@/lib/account-access';
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await viewer(true);
    const { id } = await params;
    const [, upload] = await Promise.all([
      assertReadable(me),
      db()
        .prepare(
          `SELECT up.userId,up.name,up.type,u.onboardingComplete,u.deletedAt,c.kind,
        (SELECT onboardingComplete FROM users WHERE id=?) AS viewerComplete,
        EXISTS(SELECT 1 FROM users av WHERE av.avatar='/api/media/'||up.id AND ${visibleAccount('av')}) AS avatar
        FROM uploads up JOIN users u ON u.id=up.userId LEFT JOIN chat_uploads c ON c.uploadId=up.id WHERE up.id=? AND up.state='ready'`,
        )
        .bind(me, id)
        .first<{
          userId: string;
          name: string;
          kind: string | null;
          onboardingComplete: number;
          deletedAt: number;
          viewerComplete: number;
          avatar: number;
          type: string;
        }>(),
    ]);
    if (!upload) throw new ApiError(404, 'Файл не найден');
    if (
      upload.userId !== me &&
      (!upload.viewerComplete ||
        (!upload.onboardingComplete && !upload.deletedAt))
    )
      throw new ApiError(403, 'Завершите настройку профиля.');
    await Promise.all([
      assertUploadAvailable(id),
      assertMediaRead(id, me, upload.userId),
    ]);
    const range = req.headers.get('range');
    const url = new URL(req.url);
    const size =
      !range &&
      !upload.kind &&
      upload.avatar &&
      upload.type.startsWith('image/') &&
      !url.searchParams.has('download')
        ? avatarSize(url.searchParams.get('avatar'))
        : undefined;
    const thumbnail = size
      ? await bucket().get(avatarVariantKey(id, size))
      : null;
    const object =
      thumbnail ||
      (await bucket().get(id, range ? { range: req.headers } : undefined));
    if (!object) throw new ApiError(404, 'Файл не найден');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    if (upload.kind === 'file' || url.searchParams.has('download')) {
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
    if (size) {
      // A browser may reuse bytes only after all current access checks pass.
      // Chats, downloads and all other media keep their no-store policy.
      headers.set('Cache-Control', 'private, no-cache, must-revalidate');
      headers.set('Vary', 'Cookie');
      if (
        req.headers
          .get('if-none-match')
          ?.split(',')
          .some((tag) => tag.trim().replace(/^W\//, '') === object.httpEtag)
      ) {
        await object.body.cancel();
        return new Response(null, { status: 304, headers });
      }
    }
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
