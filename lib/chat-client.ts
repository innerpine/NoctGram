import { readApiJson } from './http-response';
export async function chatRequest<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const data = await readApiJson<T>(
    response,
    'Не удалось выполнить запрос',
  ).catch((error: Error) => {
    // A proxy can reject a request with an HTML error page. Preserve its
    // status so a definitive 4xx does not leave the composer in retry mode.
    if (!response.ok) Object.assign(error, { status: response.status });
    throw error;
  });
  if (!response.ok) {
    if (['ACCOUNT_BLOCKED', 'READ_ONLY'].includes(data.code || ''))
      window.dispatchEvent(new Event('noctgram:restriction'));
    throw Object.assign(
      new Error(data.error || 'Не удалось выполнить запрос'),
      { status: response.status },
    );
  }
  return data;
}
export function discardChatFile(id: string) {
  return chatRequest('/api/chat-upload', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    keepalive: true,
  }).catch(() => {});
}
