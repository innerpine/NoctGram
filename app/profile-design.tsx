'use client';
import { useId, useRef, useState } from 'react';
import { Switch } from '@base-ui/react/switch';
import { Slider } from '@base-ui/react/slider';
import {
  Check,
  Film,
  Headphones,
  LoaderCircle,
  Palette,
  RotateCw,
} from 'lucide-react';
import { request, upload, type Profile } from '@/lib/client';
import {
  profileThemes,
  ringCharacters,
  chromeTempo,
  type ProfileTheme,
} from '@/lib/appearance';
import { avatarPoster } from '@/lib/avatar-poster';
import { readProfileBackground } from '@/lib/profile-background';
import { ProfileBackgroundSettings } from './profile-background-settings';
import { useProfileBackground } from './profile-surface';
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
  const channel = me.kind === 'channel';
  const level = channel ? me.boostLevel || 0 : 5;
  const canSave = channel ? level >= 1 : !!me.premium;
  const [background, setBackground] = useState(() =>
    readProfileBackground(me.profileBackground),
  );
  const [theme, setTheme] = useState<ProfileTheme>(
      (me.profileTheme || 'iris') as ProfileTheme,
    ),
    [gradient, setGradient] = useState(!!me.nameGradient),
    [ring, setRing] = useState(me.ringText || ''),
    [chrome, setChrome] = useState(!!me.chromeFlow),
    [tempo, setTempo] = useState<number>(me.chromeTempo || chromeTempo.default),
    [motion, setMotion] = useState(me.avatarMotion || ''),
    [motionType, setMotionType] = useState(me.avatarMotionType || ''),
    [poster, setPoster] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    gradientId = useId(),
    chromeId = useId(),
    tempoId = useId(),
    fileInput = useRef<HTMLInputElement>(null);
  const [previousLevel, setPreviousLevel] = useState(level);
  if (previousLevel !== level) {
    setPreviousLevel(level);
    if (channel && level > previousLevel) {
      // Locked fields were masked in the profile response. Restore just the
      // newly unlocked fields without replacing drafts that stayed editable.
      if (previousLevel < 1 && level >= 1)
        setTheme((me.profileTheme || 'iris') as ProfileTheme);
      if (previousLevel < 2 && level >= 2) setGradient(!!me.nameGradient);
      if (previousLevel < 3 && level >= 3) {
        setChrome(!!me.chromeFlow);
        setTempo(me.chromeTempo || chromeTempo.default);
      }
      if (previousLevel < 4 && level >= 4) setRing(me.ringText || '');
      if (previousLevel < 5 && level >= 5) {
        setMotion(me.avatarMotion || '');
        setMotionType(me.avatarMotionType || '');
        setPoster('');
      }
    }
  }
  const preview = {
    ...me,
    premium: !channel,
    boostLevel: channel ? Math.max(1, level) : 0,
    profileTheme: theme,
    profileBackground: JSON.stringify(background),
    nameGradient: gradient,
    ringText: ring,
    chromeFlow: chrome,
    chromeTempo: tempo,
    avatar: poster || me.avatar,
    avatarMotion: motion,
    avatarMotionType: motionType,
  };
  const surface = useProfileBackground(preview);
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
      <div
        className="design-preview"
        data-profile-background={!!surface}
        style={{ ...appearanceStyle(preview), ...surface }}
      >
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
              id: me.id,
              theme,
              nameGradient: gradient,
              ringText: ring,
              chromeFlow: chrome,
              chromeTempo: tempo,
              avatarMotion: motion,
              poster,
              ...(!channel ? { background } : {}),
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
                disabled={channel && level < 1}
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
          {!channel && (
            <>
              <ProfileBackgroundSettings
                value={background}
                onChange={setBackground}
              />
              <section className="design-background" aria-label="Статус музыки">
                <div className="design-section-heading">
                  <Headphones size={17} />
                  <strong>Статус музыки</strong>
                </div>
                <fieldset
                  className="background-modes music-color-modes"
                  aria-label="Цвет статуса музыки"
                >
                  <button
                    type="button"
                    aria-pressed={background.musicColor === 'profile'}
                    onClick={() =>
                      setBackground({ ...background, musicColor: 'profile' })
                    }
                  >
                    Цвет профиля
                  </button>
                  <button
                    type="button"
                    aria-pressed={background.musicColor === 'cover'}
                    onClick={() =>
                      setBackground({ ...background, musicColor: 'cover' })
                    }
                  >
                    Цвет обложки
                  </button>
                </fieldset>
                <p>
                  {background.musicColor === 'profile'
                    ? 'Фон и акценты карточки — в выбранной палитре профиля.'
                    : 'Фон и акценты карточки меняются под обложку песни.'}
                </p>
              </section>
            </>
          )}
          <label className="appearance-switch" htmlFor={gradientId}>
            <span>
              <strong>
                Градиентный ник{' '}
                {channel && level < 2 && <small>· Уровень 2</small>}
              </strong>
              <small>Цвет имени и значка — в одной палитре.</small>
            </span>
            <Switch.Root
              id={gradientId}
              disabled={busy || disabled || (channel && level < 2)}
              className="privacy-switch"
              checked={gradient}
              onCheckedChange={setGradient}
            >
              <Switch.Thumb className="privacy-switch-thumb" />
            </Switch.Root>
          </label>
          <div className="design-chrome" style={appearanceStyle(preview)}>
            <label className="appearance-switch" htmlFor={chromeId}>
              <span>
                <strong>
                  Chrome Flow{' '}
                  {channel && level < 3 && <small>· Уровень 3</small>}
                </strong>
                <small>Металлический блик в цветах профиля.</small>
              </span>
              <Switch.Root
                id={chromeId}
                className="privacy-switch"
                checked={chrome}
                onCheckedChange={setChrome}
                disabled={busy || disabled || (channel && level < 3)}
              >
                <Switch.Thumb className="privacy-switch-thumb" />
              </Switch.Root>
            </label>
            {chrome && (
              <div className="chrome-tempo-setting">
                <div className="chrome-tempo-heading">
                  <span id={tempoId}>Темп переливания</span>
                  <output>
                    {(chromeTempo.default / tempo).toLocaleString('ru-RU', {
                      maximumFractionDigits: 2,
                    })}
                    ×
                  </output>
                </div>
                <Slider.Root
                  className="chrome-tempo-slider"
                  min={chromeTempo.min}
                  max={chromeTempo.max}
                  step={1}
                  value={chromeTempo.max + chromeTempo.min - tempo}
                  onValueChange={(value) =>
                    setTempo(chromeTempo.max + chromeTempo.min - value)
                  }
                  disabled={busy || disabled || (channel && level < 3)}
                  thumbAlignment="edge"
                >
                  <Slider.Control className="chrome-tempo-control">
                    <Slider.Track className="chrome-tempo-track">
                      <Slider.Indicator className="chrome-tempo-fill" />
                    </Slider.Track>
                    <Slider.Thumb
                      className="chrome-tempo-thumb"
                      aria-labelledby={tempoId}
                      aria-valuetext={`${(chromeTempo.default / tempo).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} от обычного темпа`}
                    />
                  </Slider.Control>
                </Slider.Root>
                <div className="chrome-tempo-scale">
                  <span>Спокойнее</span>
                  <span>Быстрее</span>
                </div>
              </div>
            )}
          </div>
          <label className="design-ring-label">
            <span>
              <RotateCw size={16} /> Текст вокруг аватара{' '}
              <small>{ringCharacters(ring).length}/48</small>
            </span>
            <input
              value={ring}
              disabled={channel && level < 4}
              placeholder="В своей орбите"
              maxLength={400}
              onChange={(event) =>
                setRing(
                  ringCharacters(event.target.value).slice(0, 48).join(''),
                )
              }
            />
            <small className="meta">
              {channel && level < 4
                ? 'Открывается на 4 уровне канала.'
                : 'Оставь пустым, чтобы убрать обводку.'}
            </small>
          </label>
          <div className="design-motion">
            <div className="design-section-heading">
              <Film size={17} />
              <strong>
                Анимированный аватар{' '}
                {channel && level < 5 && <small>· Уровень 5</small>}
              </strong>
            </div>
            <p className="meta">
              GIF, MP4 или WebM до 10 МБ. Изображение обрезается по центру в
              круг.
            </p>
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={!canSave || level < 5 || busy || disabled}
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
                disabled={!canSave || level < 5 || busy || disabled}
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
                  disabled={channel && level < 5}
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
          {canSave ? (
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
                {channel ? 'Открыть бусты канала' : 'Открыть Noct Premium'}
              </button>
              <p className="meta">
                {channel
                  ? 'Оформление открывается с 1 уровня бустов канала.'
                  : 'Примеряй оформление. Для сохранения и анимированного аватара нужен Premium.'}
              </p>
            </>
          )}
        </fieldset>
      </form>
      <AnimationPreference />
    </div>
  );
}
