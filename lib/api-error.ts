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
  if (e instanceof ApiError)
    return Response.json(
      { error: e.message, code: e.code },
      { status: e.status },
    );
  console.error(e instanceof Error ? e.message : 'API failure');
  return Response.json(
    { error: 'Не удалось сохранить изменения. Попробуйте ещё раз.' },
    { status: 500 },
  );
}
