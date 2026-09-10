import { viewer, failure, ApiError } from '@/lib/server';
import { assertReadable } from '@/lib/account-access';
import { readJsonBody } from '@/lib/request-body';
import { rateLimit } from '@/lib/rate-limit';
import {
  checkout,
  createPayment,
  paymentCatalog,
  paymentOrder,
  publicOrder,
  verifyCrypto,
} from '@/lib/payments';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(req: Request) {
  try {
    const me = await viewer();
    await assertReadable(me);
    const q = new URL(req.url).searchParams;
    if (q.has('actor') && q.get('actor') !== me)
      throw new ApiError(401, 'Аккаунт изменился');
    if (!q.has('id')) return Response.json(paymentCatalog(), { headers });
    await rateLimit('payment-check', me, 20, 60);
    const order = await paymentOrder(q.get('id') || '');
    if (!order || order.userId !== me)
      throw new ApiError(404, 'Счёт не найден');
    return Response.json(publicOrder(await verifyCrypto(order)), { headers });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin');
    if (
      (origin && origin !== new URL(req.url).origin) ||
      req.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new ApiError(403, 'Недопустимый источник запроса');
    const me = await viewer(),
      b = await readJsonBody(req, 4096);
    if (b.actor !== me) throw new ApiError(401, 'Аккаунт изменился');
    await rateLimit('payment-create', me, 12, 3600);
    return Response.json(await checkout(await createPayment(me, b)), {
      headers,
    });
  } catch (e) {
    return failure(e);
  }
}
