'use client';
import { useSyncExternalStore } from 'react';
import {
  defaultRainOptions,
  readRainOptions,
  type RainOptions,
} from './rain-options';

export type RainPreference = RainOptions & {
  mode: 'site' | 'player' | 'off';
  player: 'full-and-dock' | 'full';
};
// No full-viewport motion by default: rain stays in the player until someone
// chooses the whole site. A saved choice (including 'site') is kept.
export const defaultRainPreference: RainPreference = {
  ...defaultRainOptions,
  mode: 'player',
  player: 'full-and-dock',
};
export function readRainPreference(value: unknown): RainPreference {
  const input = value as Partial<RainPreference> | null;
  return {
    ...readRainOptions(value),
    mode:
      input?.mode === 'off' ||
      input?.mode === 'player' ||
      input?.mode === 'site'
        ? input.mode
        : defaultRainPreference.mode,
    player: input?.player === 'full' ? 'full' : 'full-and-dock',
  };
}
export function rainEnabled(
  preference: RainPreference,
  scope: 'site' | 'full' | 'dock',
) {
  if (preference.mode === 'off') return false;
  if (scope === 'site') return preference.mode === 'site';
  return scope === 'full' || preference.player === 'full-and-dock';
}

const key = 'noctgram:rain';
const listeners = new Set<() => void>();
let current: RainPreference | undefined;
function snapshot() {
  if (!current) {
    try {
      current = readRainPreference(
        JSON.parse(localStorage.getItem(key) || 'null'),
      );
    } catch {
      current = defaultRainPreference;
    }
  }
  return current;
}
function onStorage(event: StorageEvent) {
  if (event.key !== key && event.key !== null) return;
  current = undefined;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  if (!listeners.size) {
    current = undefined;
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', onStorage);
  };
}
export function useRainPreference() {
  return useSyncExternalStore(subscribe, snapshot, () => defaultRainPreference);
}
export function saveRainPreference(patch: Partial<RainPreference>) {
  current = readRainPreference({ ...snapshot(), ...patch });
  try {
    localStorage.setItem(key, JSON.stringify(current));
  } catch {
    /* Keep the choice for this page when device storage is unavailable. */
  }
  listeners.forEach((listener) => listener());
}
