export const backgroundModes = ['none', 'theme', 'cover', 'custom'] as const;
export type ProfileBackground = {
  mode: (typeof backgroundModes)[number];
  first: string;
  second: string;
  intensity: number;
};
export const defaultProfileBackground: ProfileBackground = {
  mode: 'none',
  first: '#9775cf',
  second: '#426b98',
  intensity: 30,
};
export function parseProfileBackground(
  value: unknown,
): ProfileBackground | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const b = value as ProfileBackground;
  if (
    !backgroundModes.includes(b.mode) ||
    typeof b.first !== 'string' ||
    !/^#[\da-f]{6}$/i.test(b.first) ||
    typeof b.second !== 'string' ||
    !/^#[\da-f]{6}$/i.test(b.second) ||
    !Number.isInteger(b.intensity) ||
    b.intensity < 15 ||
    b.intensity > 40
  )
    return null;
  return {
    mode: b.mode,
    first: b.first.toLowerCase(),
    second: b.second.toLowerCase(),
    intensity: b.intensity,
  };
}
export function readProfileBackground(value?: string): ProfileBackground {
  try {
    return (
      parseProfileBackground(JSON.parse(value || 'null')) || {
        ...defaultProfileBackground,
      }
    );
  } catch {
    return { ...defaultProfileBackground };
  }
}
