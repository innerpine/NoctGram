'use client';
import { useState } from 'react';
import { FileAudio, LoaderCircle } from 'lucide-react';
import type { MusicTrack } from '@/lib/music-links';
import { useMusic } from './music-provider';

export function MusicAudioUpload({
  track,
  compact = false,
  disabled,
  onSaved,
  onError,
}: {
  track: MusicTrack;
  compact?: boolean;
  disabled: boolean;
  onSaved: () => void;
  onError: (error: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const music = useMusic();
  return (
    <label
      className={
        'music-audio-upload' +
        (compact ? ' music-audio-upload-compact' : '') +
        (busy || disabled ? ' disabled' : '')
      }
      title={
        track.audioUrl
          ? 'Заменить свой аудиофайл'
          : 'Прикрепить свой аудиофайл (необязательно)'
      }
    >
      <input
        className="sr-only"
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/flac,.mp3,.wav,.ogg,.flac"
        aria-label={
          (track.audioUrl
            ? 'Заменить свой аудиофайл: '
            : 'Прикрепить свой аудиофайл (необязательно): ') + track.title
        }
        disabled={busy || disabled}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          if (file.size > 25 * 1024 * 1024) {
            onError('Аудиофайл должен быть не больше 25 МБ.');
            return;
          }
          setBusy(true);
          onError('');
          try {
            const body = new FormData();
            body.set('file', file);
            const response = await fetch(
              '/api/music/audio/' + encodeURIComponent(track.id),
              { method: 'POST', body },
            );
            const data = (await response.json()) as { error?: string };
            if (!response.ok)
              throw new Error(data.error || 'Не удалось сохранить аудиофайл.');
            if (music?.currentUrl === track.url) music.stop();
            onSaved();
          } catch (error) {
            onError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy ? (
        <LoaderCircle className="spin" size={17} />
      ) : (
        <FileAudio size={17} />
      )}
      <span className={compact ? 'sr-only' : undefined}>
        {busy ? 'Загрузка…' : track.audioUrl ? 'Заменить' : 'Свой аудиофайл'}
      </span>
    </label>
  );
}
