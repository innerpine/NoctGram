import { failure } from '@/lib/api-error';
import {
  noctGiftsTopup,
  noctGiftsBody,
  noctGiftsHeaders,
} from '@/lib/noct-gifts-account';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    const body = await noctGiftsBody(req, [
      'initData',
      'sku',
      'key',
      'acceptedTerms',
    ]);
    return Response.json(await noctGiftsTopup(body), {
      headers: noctGiftsHeaders,
    });
  } catch (error) {
    const response = failure(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
