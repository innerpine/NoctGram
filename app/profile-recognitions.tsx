import type { Appearance } from '@/lib/appearance';
import { VerifiedProfile } from './profile-identity';
import { GratitudeProfile } from './gratitude-badge';

export function ProfileRecognitions({
  person,
  compact = false,
}: {
  person: Appearance;
  compact?: boolean;
}) {
  if (!person.verified && !person.gratitude) return null;
  return (
    <div
      className={
        'profile-recognitions' +
        (compact ? ' profile-recognitions-compact' : '')
      }
    >
      <VerifiedProfile person={person} />
      <GratitudeProfile person={person} />
    </div>
  );
}
