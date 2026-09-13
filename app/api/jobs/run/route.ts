import { setting } from '@/lib/auth-session';
import { flushPush } from '@/lib/notifications';
import { expireCalls } from '@/lib/calls';
import { cleanUploads } from '@/lib/upload-storage';
import { recordOnlineSnapshot } from '@/lib/admin-online';
export async function POST(req: Request) {
  const secret = setting('NOCT_JOBS_SECRET'),
    supplied = req.headers.get('authorization') || '';
  if (!secret || supplied !== 'Bearer ' + secret)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (new URL(req.url).searchParams.get('onlineOnly') === '1') {
    await recordOnlineSnapshot();
    return Response.json({ ok: true });
  }
  const [, maintenance] = await Promise.all([
    recordOnlineSnapshot(),
    (async () => {
      await expireCalls();
      const push = await flushPush();
      return { ...push, uploads: await cleanUploads() };
    })(),
  ]);
  return Response.json(maintenance);
}
