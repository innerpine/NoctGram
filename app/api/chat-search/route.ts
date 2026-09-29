import { viewer, ApiError, failure } from '@/lib/server';
import { rateLimit } from '@/lib/rate-limit';
import { searchAll, searchChat } from '@/lib/message-search';

export const dynamic = 'force-dynamic';

// GET ?scope=chat&peer=|room=[&topic=]&q=  or  ?scope=all&q=  [&before=]
export async function GET(req: Request) {
  try {
    const me = await viewer();
    const params = new URL(req.url).searchParams;
    if (params.has('actor') && params.get('actor') !== me)
      throw new ApiError(401, 'Аккаунт изменился. Откройте чат снова.');
    await rateLimit('chat-search', me, 30, 60);
    const scope = params.get('scope') || 'chat';
    const result =
      scope === 'all'
        ? await searchAll(me, {
            q: params.get('q'),
            before: params.get('before'),
          })
        : scope === 'chat'
          ? await searchChat(me, {
              q: params.get('q'),
              peer: params.get('peer'),
              room: params.get('room'),
              topic: params.get('topic'),
              before: params.get('before'),
            })
          : null;
    if (!result) throw new ApiError(400, 'Неизвестная область поиска');
    return Response.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
