'use client';
import { useId } from 'react';
import { CloudRain, Monitor, Headphones, Power } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { saveRainPreference, useRainPreference } from '@/lib/rain-preference';

const modes = [
  { value: 'site', label: 'Весь сайт', icon: Monitor },
  { value: 'player', label: 'Только плеер', icon: Headphones },
  { value: 'off', label: 'Выключен', icon: Power },
] as const;
export function RainSettings({ compact = false }: { compact?: boolean }) {
  const preference = useRainPreference();
  const id = useId();
  return (
    <fieldset
      className={'rain-settings' + (compact ? ' rain-settings-compact' : '')}
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
              saveRainPreference({ player: checked ? 'full-and-dock' : 'full' })
            }
          />
        </div>
      )}
      <p className="rain-preference-note">
        На этом устройстве. При уменьшении движения в системе дождь отключается.
      </p>
    </fieldset>
  );
}
