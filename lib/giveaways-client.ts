import { readApiJson } from './http-response';
import type { Giveaway } from './giveaways-types';

export async function giveawayRequest<T>(
  query = '',
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api/giveaways' + query, {
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await readApiJson<T>(response, 'Не удалось загрузить розыгрыш');
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || 'Не удалось выполнить действие'),
      { status: response.status, code: data.code },
    );
  return data;
}

export type GiveawayDraft = {
  actor: string;
  key: string;
  targetKind: 'group' | 'channel';
  targetId: string;
  prize: 'stars' | 'premium';
  winnerCount: number;
  starsPerWinner: number;
  endsAt: number;
};
export function createGiveaway(draft: GiveawayDraft) {
  return giveawayRequest<{ giveaway: Giveaway; balance: number }>('', {
    action: 'create',
    ...draft,
  });
}
