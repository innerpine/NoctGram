/* Fonts are loaded in the shared App Router root, not a pages route. */
/* eslint-disable next/no-page-custom-font */
import type { Metadata, Viewport } from 'next';
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
import './gifts.css';
import './dialog-motion.css';
import './music.css';
import './music-search.css';
import './music-services.css';
import './music-player.css';
import './music-lyrics-dock.css';
import './music-player-sheet.css';
import './music-activity.css';
import './music-playlists.css';
import './music-workspace.css';
import './messages-workspace.css';
import './profile-links.css';
import './chat-themes.css';
import './chat-attachments.css';
import './chat-actions.css';
import './chat-motion.css';
import './chat-emoji.css';
import './navigation.css';
import './music-queue.css';
import './account-management.css';
import './staff-panel.css';
import './channel-boosts.css';
import './viewport.css';
import { MusicProvider } from './music-provider';
import { APP_HISTORY_BOOTSTRAP } from '@/lib/app-history-bootstrap';
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};
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
        <script
          id="noctgram-history"
          dangerouslySetInnerHTML={{ __html: APP_HISTORY_BOOTSTRAP }}
        />
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
