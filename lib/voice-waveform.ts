// Voice message waveforms in the Telegram layout: up to 100 samples of five
// bits (0-31). Stored as one base32 character per sample: 0-9, then a-v.
export const WAVEFORM_SAMPLES = 100;
const ALPHABET = '0123456789abcdefghijklmnopqrstuv';

export function encodeWaveform(values: number[]) {
  return values
    .slice(0, WAVEFORM_SAMPLES)
    .map((value) => ALPHABET[Math.max(0, Math.min(31, Math.round(value) || 0))])
    .join('');
}
export function decodeWaveform(text: string) {
  const values: number[] = [];
  for (const char of text.slice(0, WAVEFORM_SAMPLES)) {
    const value = ALPHABET.indexOf(char);
    if (value >= 0) values.push(value);
  }
  return values;
}
// Raw peaks are 16-bit amplitudes (0-32767) collected while recording. Like
// Telegram clients, loud outliers are capped at 1.8x the mean before scaling.
export function waveformFromPeaks(peaks: number[], count = WAVEFORM_SAMPLES) {
  if (!peaks.length || count < 1) return [];
  const samples = Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * peaks.length) / count);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) * peaks.length) / count),
    );
    let max = 0;
    for (let i = start; i < end && i < peaks.length; i++)
      max = Math.max(max, Math.abs(peaks[i]) || 0);
    return max;
  });
  const sum = samples.reduce((total, value) => total + value, 0);
  const peak = Math.max((sum * 1.8) / count, 2500);
  return samples.map((value) =>
    Math.min(31, Math.round((Math.min(value, peak) * 31) / peak)),
  );
}
// Bars for a player of a given width: the loudest sample in each span.
export function resampleWaveform(values: number[], bars: number) {
  if (bars < 1) return [];
  if (!values.length) return Array.from({ length: bars }, () => 0);
  return Array.from({ length: bars }, (_, index) => {
    const start = Math.floor((index * values.length) / bars);
    const end = Math.max(start + 1, Math.floor(((index + 1) * values.length) / bars));
    let max = 0;
    for (let i = start; i < end && i < values.length; i++)
      max = Math.max(max, values[i]);
    return max;
  });
}
// Longer recordings get a wider player, as in Telegram.
export function waveformBarCount(durationMs: number) {
  return Math.max(24, Math.min(56, Math.round(10 + (durationMs / 1000) * 2)));
}
export function formatRecordingTime(ms: number, tenths = false) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const base = `${minutes}:${String(seconds).padStart(2, '0')}`;
  return tenths ? `${base},${Math.floor((total * 10) % 10)}` : base;
}
