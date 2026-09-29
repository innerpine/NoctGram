import { viewer, ApiError, failure } from '@/lib/server';
import { readJsonBody } from '@/lib/request-body';
import { forwardToChats } from '@/lib/chat-forward';

export const dynamic = 'force-dynamic';
const MAX_BODY = 32000;

// Forwards messages or a feed post to several chats; see lib/chat-forward.ts.
export async function POST(req: Request) {
  let consumed = false;
  try {
    const origin = req.headers.get('origin');
    if (
      (origin && origin !== new URL(req.url).origin) ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new ApiError(403, 'Недопустимый источник запроса');
    if (Number(req.headers.get('content-length')) > MAX_BODY)
      throw new ApiError(413, 'Слишком большой запрос');
    consumed = true;
    const body = await readJsonBody(req, MAX_BODY);
    const me = await viewer();
    if (body.expectedSender !== undefined && body.expectedSender !== me)
      throw new ApiError(
        409,
        'Аккаунт изменился. Вернись в аккаунт отправителя.',
      );
    return Response.json(await forwardToChats(me, body), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (!consumed && Number(req.headers.get('content-length')) <= MAX_BODY)
      await readJsonBody(req, MAX_BODY).catch(() => {});
    return failure(error);
  }
}
