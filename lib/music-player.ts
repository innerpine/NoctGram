export type PlayerAppearance = {
  darkness: number;
  blur: number;
  textSize: number;
  softLyrics: boolean;
  motion: boolean;
};

export const defaultAppearance: PlayerAppearance = {
  darkness: 55,
  blur: 72,
  textSize: 32,
  softLyrics: true,
  motion: true,
};

export function readAppearance(value: unknown): PlayerAppearance {
  const input =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const number = (key: keyof PlayerAppearance, min: number, max: number) =>
    typeof input[key] === 'number' && Number.isFinite(input[key])
      ? Math.min(max, Math.max(min, input[key] as number))
      : (defaultAppearance[key] as number);
  return {
    darkness: number('darkness', 30, 85),
    blur: number('blur', 24, 120),
    textSize: number('textSize', 24, 44),
    softLyrics: typeof input.softLyrics === 'boolean' ? input.softLyrics : true,
    motion: typeof input.motion === 'boolean' ? input.motion : true,
  };
}

export function playerArtwork(value?: string, large = false): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !/^i\d+\.sndcdn\.com$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return '';
    // SoundCloud's artwork URLs expose a named size. Keep other URLs intact.
    if (large)
      url.pathname = url.pathname.replace(
        /-(large|t\d+x\d+)(\.[a-z]+)$/i,
        '-t500x500$2',
      );
    return url.href;
  } catch {
    return '';
  }
}

export type LyricLine = { time: number; text: string };
export type TrackLyrics = {
  lines: LyricLine[];
  plain: string;
  instrumental: boolean;
};

export function parseLrc(source: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const offset = Number(source.match(/^\[offset:([+-]?\d+)\]/im)?.[1] || 0);
  for (const row of source.slice(0, 80000).split(/\r?\n/)) {
    const stamps = [
      ...row.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g),
    ];
    if (!stamps.length) continue;
    const text = row
      .slice((stamps.at(-1)!.index || 0) + stamps.at(-1)![0].length)
      .trim();
    for (const stamp of stamps) {
      const time =
        Number(stamp[1]) * 60000 +
        Number(stamp[2]) * 1000 +
        Number((stamp[3] || '0').padEnd(3, '0')) -
        offset;
      lines.push({ time: Math.max(0, time), text });
    }
    if (lines.length >= 1000) break;
  }
  return lines.sort((a, b) => a.time - b.time).slice(0, 1000);
}

export function currentLyric(lines: LyricLine[], position: number): number {
  let lo = 0,
    hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].time <= position) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function readLyrics(
  value: unknown,
  durationMs: number,
): TrackLyrics | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  // Do not show lyrics for a different length recording/remix.
  if (
    typeof data.duration !== 'number' ||
    !Number.isFinite(data.duration) ||
    Math.abs(data.duration * 1000 - durationMs) > 2500
  )
    return null;
  const lines =
    typeof data.syncedLyrics === 'string' ? parseLrc(data.syncedLyrics) : [];
  const plain =
    typeof data.plainLyrics === 'string'
      ? data.plainLyrics.slice(0, 80000)
      : '';
  const instrumental = data.instrumental === true;
  return lines.length || plain || instrumental
    ? { lines, plain, instrumental }
    : null;
}
