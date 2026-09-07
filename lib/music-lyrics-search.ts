import { readLyrics, type TrackLyrics } from './music-player';

type Recording = { title: string; artist: string; duration: number };
type Candidate = Record<string, unknown>;
// Strip publishing credits, but retain remix/live/sped-up labels: they identify recordings.
export function cleanLyricTitle(title: string) {
  return title
    .normalize('NFKC')
    .replace(
      /\s*[([]\s*(?:prod(?:uced)?\.?\s*(?:by)?\b|official\s+(?:music\s+)?(?:video|audio)\b|lyrics?\s*(?:video)?\b)[^\])]*[\])]/gi,
      ' ',
    )
    .replace(/\s*(?:\||[-–—])?\s*dir\.?\s+by\s+@[^\s]+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function words(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
function includesWords(haystack: string[], needle: string[]) {
  return needle.length > 0 && needle.every((word) => haystack.includes(word));
}
function version(value: string) {
  return words(value)
    .filter((word) =>
      [
        'remix',
        'live',
        'slowed',
        'reverb',
        'sped',
        'speed',
        'instrumental',
        'acoustic',
        'cover',
        'karaoke',
      ].includes(word),
    )
    .sort()
    .join(' ');
}
export function chooseLyricMatch(
  values: unknown,
  recording: Recording,
): TrackLyrics | null {
  if (!Array.isArray(values)) return null;
  const title = words(cleanLyricTitle(recording.title)),
    artist = words(recording.artist);
  const credits = words(
    recording.title.match(/[([]\s*prod[^\])]*[\])]/i)?.[0] || '',
  ).filter((word) => !['prod', 'produced', 'by'].includes(word));
  const matches = values
    .slice(0, 100)
    .flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Candidate;
      if (
        typeof row.trackName !== 'string' ||
        typeof row.artistName !== 'string'
      )
        return [];
      const candidateTitle = words(cleanLyricTitle(row.trackName)),
        candidateArtist = words(row.artistName);
      if (
        version(recording.title) !== version(row.trackName) ||
        !includesWords(candidateArtist, artist)
      )
        return [];
      const exact = candidateTitle.join(' ') === title.join(' ');
      // Extra title words may identify the performers, never an unrelated song/sequel.
      const extras = candidateTitle.filter(
        (word) =>
          !title.includes(word) &&
          !artist.includes(word) &&
          !candidateArtist.includes(word) &&
          !credits.includes(word) &&
          !['x', 'feat', 'ft', 'featuring', 'and'].includes(word),
      );
      if (!exact && (!includesWords(candidateTitle, title) || extras.length))
        return [];
      const lyrics = readLyrics(row, recording.duration);
      if (!lyrics) return [];
      const score =
        (exact ? 100 : 70) +
        (lyrics.lines.length ? 20 : 0) +
        (candidateArtist.join(' ') === artist.join(' ') ? 10 : 0) -
        Math.abs(Number(row.duration) * 1000 - recording.duration) / 1000;
      return [{ lyrics, score, id: Number(row.id) || 0 }];
    })
    .sort(
      (a, b) =>
        Number(!!b.lyrics.lines.length) - Number(!!a.lyrics.lines.length) ||
        b.score - a.score ||
        a.id - b.id,
    );
  return matches[0]?.lyrics || null;
}

export class LyricsRateLimit extends Error {
  constructor(public until: number) {
    super('Lyrics rate limit');
  }
}
export async function findTrackLyrics(
  recording: Recording,
  signal: AbortSignal,
  request = fetch,
): Promise<TrackLyrics | null> {
  const get = async (
    path: string,
    params: Record<string, string>,
  ): Promise<unknown> => {
    const response = await request(
      'https://lrclib.net/api/' + path + '?' + new URLSearchParams(params),
      {
        signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
    );
    if (response.status === 429) {
      const header = response.headers.get('Retry-After') || '60',
        seconds = Number(header);
      throw new LyricsRateLimit(
        Math.max(
          Date.now() + 60000,
          Number.isFinite(seconds)
            ? Date.now() + seconds * 1000
            : Date.parse(header) || 0,
        ),
      );
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Lyrics unavailable');
    return response.json();
  };
  const titles = [
    ...new Set([recording.title, cleanLyricTitle(recording.title)]),
  ];
  let plain: TrackLyrics | null = null;
  for (const title of titles) {
    let found: TrackLyrics | null;
    try {
      found = readLyrics(
        await get('get', {
          track_name: title,
          artist_name: recording.artist,
          duration: String(recording.duration / 1000),
        }),
        recording.duration,
      );
    } catch (error) {
      if (signal.aborted || error instanceof LyricsRateLimit) throw error;
      continue;
    }
    if (found?.lines.length || found?.instrumental) return found;
    plain ||= found;
  }
  // Full-text search is more tolerant of uploaded titles and multiple performers.
  try {
    const candidates = await get('search', {
      q: recording.artist + ' ' + cleanLyricTitle(recording.title),
    });
    return chooseLyricMatch(candidates, recording) || plain;
  } catch (error) {
    if (plain && !signal.aborted && !(error instanceof LyricsRateLimit))
      return plain;
    throw error;
  }
}
