import './commerce.css';
import './premium-emoji.css';
import './chat-archive.css';
/* Fonts are loaded in the shared App Router root, not a pages route. */
/* eslint-disable next/no-page-custom-font */
import type { Metadata, Viewport } from 'next';
import './globals.css';
import './redesign.css';
import './features.css';
import './chat-rooms.css';
import './room-conversation.css';
import './account-states.css';
import './auth.css';
import './content-moderation.css';
import './privacy.css';
import './realtime.css';
import './profile-design.css';
import './telegram-stars.css';
import './stars-topup.css';
import './gifts.css';
import './giveaways.css';
import './gift-upgrades.css';
import './dialog-motion.css';
import './music.css';
import './music-charts.css';
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
import './message-reactions.css';
import './message-reply-gesture.css';
import './chat-peer-profile.css';
import './chat-video-player.css';
import './navigation.css';
import './music-queue.css';
import './account-management.css';
import './staff-panel.css';
import './admin-access.css';
import './antispam.css';
import './channel-boosts.css';
import './viewport.css';
import './mobile-navigation.css';
import './profile-workspace.css';
import './settings.css';
import './rain.css';
import { RainEffect } from './rain-effect';
import { MusicProvider } from './music-provider';
import { APP_HISTORY_BOOTSTRAP } from '@/lib/app-history-bootstrap';
import { SITE_URL, SITE_DESCRIPTION } from '@/lib/site-metadata';
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: 'Noctgram',
  title: 'Noctgram — социальная сеть и мессенджер',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Noctgram',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
      ...[16, 32, 48].map((size) => ({
        url: `/favicon-${size}.png`,
        sizes: `${size}x${size}`,
        type: 'image/png',
      })),
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  description: SITE_DESCRIPTION,
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
        <RainEffect scope="site" />
        <MusicProvider>{children}</MusicProvider>
      </body>
    </html>
  );
}
