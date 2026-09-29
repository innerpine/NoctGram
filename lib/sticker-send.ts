import { db } from './storage';
import { ApiError } from './api-error';
import { readable } from './room-access';
import { builtinSticker } from './sticker-catalog';

export const USER_STICKER_REF =
  /^u:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
// A pack is live while it is not deleted or removed by a moderator and its
// owner's account is visible. Aliases: sp (pack) and o (owner).
export const livePack = `sp.deletedAt=0 AND sp.removedAt=0 AND ${readable('o')}`;

// The sticker of a new message: a built-in one, or a sticker from a live pack.
// Custom emoji packs are used inside text, never as a sticker message.
export async function stickerForMessage(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 100)
    throw new ApiError(400, 'Стикер недоступен');
  if (value.startsWith('b:')) {
    if (!builtinSticker(value)) throw new ApiError(400, 'Стикер недоступен');
    return value;
  }
  const match = USER_STICKER_REF.exec(value);
  if (
    !match ||
    !(await db()
      .prepare(
        `SELECT 1 FROM stickers st JOIN sticker_packs sp ON sp.id=st.packId JOIN users o ON o.id=sp.ownerId
        WHERE st.id=? AND st.deletedAt=0 AND sp.type='stickers' AND ${livePack}`,
      )
      .bind(match[1])
      .first())
  )
    throw new ApiError(404, 'Стикер удалён или недоступен');
  return value;
}
