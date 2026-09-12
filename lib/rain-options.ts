export const rainFrameRates = ['auto', 30, 60, 90, 120] as const;
export const rainRanges = {
  intensity: { min: 25, max: 200, step: 5 },
  speed: { min: 50, max: 200, step: 5 },
  brightness: { min: 25, max: 150, step: 5 },
} as const;
export type RainOptions = {
  fps: (typeof rainFrameRates)[number];
  intensity: number;
  speed: number;
  brightness: number;
};
export const defaultRainOptions: RainOptions = {
  fps: 'auto',
  intensity: 100,
  speed: 100,
  brightness: 100,
};
export function readRainOptions(value: unknown): RainOptions {
  const input = value as Partial<RainOptions> | null;
  function bounded(key: keyof typeof rainRanges) {
    const value = input?.[key];
    const { min, max, step } = rainRanges[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, Math.round(value / step) * step))
      : defaultRainOptions[key];
  }
  return {
    fps: rainFrameRates.includes(input?.fps as RainOptions['fps'])
      ? input!.fps!
      : 'auto',
    intensity: bounded('intensity'),
    speed: bounded('speed'),
    brightness: bounded('brightness'),
  };
}
