import { readApiJson } from './http-response';

export class CallHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function callRequest<T>(
  query: string,
  body?: unknown,
  options: { signal?: AbortSignal; attempts?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), 8500);
    try {
      const response = await fetch('/api/social' + query, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        ...(body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });
      let data: T & { error?: string };
      try {
        data = await readApiJson<T>(
          response,
          'Не удалось связаться с сервером звонков.',
        );
      } catch (error) {
        if (controller.signal.aborted)
          throw new CallHttpError(0, 'Связь с сервером временно недоступна.');
        throw new CallHttpError(response.status, (error as Error).message);
      }
      if (!response.ok)
        throw new CallHttpError(
          response.status,
          data.error || 'Не удалось связаться с сервером звонков.',
        );
      return data;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const status = error instanceof CallHttpError ? error.status : 0;
      if (
        attempt + 1 >= attempts ||
        (status !== 0 && status !== 408 && status < 500)
      )
        throw error instanceof CallHttpError
          ? error
          : new CallHttpError(0, 'Связь с сервером временно недоступна.');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  }
  throw new CallHttpError(0, 'Не удалось связаться с сервером звонков.');
}
