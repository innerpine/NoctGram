import { bucket, db, ApiError } from './server';
export function animatedImage(type: string, bytes: Uint8Array) {
  if (type === 'image/gif') return true;
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  if (type === 'image/png')
    for (let at = 8; at + 12 <= bytes.length;) {
      const length = new DataView(
        bytes.buffer,
        bytes.byteOffset + at,
        4,
      ).getUint32(0);
      if (tag(at + 4) === 'acTL') return true;
      if (tag(at + 4) === 'IDAT' || length > bytes.length - at - 12) break;
      at += length + 12;
    }
  if (type === 'image/webp') return tag(12) === 'VP8X' && !!(bytes[20] & 2);
  return false;
}
export async function assertStaticAvatar(url: string) {
  const id = url.replace('/api/media/', '');
  const row = await db()
    .prepare('SELECT type FROM uploads WHERE id=?')
    .bind(id)
    .first<{ type: string }>();
  if (!row) throw new ApiError(400, 'Изображение не найдено');
  const object = await bucket().get(id);
  if (!object) throw new ApiError(400, 'Изображение не найдено');
  if (animatedImage(row.type, new Uint8Array(await object.arrayBuffer())))
    throw new ApiError(
      400,
      'Анимированный аватар добавляется во вкладке «Дизайн» с Noct Premium',
    );
}
