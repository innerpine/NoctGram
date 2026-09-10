export type ImagePalette = readonly [string, string];
// Ignore nearly black/white pixels and rank quantized colours by area and saturation.
export function paletteFromPixels(
  pixels: Uint8ClampedArray,
): ImagePalette | null {
  const bins = new Map<
    number,
    { r: number; g: number; b: number; weight: number; count: number }
  >();
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, a] = pixels.slice(i, i + 4);
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    if (a < 128 || max < 28 || min > 235) continue;
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const bin = bins.get(key) || { r: 0, g: 0, b: 0, weight: 0, count: 0 };
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bin.count++;
    bin.weight += 1 + (max - min) / 90;
    bins.set(key, bin);
  }
  const colors = [...bins.values()]
    .sort((a, b) => b.weight - a.weight)
    .map((c) => [c.r / c.count, c.g / c.count, c.b / c.count]);
  if (!colors.length) return null;
  const first = colors[0];
  const second =
    colors.find(
      (c) => c.reduce((sum, v, i) => sum + (v - first[i]) ** 2, 0) > 5000,
    ) || colors[Math.min(1, colors.length - 1)];
  const hex = (c: number[]) =>
    '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return [hex(first), hex(second)];
}
