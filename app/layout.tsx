/* Fonts are loaded in the shared App Router root, not a pages route. */
/* eslint-disable next/no-page-custom-font */
import type { Metadata } from 'next';
import './globals.css';
import './redesign.css';
import './features.css';
import './account-states.css';
import './auth.css';
import './content-moderation.css';
import './privacy.css';
import './realtime.css';
import './profile-design.css';
import './telegram-stars.css';
import './stars-topup.css';
import './dialog-motion.css';
import './music.css';
import './music-services.css';
import './music-player.css';
import { MusicProvider } from './music-provider';
export const metadata: Metadata = {
  title: 'Noctgram — лента и диалоги',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Noctgram',
    statusBarStyle: 'black-translucent',
  },
  icons: { icon: '/assets/noctgram-logo.png' },
  description:
    'Публикации, фотографии, опросы и личные диалоги. Твоё пространство в Noctgram.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Instrument+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <MusicProvider>{children}</MusicProvider>
      </body>
    </html>
  );
}
