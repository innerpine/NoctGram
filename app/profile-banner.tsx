'use client';
// Uploaded banners are private media behind the session; next/image cannot fetch them.
/* eslint-disable next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { ImageUp, Image as ImageIcon, LoaderCircle, X } from 'lucide-react';
import { LIQUID_COVER } from '@/lib/profile-cover';
import { uploadPhoto } from '@/lib/profile-image';
import { LiquidCover } from './liquid-cover';

/**
 * «Баннер» at the top of «Дизайн», where people look for it. It edits the
 * profile draft's cover; «Сохранить баннер» saves the profile and keeps the
 * editor open. An upload only busies this block: the rest of the editor stays
 * usable, and closing it cancels the upload.
 */
export function ProfileBanner({
  cover,
  saved,
  avatar,
  disabled,
  saving,
  onChange,
  onSave,
}: {
  cover: string;
  saved: string;
  avatar: string;
  disabled?: boolean;
  saving?: boolean;
  onChange: (cover: string) => void;
  onSave: () => void;
}) {
  const [uploading, setUploading] = useState(false),
    [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const pick = async (file: File) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setUploading(true);
    setError('');
    try {
      const media = await uploadPhoto(file, 2048, controller.signal);
      onChange(media.url!);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setUploading(false);
      }
    }
  };
  const busy = disabled || uploading;
  return (
    <section className="design-background design-banner" aria-label="Баннер">
      <div className="design-section-heading">
        <ImageIcon size={17} />
        <strong>Баннер</strong>
      </div>
      <div className="edit-cover" data-empty={!cover || undefined}>
        {cover === LIQUID_COVER ? (
          <LiquidCover src={avatar} />
        ) : cover ? (
          <img src={cover} alt="Баннер" />
        ) : (
          <span>Без баннера</span>
        )}
        {uploading ? (
          <output className="design-banner-status">
            <LoaderCircle className="spin" size={15} /> Загружаем…
          </output>
        ) : (
          cover && (
            <button
              type="button"
              aria-label="Убрать баннер"
              disabled={disabled}
              onClick={() => onChange('')}
            >
              <X size={14} />
            </button>
          )
        )}
      </div>
      <div className="edit-photo">
        <label className="secondary" aria-disabled={busy || undefined}>
          <ImageUp size={14} />{' '}
          {cover && cover !== LIQUID_COVER ? 'Заменить' : 'Загрузить'}
          <input
            className="hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void pick(file);
            }}
          />
        </label>
        <button
          type="button"
          className="secondary"
          aria-pressed={cover === LIQUID_COVER}
          disabled={busy}
          title="Живой фон из цветов аватарки вместо своей картинки"
          onClick={() => onChange(LIQUID_COVER)}
        >
          Жидкое
        </button>
      </div>
      {cover === LIQUID_COVER && !avatar && (
        <p>«Жидкое» строится из аватарки — добавь её, и фон появится.</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {cover !== saved && (
        <button
          type="button"
          className="primary"
          disabled={busy || saving}
          onClick={onSave}
        >
          Сохранить баннер
        </button>
      )}
      <p>
        JPG, PNG или WebP. Большие фото уменьшаем до 2048 px и убираем из них
        данные камеры и геопозицию.
      </p>
    </section>
  );
}
