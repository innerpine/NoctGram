import { ApiError } from './api-error';
// Finish a small tail without retaining it. This keeps local Worker keep-alive
// healthy after a rejected body. Never drain an unbounded/slow attacker stream.
async function finishRejectedBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), 250);
  });
  let remaining = 1048576;
  const deadline = Date.now() + 250;
  try {
    while (remaining >= 0 && Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (!chunk) break;
      if (chunk.done) return;
      remaining -= chunk.value.byteLength;
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
}
export async function readMultipart(req: Request, maxBytes: number) {
  if (!req.headers.get('content-type')?.startsWith('multipart/form-data;'))
    throw new ApiError(415, 'Ожидается файл multipart/form-data.');
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, 'Выберите файл.');
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await finishRejectedBody(reader);
      throw new ApiError(
        413,
        'Запрос слишком большой. Максимум 25 МБ на файл.',
      );
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    const form = await new Response(bytes, {
      headers: { 'Content-Type': req.headers.get('content-type')! },
    }).formData();
    if (
      Array.from(form.keys()).some((key) => key !== 'file') ||
      form.getAll('file').length !== 1
    )
      throw new Error('One file only');
    return form;
  } catch {
    throw new ApiError(400, 'Прикрепите ровно один файл.');
  }
}
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
      await finishRejectedBody(reader);
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
