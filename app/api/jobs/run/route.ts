import { setting } from '@/lib/auth-session';
import { flushPush } from '@/lib/notifications';
import { expireCalls } from '@/lib/calls';
import { cleanUploads } from '@/lib/upload-storage';
import { settleDueGiveaways } from '@/lib/giveaways';
export async function POST(req: Request) {
  const secret = setting('NOCT_JOBS_SECRET'),
    supplied = req.headers.get('authorization') || '';
  if (!secret || supplied !== 'Bearer ' + secret)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const giveaways = await settleDueGiveaways();
  if (new URL(req.url).searchParams.get('task') === 'giveaways')
    return Response.json({ giveaways });
  await expireCalls();
  const push = await flushPush();
  return Response.json({ ...push, giveaways, uploads: await cleanUploads() });
}
