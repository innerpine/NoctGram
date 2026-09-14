'use client';
import { Palette } from 'lucide-react';
import type { ProfileBackground } from '@/lib/profile-background';
const modes = [
  ['none', 'Без фона'],
  ['theme', 'Цвет оформления'],
  ['cover', 'Баннер и аватар'],
  ['custom', 'Своя палитра'],
] as const;
const patterns = [
  ['none', 'Чистый'],
  ['stardust', 'Звёздная пыль'],
  ['orbits', 'Орбиты'],
] as const;
export function ProfileBackgroundSettings({
  value,
  onChange,
}: {
  value: ProfileBackground;
  onChange: (value: ProfileBackground) => void;
}) {
  return (
    <section className="design-background" aria-label="Фон профиля">
      <div className="design-section-heading">
        <Palette size={17} />
        <strong>Фон профиля</strong>
        <span className="design-premium-label">Noct Premium</span>
      </div>
      <p>Мягкое свечение под твоё оформление, обложку или любимые цвета.</p>
      <fieldset className="background-modes" aria-label="Источник цветов фона">
        {modes.map(([mode, label]) => (
          <button
            type="button"
            key={mode}
            aria-pressed={value.mode === mode}
            onClick={() => onChange({ ...value, mode })}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {value.mode === 'cover' && (
        <p>Берём цвета баннера. Если его нет — аватарки.</p>
      )}
      {value.mode === 'custom' && (
        <div className="background-colors">
          {(['first', 'second'] as const).map((key, index) => (
            <label key={key}>
              <input
                type="color"
                aria-label={
                  index === 0 ? 'Первый цвет фона' : 'Второй цвет фона'
                }
                value={value[key]}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
              />
              <span>
                {index === 0 ? 'Первый цвет' : 'Второй цвет'}
                <small>{value[key].toUpperCase()}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      {value.mode !== 'none' && (
        <label className="background-intensity">
          <span>
            Интенсивность <output>{value.intensity}%</output>
          </span>
          <input
            type="range"
            min={15}
            max={40}
            step={1}
            value={value.intensity}
            aria-label="Интенсивность фона"
            onChange={(e) =>
              onChange({ ...value, intensity: Number(e.target.value) })
            }
          />
        </label>
      )}
      <fieldset className="profile-pattern-choices">
        <legend>Узор</legend>
        {patterns.map(([pattern, label]) => (
          <button
            key={pattern}
            type="button"
            aria-pressed={value.pattern === pattern}
            onClick={() => onChange({ ...value, pattern })}
          >
            <span
              className="profile-pattern-swatch profile-decoration-surface"
              data-profile-pattern={pattern}
              aria-hidden="true"
            />
            <span>{label}</span>
          </button>
        ))}
      </fieldset>
    </section>
  );
}
