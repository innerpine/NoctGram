'use client';
import { useId } from 'react';
import { CloudRain, Monitor, Headphones, Power } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  defaultRainOptions,
  rainFrameRates,
  rainRanges,
  type RainOptions,
} from '@/lib/rain-options';
import { saveRainPreference, useRainPreference } from '@/lib/rain-preference';

const modes = [
  { value: 'site', label: 'Весь сайт', icon: Monitor },
  { value: 'player', label: 'Только плеер', icon: Headphones },
  { value: 'off', label: 'Выключен', icon: Power },
] as const;
const controls = [
  { key: 'intensity', label: 'Количество капель' },
  { key: 'speed', label: 'Скорость падения' },
  { key: 'brightness', label: 'Яркость капель' },
] as const;
export function RainSettings({ compact = false }: { compact?: boolean }) {
  const preference = useRainPreference();
  const id = useId();
  return (
    <fieldset
      className={'rain-settings' + (compact ? ' rain-settings-compact' : '')}
      data-rain-safe
    >
      <legend>
        <CloudRain size={18} /> Дождь на фоне
      </legend>
      <div className="rain-mode-options">
        {modes.map(({ value, label, icon: Icon }) => (
          <label className="rain-mode-option" key={value}>
            <input
              type="radio"
              name={id}
              value={value}
              checked={preference.mode === value}
              onChange={() => saveRainPreference({ mode: value })}
            />
            <span>
              <Icon size={19} />
              {label}
            </span>
          </label>
        ))}
      </div>
      {preference.mode !== 'off' && (
        <>
          <div className="rain-dock-option">
            <label htmlFor={id + '-dock'}>
              <strong>В панели текста справа</strong>
              <small>
                {preference.mode === 'player'
                  ? 'Выключи, чтобы дождь был только в полном плеере.'
                  : 'Можно оставить панель текста без дождя.'}
              </small>
            </label>
            <Switch
              id={id + '-dock'}
              checked={preference.player === 'full-and-dock'}
              onCheckedChange={(checked) =>
                saveRainPreference({
                  player: checked ? 'full-and-dock' : 'full',
                })
              }
            />
          </div>
          <div className="rain-tuning">
            <div className="rain-fps-row">
              <label htmlFor={id + '-fps'}>Частота кадров</label>
              <select
                id={id + '-fps'}
                value={preference.fps}
                aria-describedby={id + '-fps-hint'}
                onChange={(event) =>
                  saveRainPreference({
                    fps:
                      event.target.value === 'auto'
                        ? 'auto'
                        : (Number(event.target.value) as RainOptions['fps']),
                  })
                }
              >
                {rainFrameRates.map((fps) => (
                  <option key={fps} value={fps}>
                    {fps === 'auto' ? 'Авто' : `${fps} FPS`}
                  </option>
                ))}
              </select>
            </div>
            <p id={id + '-fps-hint'} className="rain-control-hint">
              {preference.fps === 'auto'
                ? '60 FPS на ПК, 30 FPS на телефоне.'
                : 'Частота ограничена возможностями экрана и устройства.'}
            </p>
            {controls.map(({ key, label }) => (
              <div className="rain-range" key={key}>
                <div className="rain-range-label">
                  <span>{label}</span>
                  <output>
                    {key === 'speed'
                      ? `${(preference[key] / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}×`
                      : `${preference[key]}%`}
                  </output>
                </div>
                <Slider
                  aria-label={label}
                  {...rainRanges[key]}
                  value={[preference[key]]}
                  onValueChange={(value) =>
                    saveRainPreference({
                      [key]: Array.isArray(value) ? value[0] : value,
                    })
                  }
                />
              </div>
            ))}
            <button
              className="rain-reset"
              type="button"
              disabled={Object.entries(defaultRainOptions).every(
                ([key, value]) =>
                  preference[key as keyof RainOptions] === value,
              )}
              onClick={() => saveRainPreference(defaultRainOptions)}
            >
              Сбросить параметры
            </button>
          </div>
        </>
      )}
      <p className="rain-preference-note">
        На этом устройстве. При уменьшении движения в системе дождь отключается.
      </p>
    </fieldset>
  );
}
