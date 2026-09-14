import Noctgram from './noctgram';
import {
  publicPageMetadata,
  SITE_DESCRIPTION,
  SITE_WEBSITE,
} from '@/lib/site-metadata';

export const metadata = publicPageMetadata(
  'Noctgram — социальная сеть и мессенджер',
  SITE_DESCRIPTION,
  '/',
);

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(SITE_WEBSITE).replace(/</g, '\\u003c'),
        }}
      />
      <Noctgram />
    </>
  );
}
