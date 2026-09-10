import { chatRequest } from './chat-client';
export type RoomTarget = { roomId?: string; group?: string; invite?: string };
export async function roomRequest<T>(
  query: Record<string, string>,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 15000);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    return await chatRequest<T>('/api/rooms?' + new URLSearchParams(query), {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export function roomAction<T>(body: Record<string, unknown>) {
  return chatRequest<T>('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
}
