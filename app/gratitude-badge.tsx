'use client';
/* Inline SVG exposes one accessible image while its gradient follows the profile. */
/* eslint-disable jsx-a11y/prefer-tag-over-role */
import { useId } from 'react';
import { themeFor, type Appearance } from '@/lib/appearance';

export const gratitudeLabel = 'С благодарностью';
export const gratitudeDescription =
  'Особый знак благодарности от команды Noctgram.';

export function GratitudeBadge({ person }: { person: Appearance }) {
  const gradientId = 'gratitude-' + useId().replace(/:/g, '');
  const theme = themeFor(person);
  return (
    <svg
      className="noct-gratitude-badge"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      role="img"
      aria-label={gratitudeLabel}
    >
      <title>{gratitudeDescription}</title>
      <defs>
        <linearGradient
          id={gradientId}
          x1="5"
          y1="2"
          x2="19"
          y2="23"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={theme.colors[0]} />
          <stop offset="1" stopColor={theme.colors[1]} />
        </linearGradient>
      </defs>
      <path
        d="M9.8 2.1a3.1 3.1 0 0 1 4.4 0l7.7 7.7a3.1 3.1 0 0 1 0 4.4l-7.7 7.7a3.1 3.1 0 0 1-4.4 0l-7.7-7.7a3.1 3.1 0 0 1 0-4.4z"
        fill={'url(#' + gradientId + ')'}
      />
      <path
        d="m5.5 10 5-5a2.1 2.1 0 0 1 3 0L17 8.5"
        stroke="#fff"
        strokeOpacity=".6"
        strokeLinecap="round"
      />
      <path
        d="m7.7 12 2.8 2.9 5.8-6"
        stroke="#17202a"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GratitudeProfile({ person }: { person: Appearance }) {
  return person.gratitude ? (
    <div className="profile-verification profile-gratitude">
      <GratitudeBadge person={person} />
      <span>{gratitudeDescription}</span>
    </div>
  ) : null;
}
