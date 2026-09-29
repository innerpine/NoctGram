import { upload } from './client';

/**
 * Uploads a shrunk profile photo. A stalled connection gives up after two
 * minutes with a clear message instead of keeping the editor busy forever;
 * `signal` cancels it early (the editor was closed).
 */
export async function uploadPhoto(
  file: File,
  max: number,
  signal?: AbortSignal,
) {
  const controller = new AbortController(),
    stop = () => controller.abort();
  const timer = setTimeout(stop, 120_000);
  signal?.addEventListener('abort', stop);
  try {
    return await upload(await shrinkImage(file, max), controller.signal);
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted)
      throw new Error(
        'Загрузка идёт слишком долго. Проверь интернет и попробуй ещё раз.',
      );
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/**
 * Re-encodes a profile photo before upload: at most `max` px on the long side,
 * and without EXIF (camera, geolocation). A phone photo of several megabytes
 * becomes a few hundred kilobytes. Anything the browser cannot decode is sent
 * as it is, so the server keeps the final say.
 */
export async function shrinkImage(file: File, max: number): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  // WebP keeps transparency; browsers that cannot encode it fall back to JPEG.
  let blob = await encode('image/webp');
  if (blob?.type !== 'image/webp') blob = await encode('image/jpeg');
  if (!blob) return file;
  const name = file.name.replace(/\.[^.]*$/, '') || 'photo';
  return new File(
    [blob],
    `${name}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`,
    {
      type: blob.type,
    },
  );
}
