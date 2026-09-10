'use client';
import type { CSSProperties, ReactNode } from 'react';
import type { Profile } from '@/lib/client';
import { hasProfileDesign, themeFor } from '@/lib/appearance';
import { readProfileBackground } from '@/lib/profile-background';
import { useImagePalette } from '@/lib/use-image-palette';
import { appearanceStyle } from './profile-identity';
export function useProfileBackground(person: Partial<Profile>) {
  const background = readProfileBackground(person.profileBackground);
  const active =
    !!person.premium && person.kind !== 'channel' && background.mode !== 'none';
  const palette = useImagePalette(
    active && background.mode === 'cover'
      ? person.cover || person.avatar || ''
      : '',
  );
  const theme = themeFor(person).colors;
  const colors =
    background.mode === 'custom'
      ? [background.first, background.second]
      : background.mode === 'cover'
        ? palette || theme
        : theme;
  return active
    ? ({
        '--surface-first': colors[0],
        '--surface-second': colors[1],
        '--surface-intensity': `${background.intensity}%`,
      } as CSSProperties)
    : undefined;
}
export function ProfileSurface({
  person,
  children,
}: {
  person: Profile;
  children: ReactNode;
}) {
  const surface = useProfileBackground(person);
  return (
    <section
      className={
        'profile-card ' + (person.kind === 'channel' ? 'channel-profile' : '')
      }
      data-premium={!!person.premium || (person.boostLevel || 0) > 0}
      data-profile-background={!!surface}
      style={
        hasProfileDesign(person)
          ? { ...appearanceStyle(person), ...surface }
          : undefined
      }
    >
      {children}
    </section>
  );
}
