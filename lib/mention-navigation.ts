import { chatRequest } from './chat-client';
import { roomRequest } from './rooms-client';
import type { Profile } from './client';
import type { RoomPreview } from './rooms-types';

export type ResolvedMention =
  | { kind: 'profile'; profile: Profile }
  | { kind: 'group'; group: string };

/** Shared profile/group usernames keep existing profiles as the first choice. */
export async function resolveMention(
  handle: string,
  reference = false,
): Promise<ResolvedMention> {
  try {
    const profile = await chatRequest<Profile>(
      '/api/social?' +
        new URLSearchParams({
          action: 'profile',
          ...(reference ? { ref: handle } : { handle }),
        }),
      { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000) },
    );
    return { kind: 'profile', profile };
  } catch (error) {
    // Never turn a denied, expired, or failed profile request into a lookup of
    // another entity. The room resolver already excludes private/banned rooms.
    if (Number((error as { status?: number }).status) !== 404) throw error;
  }
  try {
    const { room } = await roomRequest<{ room: RoomPreview }>({
      action: 'resolveGroup',
      username: handle,
    });
    return { kind: 'group', group: room.username! };
  } catch (error) {
    if (Number((error as { status?: number }).status) === 404)
      throw new Error('Пользователь, канал или публичная группа не найдены');
    throw error;
  }
}
