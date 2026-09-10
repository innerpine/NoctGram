import { viewer, failure, ApiError } from '@/lib/server';
import { assertReadable, assertWritable } from '@/lib/account-access';
import { readJsonBody } from '@/lib/request-body';
import { GIFT_CATALOG } from '@/lib/gift-catalog';
import { balance, ensureWallet } from '@/lib/star-wallet';
import { sendGift, listGifts, giftVisibility } from '@/lib/gifts';
import { rateLimit } from '@/lib/rate-limit';
export const dynamic = 'force-dynamic';
const reply = (data: unknown) =>
  Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: Request) {
  try {
    const me = await viewer();
    await assertReadable(me);
    const q = new URL(req.url).searchParams;
    if (q.get('action') === 'catalog') {
      await ensureWallet(me);
      return reply({ catalog: GIFT_CATALOG, balance: await balance(me) });
    }
    const recipient = q.get('user') || me,
      before = q.get('before') || '',
      id = q.get('id') || '';
    if (recipient.length > 100 || before.length > 220 || id.length > 220)
      throw new ApiError(400, 'Некорректный запрос');
    return reply(await listGifts(me, recipient, before, id));
  } catch (e) {
    return failure(e);
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
    await rateLimit('gift-requests', me, 60, 60);
    if (body.action === 'visibility') {
      await assertReadable(me);
      return reply(await giftVisibility(me, body));
    }
    await assertWritable(me);
    if (body.action !== 'send') throw new ApiError(400, 'Неизвестное действие');
    return reply(await sendGift(me, body));
  } catch (e) {
    return failure(e);
  }
}
