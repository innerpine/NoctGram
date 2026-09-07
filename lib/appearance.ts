export const profileThemes = {
  iris: { label: 'Ирис', colors: ['#c9a9ff', '#9ccaff'], wash: '#a88ad8' },
  aurora: { label: 'Сияние', colors: ['#87e7d6', '#bce8a3'], wash: '#78c9b5' },
  ocean: { label: 'Океан', colors: ['#84ceff', '#bab3ff'], wash: '#80acd9' },
  rose: { label: 'Роза', colors: ['#ffa8cb', '#d7b2ff'], wash: '#da96bc' },
  ember: { label: 'Закат', colors: ['#ffc88c', '#ffa6b3'], wash: '#d4a180' },
  silver: { label: 'Лунный', colors: ['#fafaff', '#a9b4cb'], wash: '#a6afbf' },
} as const;
export type ProfileTheme = keyof typeof profileThemes;
export type Appearance = {
  premium?: number | boolean;
  profileTheme?: string;
  nameGradient?: number | boolean;
  ringText?: string;
  avatarMotion?: string;
  avatarMotionType?: string;
};
export function themeFor(person: Appearance) {
  return (
    profileThemes[person.profileTheme as ProfileTheme] || profileThemes.iris
  );
}
export function ringCharacters(value: string) {
  return Array.from(
    new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(value),
    (part) => part.segment,
  );
}
