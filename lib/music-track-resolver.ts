import { db } from './storage';
import { ApiError } from './api-error';
import { resolveSpotifyMetadata } from './spotify-metadata';
import { resolveYouTubeMetadata } from './youtube-metadata';
import type { MusicLink, MusicTrack } from './music-links';

export async function resolveTrack(link: MusicLink): Promise<MusicTrack> {
  const existing = await db()
    .prepare('SELECT * FROM music_tracks WHERE url=?')
    .bind(link.url)
    .first<MusicTrack>();
  if (existing) return existing;
  if (link.provider === 'spotify' || link.provider === 'youtube') {
    const track = await (link.provider === 'youtube'
      ? resolveYouTubeMetadata(link.url)
      : resolveSpotifyMetadata(link.url));
    await db()
      .prepare(
        'INSERT OR IGNORE INTO music_tracks(id,url,kind,provider,title,artist,artwork,authorUrl,durationMs,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        track.id,
        track.url,
        track.kind,
        track.provider,
        track.title,
        track.artist,
        track.artwork,
        track.authorUrl,
        track.durationMs || 0,
        Date.now(),
      )
      .run();
    return (await db()
      .prepare('SELECT * FROM music_tracks WHERE url=?')
      .bind(link.url)
      .first<MusicTrack>())!;
  }
  // Fixed endpoint, canonical public URL, no redirects, no client-provided HTML.
  let response: Response;
  try {
    response = await fetch(
      'https://soundcloud.com/oembed?' +
        new URLSearchParams({ format: 'json', url: link.url }),
      { redirect: 'manual', signal: AbortSignal.timeout(8000) },
    );
  } catch (error) {
    console.warn(
      'SoundCloud oEmbed request failed:',
      error instanceof Error ? error.message : 'Network error',
    );
    throw new ApiError(502, 'SoundCloud не отвечает. Попробуйте позже.');
  }
  if (!response.ok)
    throw new ApiError(
      422,
      'SoundCloud не нашёл публичную запись по этой ссылке.',
    );
  const info = (await response.json()) as {
    title?: unknown;
    author_name?: unknown;
    author_url?: unknown;
    thumbnail_url?: unknown;
  };
  if (typeof info.title !== 'string' || typeof info.author_name !== 'string')
    throw new ApiError(
      422,
      'Не удалось получить название записи из SoundCloud.',
    );
  const author = typeof info.author_url === 'string' ? info.author_url : '';
  if (!/^https:\/\/soundcloud\.com\/[a-zA-Z0-9_-]+\/?$/.test(author))
    throw new ApiError(422, 'Не удалось проверить автора записи.');
  const artwork =
    typeof info.thumbnail_url === 'string' &&
    /^https:\/\/i\d+\.sndcdn\.com\//.test(info.thumbnail_url)
      ? info.thumbnail_url
      : '';
  const track: MusicTrack = {
    ...link,
    id: crypto.randomUUID(),
    title: info.title.slice(0, 300),
    artist: info.author_name.slice(0, 160),
    artwork,
    authorUrl: author,
  };
  await db()
    .prepare(
      'INSERT OR IGNORE INTO music_tracks(id,url,kind,provider,title,artist,artwork,authorUrl,created) VALUES(?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      track.id,
      track.url,
      track.kind,
      track.provider,
      track.title,
      track.artist,
      track.artwork,
      track.authorUrl,
      Date.now(),
    )
    .run();
  return (await db()
    .prepare('SELECT * FROM music_tracks WHERE url=?')
    .bind(link.url)
    .first<MusicTrack>())!;
}
