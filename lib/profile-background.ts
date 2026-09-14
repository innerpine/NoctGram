export const backgroundModes = ['none', 'theme', 'cover', 'custom'] as const;
export const profilePatterns = ['none', 'stardust', 'orbits'] as const;
export type ProfileBackground = {
  mode: (typeof backgroundModes)[number];
  first: string;
  second: string;
  intensity: number;
  musicColor: 'cover' | 'profile';
  pattern: (typeof profilePatterns)[number];
};
export const defaultProfileBackground: ProfileBackground = {
  mode: 'none',
  first: '#9775cf',
  second: '#426b98',
  intensity: 30,
  musicColor: 'cover',
  pattern: 'none',
};
export function parseProfileBackground(
  value: unknown,
  fallbackMusicColor: ProfileBackground['musicColor'] = 'cover',
  fallbackPattern: ProfileBackground['pattern'] = 'none',
): ProfileBackground | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const b = value as ProfileBackground;
  const musicColor =
    b.musicColor === undefined ? fallbackMusicColor : b.musicColor;
  const pattern = b.pattern === undefined ? fallbackPattern : b.pattern;
  if (
    !backgroundModes.includes(b.mode) ||
    !profilePatterns.includes(pattern) ||
    (musicColor !== 'cover' && musicColor !== 'profile') ||
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
    musicColor,
    pattern,
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
