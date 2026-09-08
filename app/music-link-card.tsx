'use client';
import { Play } from 'lucide-react';
import {
  findMusicLink,
  musicLabel,
  musicProviderName,
} from '@/lib/music-links';
import { useMusic } from '@/lib/music-context';

export function MusicLinkCard({ text }: { text: string }) {
  // Reading a private message does not send its URL to SoundCloud.
  const music = useMusic(),
    link = findMusicLink(text);
  if (!link || !music) return null;
  return (
    <div className="music-link-card">
      <button
        aria-label={'Слушать ' + musicLabel(link)}
        onClick={() => music.play(link)}
      >
        <span className="music-link-icon">
          <Play size={18} fill="currentColor" />
        </span>
        <span>
          <strong>{musicLabel(link)}</strong>
          <small>{link.kind === 'playlist' ? 'Плейлист' : 'Трек'}</small>
        </span>
      </button>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="music-source"
        aria-label={'Источник: ' + musicProviderName(link.provider)}
      >
        {musicProviderName(link.provider)}
      </a>
    </div>
  );
}
