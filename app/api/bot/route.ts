import { botPayments } from '@/lib/payments';
import { botAction, authorizeBot } from '@/lib/telegram';
import { readJsonBody } from '@/lib/request-body';
import { failure } from '@/lib/api-error';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    await authorizeBot(req);
    const body = await readJsonBody(req, 8192);
    const result = (await botPayments(body)) ?? (await botAction(body));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    // Drain a small rejected body too: the local Worker proxy otherwise leaves
    // its upstream keep-alive connection unusable after an early auth failure.
    if (req.body && !req.body.locked && !req.bodyUsed)
      await readJsonBody(req, 8192).catch(() => {});
    return failure(e);
  }
}
