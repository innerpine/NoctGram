import { failure } from '@/lib/api-error';
import { noctGiftsBody } from '@/lib/noct-gifts-account';
import { noctGiftsAvatar } from '@/lib/noct-gifts-avatar';

export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    return await noctGiftsAvatar(await noctGiftsBody(req, ['initData']));
  } catch (error) {
    const response = failure(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
