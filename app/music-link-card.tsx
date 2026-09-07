'use client';
import { ArrowUpRight, Play } from 'lucide-react';
import { findMusicLink, musicLabel } from '@/lib/music-links';
import { useMusic } from './music-provider';

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
          <small>
            SoundCloud · {link.kind === 'playlist' ? 'плейлист' : 'трек'}
          </small>
        </span>
      </button>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Открыть в SoundCloud"
      >
        <ArrowUpRight size={18} />
      </a>
    </div>
  );
}
