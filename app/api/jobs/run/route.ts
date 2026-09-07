import { setting } from '@/lib/auth-session';
import { flushPush } from '@/lib/notifications';
import { expireCalls } from '@/lib/calls';
import { cleanUploads } from '@/lib/upload-storage';
export async function POST(req: Request) {
  const secret = setting('NOCT_JOBS_SECRET'),
    supplied = req.headers.get('authorization') || '';
  if (!secret || supplied !== 'Bearer ' + secret)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await expireCalls();
  const push = await flushPush();
  return Response.json({ ...push, uploads: await cleanUploads() });
}
