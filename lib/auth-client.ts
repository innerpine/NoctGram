export type AuthStatus = {
  emailEnabled: boolean;
  sitesEnabled: boolean;
  signupPremiumDays?: number;
  user: {
    id: string;
    name: string;
    handle: string;
    avatar: string;
    onboardingComplete: boolean;
    email: string | null;
    welcomePremiumExpiresAt?: number | null;
  } | null;
  challenge: {
    email: string;
    expiresAt: number;
    resendAt: number;
    link: boolean;
  } | null;
};
export class AuthRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
export async function authRequest<T>(
  action: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    '/api/auth/' + action,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  let data: T & { error?: string; retryAfter?: number };
  try {
    data = await response.json();
  } catch {
    throw new AuthRequestError(
      'Не удалось связаться с Noctgram. Попробуйте ещё раз.',
      response.status,
    );
  }
  if (!response.ok)
    throw new AuthRequestError(
      data.error || 'Не удалось выполнить запрос.',
      response.status,
      data.retryAfter || 0,
    );
  return data;
}
