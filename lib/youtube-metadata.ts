import { readUpstreamJson } from './upstream-json';
import { ApiError } from './api-error';
import { parseMusicLink, type MusicTrack } from './music-links';

export async function resolveYouTubeMetadata(url: string): Promise<MusicTrack> {
  const link = parseMusicLink(url);
  if (link?.provider !== 'youtube')
    throw new ApiError(400, 'Нужна ссылка на видео YouTube.');
  let response: Response;
  try {
    response = await fetch(
      'https://www.youtube.com/oembed?' +
        new URLSearchParams({ url: link.url, format: 'json' }),
      {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch {
    throw new ApiError(502, 'YouTube не отвечает. Попробуйте позже.');
  }
  if (!response.ok)
    throw new ApiError(
      422,
      'Видео недоступно или автор запретил встраивание. Попробуйте другую ссылку.',
    );
  const info = (await readUpstreamJson(response, 65536)) as Record<
    string,
    unknown
  >;
  if (typeof info.title !== 'string' || typeof info.author_name !== 'string')
    throw new ApiError(502, 'Не удалось получить название видео YouTube.');
  const id = new URL(link.url).searchParams.get('v')!;
  return {
    ...link,
    id: crypto.randomUUID(),
    title: info.title.slice(0, 300),
    artist: info.author_name.slice(0, 160),
    artwork: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
    authorUrl:
      typeof info.author_url === 'string' &&
      /^https:\/\/www\.youtube\.com\/(?:@|channel\/|user\/)[\w%.-]+$/.test(
        info.author_url,
      )
        ? info.author_url
        : link.url,
  };
}
