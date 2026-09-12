/* The badge is a small, fixed-size SVG; raster image optimization is unnecessary. */
/* eslint-disable next/no-img-element */
import type { Appearance } from '@/lib/appearance';

export const gratitudeLabel = 'С благодарностью';
export const gratitudeDescription =
  'Особый знак благодарности от команды Noctgram.';

export function GratitudeBadge() {
  return (
    <img
      className="noct-gratitude-badge"
      src="/assets/noct-gratitude.svg"
      width={24}
      height={24}
      alt={gratitudeLabel}
      title={gratitudeDescription}
    />
  );
}

export function GratitudeProfile({ person }: { person: Appearance }) {
  return person.gratitude ? (
    <div className="profile-gratitude">
      <GratitudeBadge />
      <div>
        <strong>{gratitudeLabel}</strong>
        <p>{gratitudeDescription}</p>
      </div>
    </div>
  ) : null;
}
