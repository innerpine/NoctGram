type ApiErrorBody = { error?: string; code?: string };

// Framework/proxy failures may be plain text or HTML instead of our JSON API.
// Never show their raw body or the JSON parser's exception to the user.
export async function readApiJson<T>(
  response: Response,
  fallback: string,
): Promise<T & ApiErrorBody> {
  try {
    const data: unknown = await response.json();
    if (data !== null && typeof data === 'object')
      return data as T & ApiErrorBody;
  } catch {
    /* Translate malformed or non-JSON responses below. */
  }
  if (response.status === 413)
    throw new Error(
      'Сервер отклонил загрузку: превышен допустимый размер запроса. Попробуйте файл поменьше.',
    );
  if (response.status === 401)
    throw new Error('Войдите в Noctgram, чтобы продолжить.');
  if (response.status >= 500)
    throw new Error('Сервер временно недоступен. Попробуйте позже.');
  throw new Error(
    response.ok
      ? 'Сервер вернул некорректный ответ. Попробуйте ещё раз.'
      : fallback,
  );
}
