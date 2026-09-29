import { viewer, ApiError, failure } from '@/lib/server';
import { readJsonBody, readMultipart } from '@/lib/request-body';
import { rateLimit } from '@/lib/rate-limit';
import {
  addSticker,
  createPack,
  deletePack,
  faveSticker,
  installPack,
  myPacks,
  readPack,
  removeSticker,
  reorderPack,
  reportPack,
  resolveStickers,
  stickerPanel,
  uninstallPack,
  updatePack,
  updateSticker,
} from '@/lib/stickers';
import { STICKER_IMAGE_LIMIT } from '@/lib/sticker-types';

export const dynamic = 'force-dynamic';
const MAX_BODY = 16000;
const headers = { 'Cache-Control': 'private, no-store' };

// GET ?action=panel | pack&name=<short name or u:id> | mine | resolve&refs=a,b
export async function GET(req: Request) {
  try {
    const me = await viewer();
    const params = new URL(req.url).searchParams;
    if (params.has('actor') && params.get('actor') !== me)
      throw new ApiError(401, 'Аккаунт изменился. Обновите страницу.');
    const action = params.get('action');
    const result =
      action === 'panel'
        ? await stickerPanel(me)
        : action === 'pack'
          ? await readPack(me, params.get('name'))
          : action === 'mine'
            ? await myPacks(me)
            : action === 'resolve'
              ? {
                  stickers: await resolveStickers(
                    (params.get('refs') || '').split(',').filter(Boolean),
                  ),
                }
              : null;
    if (!result) throw new ApiError(400, 'Неизвестное действие');
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
}
function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (
    (origin && origin !== new URL(req.url).origin) ||
    req.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new ApiError(403, 'Недопустимый источник запроса');
}
const actions = {
  createPack,
  updatePack,
  deletePack,
  updateSticker,
  removeSticker,
  reorder: reorderPack,
  install: installPack,
  uninstall: uninstallPack,
  fave: faveSticker,
  report: reportPack,
} as const;
// POST multipart {file, pack, emoji} adds a sticker; JSON {action, ...} does the rest.
export async function POST(req: Request) {
  let consumed = false;
  try {
    sameOrigin(req);
    if (req.headers.get('content-type')?.startsWith('multipart/form-data;')) {
      const max = STICKER_IMAGE_LIMIT + 16384;
      if (Number(req.headers.get('content-length')) > max)
        throw new ApiError(413, 'Стикер — до 512 КБ');
      const me = await viewer();
      await rateLimit('sticker-upload', me, 60, 600);
      consumed = true;
      const form = await readMultipart(req, max, [
        'file',
        'pack',
        'emoji',
        'actor',
      ]).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 413)
          throw new ApiError(413, 'Стикер — до 512 КБ');
        throw error;
      });
      const actor = form.get('actor');
      if (actor !== null && actor !== me)
        throw new ApiError(401, 'Аккаунт изменился. Обновите страницу.');
      const file = form.get('file');
      if (!(file instanceof File)) throw new ApiError(400, 'Выберите файл');
      return Response.json(
        await addSticker(me, form.get('pack'), form.get('emoji'), file),
        { headers },
      );
    }
    if (Number(req.headers.get('content-length')) > MAX_BODY)
      throw new ApiError(413, 'Слишком большой запрос');
    consumed = true;
    const body = await readJsonBody(req, MAX_BODY);
    const me = await viewer();
    if (body.actor !== undefined && body.actor !== me)
      throw new ApiError(401, 'Аккаунт изменился. Обновите страницу.');
    await rateLimit('stickers', me, 60, 60);
    const action =
      typeof body.action === 'string' && Object.hasOwn(actions, body.action)
        ? actions[body.action as keyof typeof actions]
        : null;
    if (!action) throw new ApiError(400, 'Неизвестное действие');
    return Response.json(await action(me, body), { headers });
  } catch (error) {
    if (!consumed && Number(req.headers.get('content-length')) <= MAX_BODY)
      await readJsonBody(req, MAX_BODY).catch(() => {});
    return failure(error);
  }
}
