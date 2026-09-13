import { viewer, failure, ApiError } from '@/lib/server';
import { assertReadable } from '@/lib/account-access';
import { readJsonBody } from '@/lib/request-body';
import { rateLimit } from '@/lib/rate-limit';
import { createGiveaway, getGiveaway } from '@/lib/giveaways';
export const dynamic = 'force-dynamic';
const reply = (data: unknown) =>
  Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: Request) {
  try {
    const me = await viewer();
    await assertReadable(me);
    await rateLimit('giveaway-reads', me, 240, 60);
    const id = new URL(req.url).searchParams.get('id') || '';
    return reply({ giveaway: await getGiveaway(me, id) });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    if (
      (req.headers.get('origin') &&
        req.headers.get('origin') !== new URL(req.url).origin) ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new ApiError(403, 'Недопустимый источник');
    const me = await viewer();
    const body = await readJsonBody(req, 4096);
    if (body.actor !== me)
      throw new ApiError(
        401,
        'Аккаунт изменился. Открой розыгрыш из своего аккаунта.',
      );
    if (body.action !== 'create')
      throw new ApiError(400, 'Неизвестное действие');
    return reply(await createGiveaway(me, body));
  } catch (error) {
    return failure(error);
  }
}
