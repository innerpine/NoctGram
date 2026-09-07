'use client';
import { useId, useRef, useState } from 'react';
import { Switch } from '@base-ui/react/switch';
import { Check, Film, LoaderCircle, Palette, RotateCw } from 'lucide-react';
import { request, upload, type Profile } from '@/lib/client';
import {
  profileThemes,
  ringCharacters,
  type ProfileTheme,
} from '@/lib/appearance';
import { avatarPoster } from '@/lib/avatar-poster';
import {
  AnimationPreference,
  appearanceStyle,
  DisplayName,
  ProfileAvatar,
} from './profile-identity';
export function ProfileDesign({
  me,
  disabled,
  onSaved,
  onPremium,
  onBusy,
}: {
  me: Profile;
  disabled?: boolean;
  onSaved: (profile: Profile) => void;
  onPremium: () => void;
  onBusy: (value: boolean) => void;
}) {
  const [theme, setTheme] = useState<ProfileTheme>(
      (me.profileTheme || 'iris') as ProfileTheme,
    ),
    [gradient, setGradient] = useState(!!me.nameGradient),
    [ring, setRing] = useState(me.ringText || ''),
    [motion, setMotion] = useState(me.avatarMotion || ''),
    [motionType, setMotionType] = useState(me.avatarMotionType || ''),
    [poster, setPoster] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    gradientId = useId(),
    fileInput = useRef<HTMLInputElement>(null);
  const preview = {
    ...me,
    premium: true,
    profileTheme: theme,
    nameGradient: gradient,
    ringText: ring,
    avatar: poster || me.avatar,
    avatarMotion: motion,
    avatarMotionType: motionType,
  };
  async function perform(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="profile-design">
      <div className="design-preview" style={appearanceStyle(preview)}>
        <span className="design-preview-label">Предпросмотр</span>
        <ProfileAvatar person={preview} size={80} />
        <h3>
          <DisplayName person={preview} />
        </h3>
        <span className="meta">@{me.handle}</span>
        <p>{me.bio || 'Твоё маленькое пространство большой ночи.'}</p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            const updated = await request<Profile>('', {
              action: 'appearance',
              theme,
              nameGradient: gradient,
              ringText: ring,
              avatarMotion: motion,
              poster,
            });
            onSaved(updated);
          });
        }}
      >
        <fieldset className="design-fields" disabled={busy || disabled}>
          <div className="design-section-heading">
            <Palette size={17} />
            <strong>Цвет профиля</strong>
          </div>
          <fieldset className="profile-palette" aria-label="Цвет профиля">
            {Object.entries(profileThemes).map(([key, value]) => (
              <button
                key={key}
                className="palette-option"
                type="button"
                aria-pressed={theme === key}
                onClick={() => setTheme(key as ProfileTheme)}
              >
                <span
                  style={{
                    background: `linear-gradient(135deg,${value.colors.join(',')})`,
                  }}
                >
                  {theme === key && <Check size={16} />}
                </span>
                <small>{value.label}</small>
              </button>
            ))}
          </fieldset>
          <label className="appearance-switch" htmlFor={gradientId}>
            <span>
              <strong>Градиентный ник</strong>
              <small>Цвет имени и значка — в одной палитре.</small>
            </span>
            <Switch.Root
              id={gradientId}
              disabled={busy || disabled}
              className="privacy-switch"
              checked={gradient}
              onCheckedChange={setGradient}
            >
              <Switch.Thumb className="privacy-switch-thumb" />
            </Switch.Root>
          </label>
          <label className="design-ring-label">
            <span>
              <RotateCw size={16} /> Текст вокруг аватара{' '}
              <small>{ringCharacters(ring).length}/48</small>
            </span>
            <input
              value={ring}
              placeholder="В своей орбите"
              maxLength={400}
              onChange={(event) =>
                setRing(
                  ringCharacters(event.target.value).slice(0, 48).join(''),
                )
              }
            />
            <small className="meta">Оставь пустым, чтобы убрать обводку.</small>
          </label>
          <div className="design-motion">
            <div className="design-section-heading">
              <Film size={17} />
              <strong>Анимированный аватар</strong>
            </div>
            <p className="meta">
              GIF, MP4 или WebM до 10 МБ. Изображение обрезается по центру в
              круг.
            </p>
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={!me.premium || busy || disabled}
                onClick={() => fileInput.current?.click()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Film size={15} />
                )}
                {motion ? 'Заменить анимацию' : 'Выбрать файл'}
              </button>
              <input
                ref={fileInput}
                className="hidden"
                type="file"
                accept="image/gif,video/mp4,video/webm"
                disabled={!me.premium || busy || disabled}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  void perform(async () => {
                    if (
                      file.size > 10 * 1024 * 1024 ||
                      !['image/gif', 'video/mp4', 'video/webm'].includes(
                        file.type,
                      )
                    )
                      throw new Error('Выбери GIF, MP4 или WebM до 10 МБ');
                    const still = await avatarPoster(file);
                    const media = await upload(file);
                    const frame = await upload(still);
                    setMotion(media.url!);
                    setMotionType(media.type);
                    setPoster(frame.url!);
                  });
                }}
              />
              {motion && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setMotion('');
                    setMotionType('');
                  }}
                >
                  Убрать анимацию
                </button>
              )}
            </div>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {me.premium ? (
            <button className="primary design-save" disabled={busy || disabled}>
              {busy ? 'Сохраняем…' : 'Сохранить оформление'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="primary design-save"
                onClick={onPremium}
              >
                Открыть Noct Premium
              </button>
              <p className="meta">
                Примеряй оформление. Для сохранения и анимированного аватара
                нужен Premium.
              </p>
            </>
          )}
        </fieldset>
      </form>
      <AnimationPreference />
    </div>
  );
}
