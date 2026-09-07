import { ApiError } from './api-error';
export async function readJsonBody(req: Request, maxBytes: number) {
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, 'Пустой запрос.');
  const parts: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, 'Запрос слишком большой.');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || Array.isArray(data) || typeof data !== 'object')
      throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'Некорректный запрос.');
  }
}
