import { viewer, failure, ApiError, profile } from '@/lib/server';
import { assertReadable, assertWritable } from '@/lib/account-access';
import { readJsonBody } from '@/lib/request-body';
import { balance, ensureWallet } from '@/lib/star-wallet';
import { rateLimit } from '@/lib/rate-limit';
import {
  assets,
  buyLot,
  cancelLot,
  catalog,
  displayNumber,
  issueLots,
  listAsset,
  lot,
} from '@/lib/market';
export const dynamic = 'force-dynamic';
const reply = (data: unknown) =>
  Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req: Request) {
  try {
    const me = await viewer();
    await assertReadable(me);
    const q = new URL(req.url).searchParams;
    if (q.get('action') === 'viewer') {
      await ensureWallet(me);
      return reply({ me: await profile(me, me), balance: await balance(me) });
    }
    if (q.get('action') === 'lot') return reply(await lot(me, q));
    if (q.get('action') === 'assets') return reply(await assets(me));
    return reply(await catalog(q));
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
    const body = await readJsonBody(req, 8192);
    await rateLimit('market-requests', me, 60, 60);
    await assertWritable(me);
    if (body.action === 'buy') return reply(await buyLot(me, body));
    if (body.action === 'list') return reply(await listAsset(me, body));
    if (body.action === 'cancel') return reply(await cancelLot(me, body));
    if (body.action === 'displayNumber')
      return reply(await displayNumber(me, body));
    if (body.action === 'issue') return reply(await issueLots(me, body));
    throw new ApiError(400, 'Неизвестное действие');
  } catch (e) {
    return failure(e);
  }
}
