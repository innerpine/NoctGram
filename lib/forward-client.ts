import { chatRequest } from './chat-client';
import type { Person } from './client';
import type { RoomSummary } from './rooms-types';
import type {
  ForwardResult,
  ForwardSource,
  ForwardTarget,
} from './chat-forward';

export type { ForwardResult, ForwardSource, ForwardTarget };
export type ForwardResponse = { results: ForwardResult[] };
export type ForwardChoice = {
  key: string;
  target: ForwardTarget;
  name: string;
  saved?: boolean;
};
export const FORWARD_TARGET_LIMIT = 10;

export function forwardTargetKey(target: ForwardTarget) {
  return 'dm' in target ? 'dm:' + target.dm.peer : 'room:' + target.room.roomId;
}
function chats(count: number) {
  const form = new Intl.PluralRules('ru').select(count);
  return (
    count + ' ' + (form === 'one' ? 'чат' : form === 'few' ? 'чата' : 'чатов')
  );
}
// A short summary for the toast after forwarding to one or several chats.
export function forwardNotice(
  response: ForwardResponse,
  chosen: ForwardChoice[],
) {
  const choice = (target: ForwardTarget) =>
    chosen.find((item) => item.key === forwardTargetKey(target));
  const done = response.results.filter((result) => result.ok);
  const failed = response.results.filter((result) => !result.ok);
  if (!failed.length) {
    if (done.length !== 1) return 'Переслано в ' + chats(done.length);
    const only = choice(done[0].target);
    return only?.saved
      ? 'Сохранено в Избранное'
      : 'Переслано: ' + (only?.name || 'чат');
  }
  return (
    `Переслано в ${done.length} из ${response.results.length}. Не удалось: ` +
    failed.map((result) => choice(result.target)?.name || 'чат').join(', ')
  );
}
// Recent direct chats and groups for the forward dialog, loaded when it opens.
export async function loadForwardTargets(owner: string, signal?: AbortSignal) {
  const [threads, rooms] = await Promise.all([
    chatRequest<Person[]>(
      '/api/social?action=threads&archived=0&actor=' +
        encodeURIComponent(owner),
      { signal },
    ),
    chatRequest<{ rooms: RoomSummary[] }>(
      '/api/rooms?action=list&actor=' + encodeURIComponent(owner),
      { signal },
    ),
  ]);
  return { threads, rooms: rooms.rooms };
}
