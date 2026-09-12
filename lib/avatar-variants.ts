export const avatarSizes = [96, 192, 384] as const;
export type AvatarSize = (typeof avatarSizes)[number];
export const avatarVariantLimit = 256 * 1024;
export function avatarSize(value: string | null): AvatarSize | undefined {
  return avatarSizes.find((size) => String(size) === value);
}
export function avatarVariantKey(id: string, size: AvatarSize) {
  return `avatars/v1/${id}/${size}.webp`;
}
export function uploadObjectKeys(id: string) {
  return [id, ...avatarSizes.map((size) => avatarVariantKey(id, size))];
}
export function avatarSource(url: string | undefined, size: AvatarSize = 192) {
  return url && /^\/api\/media\/[a-zA-Z0-9_-]+$/.test(url)
    ? `${url}?avatar=${size}`
    : url || '';
}
export function avatarSources(url: string | undefined) {
  if (!url || avatarSource(url) === url) return undefined;
  return avatarSizes
    .map((size) => `${avatarSource(url, size)} ${size}w`)
    .join(', ');
}
// Canvas WebP output may use any of these three encodings. Reject animation,
// mismatched dimensions and oversized thumbnails before reserving storage.
export function validAvatarVariant(bytes: Uint8Array, size: AvatarSize) {
  if (bytes.length < 30 || bytes.length > avatarVariantLimit) return false;
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return false;
  let width = 0,
    height = 0;
  if (tag(12) === 'VP8X') {
    if (bytes[20] & 2) return false;
    const uint24 = (at: number) =>
      bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    width = uint24(24) + 1;
    height = uint24(27) + 1;
  } else if (
    tag(12) === 'VP8 ' &&
    bytes[23] === 0x9d &&
    bytes[24] === 1 &&
    bytes[25] === 0x2a
  ) {
    width = view.getUint16(26, true) & 0x3fff;
    height = view.getUint16(28, true) & 0x3fff;
  } else if (tag(12) === 'VP8L' && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
    if (bits >>> 29 !== 0) return false;
  }
  return width === size && height === size;
}
