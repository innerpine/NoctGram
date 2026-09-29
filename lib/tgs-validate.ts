// Sticker files are checked on the server, by the importers and by the tests
// with the same rules. Nothing here is decoded by a browser renderer first.
export const TGS_LIMIT = 64 * 1024;
export const TGS_JSON_LIMIT = 1024 * 1024;
export const LOTTIE_NODE_LIMIT = 250_000;

export class StickerFileError extends Error {}

// Unpacks a .tgs (gzip-compressed Lottie JSON) without holding more than the
// limit in memory, so a small file cannot expand into a huge one.
export async function inflateTgs(bytes: Uint8Array, limit = TGS_JSON_LIMIT) {
  if (bytes.length > TGS_LIMIT)
    throw new StickerFileError('Анимированный стикер — до 64 КБ');
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
    throw new StickerFileError('Файл TGS должен быть сжат gzip');
  const reader = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new StickerFileError('Анимация слишком большая после распаковки');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof StickerFileError) throw error;
    throw new StickerFileError('Не удалось распаковать TGS');
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(joined);
}

type LottieRules = {
  maxSize?: number;
  exactSize?: number;
  maxSeconds?: number;
};
// Accepts only what the light Lottie player draws safely: no expressions,
// no images or fonts loaded by path, no text layers, bounded size and time.
export function inspectLottie(data: unknown, rules: LottieRules = {}) {
  const { maxSize = 512, exactSize, maxSeconds = 3 } = rules;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return 'Это не анимация Lottie';
  const root = data as Record<string, unknown>;
  const { w, h, fr, ip, op } = root;
  if (
    typeof w !== 'number' ||
    typeof h !== 'number' ||
    w <= 0 ||
    h <= 0 ||
    w > maxSize ||
    h > maxSize ||
    (exactSize !== undefined && (w !== exactSize || h !== exactSize))
  )
    return exactSize
      ? `Размер анимации должен быть ${exactSize}×${exactSize}`
      : `Размер анимации — до ${maxSize}×${maxSize}`;
  if (typeof fr !== 'number' || fr < 1 || fr > 60)
    return 'Частота кадров — от 1 до 60';
  if (typeof ip !== 'number' || typeof op !== 'number' || op <= ip)
    return 'Некорректная длительность анимации';
  if ((op - ip) / fr > maxSeconds + 0.05)
    return `Анимация длиннее ${maxSeconds} секунд`;
  let nodes = 0;
  // Each entry remembers whether it is an item of a 'layers' array.
  const stack: [unknown, boolean][] = [[data, false]];
  while (stack.length) {
    const [value, layer] = stack.pop()!;
    if (++nodes > LOTTIE_NODE_LIMIT) return 'Анимация слишком сложная';
    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item === 'object') stack.push([item, layer]);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const node = value as Record<string, unknown>;
    // Expressions are strings in 'x'; image and font assets load by path.
    if (typeof node.x === 'string') return 'Выражения в анимации запрещены';
    if (typeof node.p === 'string') return 'Картинки внутри анимации запрещены';
    if (layer && node.ty === 5) return 'Текстовые слои в анимации запрещены';
    if ('fonts' in node || 'chars' in node)
      return 'Шрифты в анимации запрещены';
    for (const [key, item] of Object.entries(node))
      if (item && typeof item === 'object')
        stack.push([item, key === 'layers']);
  }
  return null;
}

// Image size from the file header: PNG IHDR, or WebP VP8, VP8L and VP8X.
export function imageSize(bytes: Uint8Array, type: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (from: number, length: number) =>
    String.fromCharCode(...bytes.subarray(from, from + length));
  if (type === 'image/png') {
    if (
      bytes.length < 24 ||
      text(1, 3) !== 'PNG' ||
      bytes[0] !== 0x89 ||
      text(12, 4) !== 'IHDR'
    )
      return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === 'image/webp') {
    if (bytes.length < 30 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WEBP')
      return null;
    const chunk = text(12, 4);
    if (chunk === 'VP8 ') {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a)
        return null;
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === 'VP8L') {
      if (bytes[20] !== 0x2f) return null;
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === 'VP8X') {
      const read24 = (at: number) =>
        bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      return { width: read24(24) + 1, height: read24(27) + 1 };
    }
  }
  return null;
}
