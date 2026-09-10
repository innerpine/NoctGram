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
export async function readMultipart(
  req: Request,
  maxBytes: number,
  allowedFields: readonly string[] = ['file'],
) {
  if (!req.headers.get('content-type')?.startsWith('multipart/form-data;'))
    throw new ApiError(415, 'Ожидается файл multipart/form-data.');
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, 'Выберите файл.');
  let size = 0;
  // Bound each chunk before the native multipart parser sees it. Avoid retaining
  // both a chunks array and a second full-sized request buffer alongside the File.
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        size += value.byteLength;
        if (size > maxBytes) {
          await finishRejectedBody(reader);
          controller.error(new Error('Multipart limit exceeded'));
        } else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      return reader.cancel().catch(() => {});
    },
  });
  try {
    const form = await new Response(body, {
      headers: { 'Content-Type': req.headers.get('content-type')! },
    }).formData();
    if (
      Array.from(form.keys()).some(
        (key) => !allowedFields.includes(key) || form.getAll(key).length !== 1,
      ) ||
      form.getAll('file').length !== 1
    )
      throw new Error('One file only');
    return form;
  } catch {
    if (size > maxBytes)
      throw new ApiError(
        413,
        'Запрос слишком большой. Максимум 25 МБ на файл.',
      );
    throw new ApiError(400, 'Прикрепите ровно один файл.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
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
