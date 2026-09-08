export const DEFAULT_MUSIC_VOLUME = 25;

export function clampMusicVolume(percent: number) {
  return Number.isFinite(percent)
    ? Math.max(0, Math.min(100, Math.round(percent)))
    : DEFAULT_MUSIC_VOLUME;
}
export function readMusicVolume(saved: string | null) {
  return saved === null || !saved.trim()
    ? DEFAULT_MUSIC_VOLUME
    : clampMusicVolume(Number(saved));
}
// More travel at quiet levels: 1% on the slider is 0.01% of linear gain.
export function musicGain(percent: number) {
  return (clampMusicVolume(percent) / 100) ** 2;
}
// YouTube's public iframe API only accepts whole percentages. Keep nonzero
// choices audible; never pretend that fractional native gain is supported.
export function youtubeVolume(percent: number) {
  return percent > 0 ? Math.max(1, Math.round(musicGain(percent) * 100)) : 0;
}
export function volumeFromYouTube(native: number, current: number) {
  if (youtubeVolume(current) === native) return current;
  return clampMusicVolume(
    Math.sqrt(Math.max(0, Math.min(100, native)) / 100) * 100,
  );
}
