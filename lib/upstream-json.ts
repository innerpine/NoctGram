import { ApiError } from './api-error';

export const MAX_UPSTREAM_JSON_BYTES = 4 * 1024 * 1024;
// Count decoded response bytes, including chunked bodies and misleading headers.
// Do not include provider content or parser diagnostics in client-facing errors.
export async function readUpstreamJson<T = unknown>(
  response: Response,
  maxBytes = MAX_UPSTREAM_JSON_BYTES,
): Promise<T> {
  const invalid = () =>
    new ApiError(
      502,
      'Музыкальный сервис вернул слишком большой или некорректный ответ.',
      'MUSIC_UPSTREAM_RESPONSE',
    );
  if (!response.body) throw invalid();
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel().catch(() => {});
    throw invalid();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw invalid();
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw invalid();
  }
}
