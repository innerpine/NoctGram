import { failure } from '@/lib/api-error';
import {
  noctGiftsAccount,
  noctGiftsBody,
  noctGiftsHeaders,
} from '@/lib/noct-gifts-account';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    const body = await noctGiftsBody(req, ['initData', 'before']);
    return Response.json(
      await noctGiftsAccount(body, new URL(req.url).origin),
      { headers: noctGiftsHeaders },
    );
  } catch (error) {
    const response = failure(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
