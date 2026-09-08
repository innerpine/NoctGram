'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Link2, LoaderCircle, Plus, Play } from 'lucide-react';
import {
  musicRequest,
  parseMusicLink,
  type MusicTrack,
} from '@/lib/music-links';
import { useMusic } from '@/lib/music-context';

export function MusicYouTubeService({
  signedIn,
  readOnly,
}: {
  signedIn: boolean;
  readOnly: boolean;
}) {
  const music = useMusic();
  const [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="service-connection-card">
      <div className="service-card-top">
        <span>YouTube и YouTube Music</span>
        <span className="service-state connected">По ссылке</span>
      </div>
      <div className="service-connected">
        <Play size={38} />
        <h3>Музыка из YouTube</h3>
        <p>
          Добавьте ссылку на видео или песню из YouTube Music. Подключать
          аккаунт не нужно.
        </p>
      </div>
      {signedIn ? (
        <form
          className="music-link-search"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || readOnly) return;
            const link = parseMusicLink(url);
            if (link?.provider !== 'youtube') {
              setError(
                'Вставьте ссылку на видео YouTube или песню YouTube Music.',
              );
              return;
            }
            setBusy(true);
            setError('');
            try {
              const track = await musicRequest<MusicTrack>('save', {
                url: link.url,
              });
              setUrl('');
              music?.play(track);
              window.dispatchEvent(new Event('noctgram:music-refresh'));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Link2 size={18} />
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Ссылка YouTube или YouTube Music"
            aria-label="Ссылка YouTube"
            disabled={busy || readOnly}
          />
          <button
            className="music-link-submit"
            aria-label="Добавить и слушать"
            disabled={busy || readOnly || !url.trim()}
          >
            {busy ? (
              <LoaderCircle size={20} className="spin" />
            ) : (
              <Plus size={20} />
            )}
          </button>
        </form>
      ) : (
        <Link href="/login" className="primary">
          Войти в Noctgram
        </Link>
      )}
      {error && (
        <div className="music-error" role="alert">
          {error}
        </div>
      )}
      <p className="music-muted">
        Треки появятся в «Моей музыке». Громкость и перемотка — в плеере
        Noctgram.
      </p>
    </section>
  );
}
