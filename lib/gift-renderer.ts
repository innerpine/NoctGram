export type GiftRenderer = 'canvas' | 'svg';

// Lottie Canvas only applies gradient alpha when opacity and color stops can
// collapse into the same positions (GradientProperty.checkCollapsable). SVG
// supports the separate opacity mask; otherwise glass becomes an opaque fill.
export function giftRenderer(data: unknown): GiftRenderer {
  function needsOpacityMask(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    if ((item.ty === 'gf' || item.ty === 'gs') && item.g) {
      const gradient = item.g as { p: number; k?: { k?: unknown } };
      const points = gradient.p;
      const raw = gradient.k?.k;
      if (Number.isInteger(points) && points > 0 && Array.isArray(raw)) {
        const frames: unknown[] =
          typeof raw[0] === 'number'
            ? [raw]
            : raw.flatMap((frame) =>
                [frame?.s, frame?.e].filter(Array.isArray),
              );
        for (const frame of frames) {
          const stops = frame as number[];
          if (stops.length <= points * 4) continue;
          if ((stops.length - points * 4) / 2 !== points) return true;
          for (let i = 0; i < points; i++)
            if (Math.abs(stops[i * 4] - stops[points * 4 + i * 2]) > 0.01)
              return true;
        }
      }
    }
    return Object.values(item).some(needsOpacityMask);
  }
  return needsOpacityMask(data) ? 'svg' : 'canvas';
}
