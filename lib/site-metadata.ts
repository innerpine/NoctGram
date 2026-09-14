import type { Metadata } from 'next';

export const SITE_URL = 'https://noctgram.com';
export const SITE_NAME = 'Noctgram';
export const SITE_DESCRIPTION =
  'Noctgram — социальная сеть и мессенджер: публикации, каналы, личные и общие чаты, музыка и плейлисты.';

export const SITE_WEBSITE = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: SITE_NAME,
  alternateName: 'Ноктграм',
  url: `${SITE_URL}/`,
  description: SITE_DESCRIPTION,
  inLanguage: 'ru',
};

export const ACCOUNT_ROBOTS: Metadata['robots'] = {
  index: false,
  follow: false,
};

export function publicPageMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  const url = new URL(path, SITE_URL).href;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: 'website',
      locale: 'ru_RU',
      images: [
        {
          url: `${SITE_URL}/icon-512.png`,
          width: 512,
          height: 512,
          alt: SITE_NAME,
        },
      ],
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: [`${SITE_URL}/icon-512.png`],
    },
  };
}
