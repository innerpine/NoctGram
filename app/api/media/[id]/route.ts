import { bucket, viewer, ApiError, failure } from '@/lib/server';
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await viewer();
    const { id } = await params;
    const range = req.headers.get('range');
    const object = await bucket().get(
      id,
      range ? { range: req.headers } : undefined,
    );
    if (!object) throw new ApiError(404, 'Файл не найден');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Cache-Control', 'private, max-age=3600');
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
