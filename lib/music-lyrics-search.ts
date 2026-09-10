import { readUpstreamJson } from './upstream-json';
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
const artistConnectors = new Set(['x', 'feat', 'ft', 'featuring', 'and', 'и']);
function artistWords(value: string) {
  return words(value).filter((word) => !artistConnectors.has(word));
}
function recordingIdentities(recording: Recording): Recording[] {
  let title = cleanLyricTitle(recording.title);
  const uploaderSuffix = ' by ' + recording.artist.trim();
  if (
    recording.artist.trim() &&
    title.toLowerCase().endsWith(uploaderSuffix.toLowerCase())
  )
    title = title.slice(0, -uploaderSuffix.length).trim();
  const identities = [{ ...recording, title }];
  // SoundCloud's artist can be the uploader. Recover the performers from an
  // explicit title separator, then require BOTH fields to match a catalog row.
  // Keep hyphens within names/titles (e.g. J-Hope) and recording version labels.
  const parts = title.split(/\s+[-–—|]\s+/);
  if (parts.length === 2 && parts.every((part) => words(part).length)) {
    identities.push(
      { ...recording, artist: parts[0], title: parts[1] },
      { ...recording, artist: parts[1], title: parts[0] },
    );
  }
  return identities;
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
  const identities = recordingIdentities(recording);
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
      const lyrics = readLyrics(row, recording.duration);
      if (!lyrics) return [];
      let score = -Infinity;
      // Community entries sometimes reverse trackName and artistName. This is
      // only accepted when both reversed fields match, never by title alone.
      const orientations = [
        { title: row.trackName, artist: row.artistName },
        { title: row.artistName, artist: row.trackName },
      ];
      for (const [index, candidate] of orientations.entries()) {
        const candidateTitle = words(cleanLyricTitle(candidate.title)),
          candidateArtist = artistWords(candidate.artist);
        for (const [identityIndex, identity] of identities.entries()) {
          const title = words(identity.title),
            artist = artistWords(identity.artist);
          if (
            version(identity.title) !== version(candidate.title) ||
            version(identity.artist) !== version(candidate.artist) ||
            !includesWords(candidateArtist, artist) ||
            (identityIndex > 0 && !includesWords(artist, candidateArtist))
          )
            continue;
          const exact = candidateTitle.join(' ') === title.join(' ');
          // Extra words may be performer/producer credits, not another song.
          const extras = candidateTitle.filter(
            (word) =>
              !title.includes(word) &&
              !artist.includes(word) &&
              !candidateArtist.includes(word) &&
              !credits.includes(word) &&
              !artistConnectors.has(word),
          );
          if (
            !exact &&
            (!includesWords(candidateTitle, title) || extras.length)
          )
            continue;
          score = Math.max(
            score,
            (exact ? 100 : 70) +
              (lyrics.lines.length ? 20 : 0) +
              (includesWords(artist, candidateArtist) ? 10 : 0) -
              index * 15 -
              Math.abs(Number(row.duration) * 1000 - recording.duration) / 1000,
          );
        }
      }
      if (!Number.isFinite(score)) return [];
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

export class LyricsUnavailable extends Error {
  constructor(public until: number) {
    super('Lyrics unavailable');
  }
}
export class LyricsRateLimit extends LyricsUnavailable {}
export async function findTrackLyrics(
  recording: Recording,
  signal: AbortSignal,
  request: typeof fetch = (input, init) => fetch(input, init),
): Promise<TrackLyrics | null> {
  const search = async (query: string): Promise<unknown> => {
    signal.throwIfAborted();
    const response = await request(
      'https://lrclib.net/api/search?' + new URLSearchParams({ q: query }),
      {
        signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
    );
    if (response.status === 429 || response.status >= 500) {
      const header = response.headers.get('Retry-After') || '60',
        seconds = Number(header);
      const Failure =
        response.status === 429 ? LyricsRateLimit : LyricsUnavailable;
      throw new Failure(
        Math.max(
          Date.now() + 60000,
          Number.isFinite(seconds)
            ? Date.now() + seconds * 1000
            : Date.parse(header) || 0,
        ),
      );
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new LyricsUnavailable(Date.now() + 60000);
    return readUpstreamJson(response);
  };
  const identities = recordingIdentities(recording);
  // Search returns an empty array for a missing song. Avoid a chain of exact
  // /get probes (each missing variant produced a browser-level 404 error).
  // Matching below still requires artist, title, recording version and duration.
  const queries = [...identities.slice(1), identities[0]].map(
    (identity) => identity.artist + ' ' + identity.title,
  );
  const seen = new Set<string>();
  for (const query of queries) {
    const signature = words(query).sort().join(' ');
    if (seen.has(signature)) continue;
    seen.add(signature);
    const found = chooseLyricMatch(await search(query), recording);
    if (found) return found;
  }
  return null;
}
