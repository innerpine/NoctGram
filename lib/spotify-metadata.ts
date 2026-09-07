import { ApiError } from './api-error';
import { parseMusicLink, type MusicTrack } from './music-links';
import { playerArtwork } from './music-player';

function decode(value: string) {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      const named: Record<string, string> = {
        '&amp;': '&',
        '&quot;': '"',
        '&apos;': "'",
        '&lt;': '<',
        '&gt;': '>',
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const hex = entity.toLowerCase().startsWith('&#x');
      const number = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : '';
    },
  );
}
export function spotifyPageMetadata(html: string) {
  const fields = new Map<string, string>();
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const attributes = new Map(
      [...match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
        (a) => [a[1].toLowerCase(), decode(a[2] ?? a[3])],
      ),
    );
    const key = attributes.get('property') || attributes.get('name');
    if (key && attributes.has('content'))
      fields.set(key, attributes.get('content')!);
  }
  const artist = (fields.get('og:description') || '').split(' · ')[0].trim();
  const authorUrl = fields.get('music:musician') || '';
  const duration = Number(fields.get('music:duration'));
  return {
    artist: artist.slice(0, 160),
    authorUrl: /^https:\/\/open\.spotify\.com\/artist\/[a-zA-Z0-9]{22}$/.test(
      authorUrl,
    )
      ? authorUrl
      : '',
    durationMs:
      Number.isFinite(duration) && duration > 0 && duration <= 86400
        ? Math.round(duration * 1000)
        : 0,
  };
}
async function boundedText(response: Response, max: number) {
  if (!response.body) throw new Error('Empty metadata');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error('Metadata too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
export async function resolveSpotifyMetadata(url: string): Promise<MusicTrack> {
  const link = parseMusicLink(url);
  if (link?.provider !== 'spotify')
    throw new ApiError(400, 'Нужна ссылка на трек Spotify.');
  try {
    const [embed, page] = await Promise.all([
      fetch(
        'https://open.spotify.com/oembed?' +
          new URLSearchParams({ url: link.url }),
        { redirect: 'manual', signal: AbortSignal.timeout(10000) },
      ),
      fetch(link.url, {
        redirect: 'manual',
        headers: { 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(10000),
      }),
    ]);
    if (!embed.ok) throw new Error('No public track');
    const info = JSON.parse(await boundedText(embed, 20000)) as Record<
      string,
      unknown
    >;
    const extra = page.ok
      ? spotifyPageMetadata(await boundedText(page, 1500000))
      : { artist: '', authorUrl: '', durationMs: 0 };
    if (typeof info.title !== 'string' || !extra.artist || !extra.authorUrl)
      throw new Error('Incomplete metadata');
    // Read public metadata only. No Spotify sessions, audio URLs, embedded scripts or media are used.
    return {
      ...link,
      id: crypto.randomUUID(),
      title: info.title.slice(0, 300),
      ...extra,
      artwork: playerArtwork(
        typeof info.thumbnail_url === 'string' ? info.thumbnail_url : '',
      ),
    };
  } catch {
    throw new ApiError(
      502,
      'Не удалось прочитать название и исполнителя Spotify. Проверьте публичную ссылку на трек и попробуйте ещё раз.',
    );
  }
}
