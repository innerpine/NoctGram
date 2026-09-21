export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export function failure(e: unknown) {
  if (!(e instanceof ApiError)) {
    const text = String(e);
    if (/D1_ERROR:.*free tier daily row (?:read|write) limit/i.test(text)) {
      const now = Date.now();
      const reset = (Math.floor(now / 86400000) + 1) * 86400000;
      return Response.json(
        {
          error:
            'База временно недоступна: исчерпан суточный лимит хостинга. Он обновится в 00:00 UTC. Данные аккаунта не удалены.',
          code: 'DATABASE_DAILY_LIMIT',
        },
        {
          status: 503,
          headers: {
            'Retry-After': String(Math.max(1, Math.ceil((reset - now) / 1000))),
          },
        },
      );
    }
    if (text.includes('MEDIA_NOT_READY'))
      e = new ApiError(
        409,
        'Вложение больше недоступно. Загрузите его заново.',
      );
    else if (text.includes('STORAGE_QUOTA'))
      e = new ApiError(
        413,
        'Хранилище аудио заполнено: максимум 512 МБ и 500 файлов.',
        'STORAGE_QUOTA',
      );
    else if (text.includes('ACCOUNT_DELETED'))
      e = new ApiError(401, 'Аккаунт удалён.');
    else if (text.includes('HANDLE_RESERVED'))
      e = new ApiError(409, 'Этот юзернейм продаётся в Маркете.');
  }
  if (e instanceof ApiError)
    return Response.json(
      { error: e.message, code: e.code },
      {
        status: e.status,
        headers:
          e.status === 429
            ? { 'Retry-After': String('retryAfter' in e ? e.retryAfter : 60) }
            : undefined,
      },
    );
  console.error(e instanceof Error ? e.message : 'API failure');
  return Response.json(
    { error: 'Не удалось сохранить изменения. Попробуйте ещё раз.' },
    { status: 500 },
  );
}
