import { viewer, failure } from '@/lib/server';
import { assertReadable } from '@/lib/account-access';
import { musicServiceStatus } from '@/lib/music-services';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await viewer();
    await assertReadable(user);
    return Response.json(
      { services: await musicServiceStatus(user) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
