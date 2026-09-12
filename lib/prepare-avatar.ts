import { avatarSizes } from './avatar-variants';

/** Derived previews never replace the original upload. Animated uploads retain
 * their original validation and Premium rules on the server. */
export async function prepareAvatar(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return [];
  const source = URL.createObjectURL(file);
  const image = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    image.src = source;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) return [];
    canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return [];
    const result: { size: number; file: File }[] = [];
    for (const size of avatarSizes) {
      // Yield between encodes so choosing a large photo keeps the form responsive.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      canvas.width = canvas.height = size;
      context.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas!.toBlob(resolve, 'image/webp', 0.84),
      );
      if (!blob || blob.type !== 'image/webp') return [];
      result.push({
        size,
        file: new File([blob], `avatar-${size}.webp`, { type: 'image/webp' }),
      });
    }
    canvas.width = canvas.height = 0;
    return result;
  } catch {
    return [];
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    image.src = '';
    URL.revokeObjectURL(source);
  }
}
