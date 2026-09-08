import type { CSSProperties } from 'react';

const palettes = [
  ['noct', 'Noct', '#0b0b0c', '#1b1b20', '#111113', '#242426', '#dedee6'],
  ['aurora', 'Север', '#0b1418', '#2c706c', '#12272b', '#24423f', '#b7e0d2'],
  ['dusk', 'Сумерки', '#13111e', '#625088', '#201c31', '#3d3153', '#d6c5ee'],
  [
    'rose',
    'Пыльная роза',
    '#1b1218',
    '#885669',
    '#2e1f2a',
    '#50323e',
    '#eac7d2',
  ],
  [
    'amber',
    'Тёплый свет',
    '#19150f',
    '#8d6d46',
    '#2c241b',
    '#4a3928',
    '#ecd4af',
  ],
  ['mist', 'Туман', '#141a1e', '#657c87', '#222c33', '#3a4b54', '#d1e0e7'],
  ['ocean', 'Глубина', '#0d1422', '#335c86', '#18263a', '#28405e', '#bfd6f1'],
  ['olive', 'Тихий сад', '#141811', '#616e49', '#242b1d', '#3b472e', '#d7dfb9'],
] as const;

export const CHAT_THEMES = palettes.map(
  ([id, name, base, glow, incoming, outgoing, accent]) => ({
    id,
    name,
    style: {
      '--chat-base': base,
      '--chat-backdrop':
        id === 'noct'
          ? `linear-gradient(145deg, ${base}, #101013)`
          : `radial-gradient(ellipse at 5% 12%, ${glow}66, transparent 55%), radial-gradient(ellipse at 92% 80%, ${glow}48, transparent 58%), linear-gradient(155deg, ${base}, ${incoming} 65%, ${base})`,
      '--chat-incoming': incoming + 'ed',
      '--chat-outgoing': outgoing + 'ed',
      '--chat-accent': accent,
    } as CSSProperties,
  }),
);
export type ChatThemeId = (typeof palettes)[number][0];
export type ChatThemeState = {
  shared: ChatThemeId;
  personal: ChatThemeId | null;
  revision: number;
};
export const DEFAULT_CHAT_THEME: ChatThemeState = {
  shared: 'noct',
  personal: null,
  revision: 0,
};
export function isChatTheme(id: unknown): id is ChatThemeId {
  return CHAT_THEMES.some((theme) => theme.id === id);
}
export function chatTheme(id: unknown) {
  return CHAT_THEMES.find((theme) => theme.id === id) || CHAT_THEMES[0];
}
