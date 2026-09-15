import { failure } from '@/lib/api-error';
import { noctGiftsBody, noctGiftsHeaders } from '@/lib/noct-gifts-account';
import { noctGiftsGame } from '@/lib/noct-gifts-games';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    const body = await noctGiftsBody(req, [
      'initData',
      'key',
      'caseId',
      'version',
    ]);
    return Response.json(
      await noctGiftsGame('case', body, new URL(req.url).origin),
      { headers: noctGiftsHeaders },
    );
  } catch (error) {
    const result = failure(error);
    result.headers.set('Cache-Control', 'private, no-store');
    return result;
  }
}
