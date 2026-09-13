export const ONLINE_WINDOW_MS = 120000;
export const ONLINE_MINUTE_MS = 60000;
export const ONLINE_RETENTION_MS = 30 * 86400000;
export type OnlineRange = 'hour' | 'day' | 'week';
export type OnlinePoint = {
  time: number;
  average: number | null;
  peak: number | null;
  minimum: number | null;
  samples: number;
};
export type OnlineStats = {
  serverTime: number;
  online: number;
  registered: number;
  range: OnlineRange;
  step: number;
  points: OnlinePoint[];
  firstSampleAt: number | null;
  latestSampleAt: number | null;
  day: { peak: number | null; average: number | null; samples: number };
};

export function onlineRange(range: string | null, now: number) {
  const selected: OnlineRange =
    range === 'week' || range === 'hour' ? range : 'day';
  const step = selected === 'hour' ? ONLINE_MINUTE_MS : 3600000;
  const count = selected === 'hour' ? 60 : selected === 'week' ? 168 : 24;
  const end = Math.floor(now / step) * step;
  return { range: selected, step, start: end - (count - 1) * step, end, count };
}

/** Missing measurements are gaps, not zero users. */
export function onlinePoints(
  range: ReturnType<typeof onlineRange>,
  rows: OnlinePoint[],
): OnlinePoint[] {
  const measured = new Map(rows.map((row) => [row.time, row]));
  return Array.from({ length: range.count }, (_, index) => {
    const time = range.start + index * range.step;
    return (
      measured.get(time) ?? {
        time,
        average: null,
        peak: null,
        minimum: null,
        samples: 0,
      }
    );
  });
}
