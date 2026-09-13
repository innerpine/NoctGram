import { setting } from '@/lib/auth-session';
import { flushPush } from '@/lib/notifications';
import { expireCalls } from '@/lib/calls';
import { cleanUploads } from '@/lib/upload-storage';
import { recordOnlineSnapshot } from '@/lib/admin-online';
import { settleDueGiveaways } from '@/lib/giveaways';
export async function POST(req: Request) {
  const secret = setting('NOCT_JOBS_SECRET'),
    supplied = req.headers.get('authorization') || '';
  if (!secret || supplied !== 'Bearer ' + secret)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URL(req.url).searchParams;
  if (params.get('task') === 'giveaways')
    return Response.json({ giveaways: await settleDueGiveaways() });
  // Both lightweight minute tasks run even when one fails. Maintenance keeps
  // its five-minute cadence; online-only callers never flush notifications.
  const [snapshot, prizes] = await Promise.allSettled([
    recordOnlineSnapshot(),
    settleDueGiveaways(),
  ]);
  let maintenance = {};
  if (params.get('onlineOnly') !== '1') {
    await expireCalls();
    const push = await flushPush();
    maintenance = { ...push, uploads: await cleanUploads() };
  }
  if (snapshot.status === 'rejected') throw snapshot.reason;
  if (prizes.status === 'rejected') throw prizes.reason;
  return Response.json(
    params.get('onlineOnly') === '1'
      ? { ok: true, giveaways: prizes.value }
      : { ...maintenance, giveaways: prizes.value },
  );
}
