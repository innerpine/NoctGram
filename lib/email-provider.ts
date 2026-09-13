import { ApiError } from './api-error';
import { setting } from './auth-session';

export function emailConfig() {
  const url = setting('SUPABASE_URL'),
    key = setting('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    // Only the isolated test Worker enables a loopback provider. No demo codes in the app.
    const local =
      setting('NOCT_AUTH_ALLOW_LOCAL_PROVIDER') === '1' &&
      parsed.hostname === '127.0.0.1' &&
      parsed.protocol === 'http:';
    if (
      (!local && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      return null;
    return { url: parsed.origin + '/auth/v1', key };
  } catch {
    return null;
  }
}
export function requireEmailConfig() {
  const config = emailConfig();
  if (!config)
    throw new ApiError(
      503,
      'Отправка писем ещё не подключена.',
      'EMAIL_NOT_CONFIGURED',
    );
  return config;
}
async function provider(path: string, body: unknown) {
  const config = requireEmailConfig();
  let response: Response;
  try {
    response = await fetch(config.url + path, {
      method: 'POST',
      headers: { apikey: config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
    });
  } catch {
    throw new ApiError(
      503,
      'Сервис входа временно недоступен. Попробуйте позже.',
    );
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new ApiError(
      429,
      'Слишком много запросов. Подождите перед следующей попыткой.',
      'RATE_LIMIT',
    );
  }
  if (!response.ok) {
    // Only use the provider's machine-readable code; never echo its payload,
    // which can contain account details. Invalid tokens also use otp_expired.
    const error = (await response.json().catch(() => ({}))) as {
      error_code?: string;
    };
    const invalid =
      path === '/verify' &&
      ['otp_expired', 'validation_failed'].includes(error.error_code || '');
    throw new ApiError(
      path === '/verify' && response.status < 500 ? 400 : 503,
      path === '/verify' && response.status < 500
        ? invalid
          ? 'Код не подошёл. Введите шесть цифр из самого нового письма. Если код уже использован или прошло 5 минут, запросите новый.'
          : 'Не удалось проверить код. Попробуйте ещё раз или запросите новое письмо.'
        : path === '/verify'
          ? 'Сервис проверки кода временно недоступен. Попробуйте ещё раз.'
          : 'Не удалось отправить письмо. Попробуйте позже.',
      invalid ? 'CODE_INVALID' : 'EMAIL_PROVIDER_ERROR',
    );
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError(
      503,
      'Сервис входа вернул неполный ответ. Попробуйте ещё раз.',
    );
  }
}
export async function sendEmailCode(email: string) {
  await provider('/otp', { email, create_user: true });
}
export async function verifyEmailCode(email: string, code: string) {
  const response = await provider('/verify', {
    email,
    token: code,
    type: 'email',
  });
  const user = response.user as
    | { id?: string; email?: string; email_confirmed_at?: string }
    | undefined;
  if (
    !response.access_token ||
    !user?.email_confirmed_at ||
    typeof user.id !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(user.id) ||
    user.email?.trim().toLowerCase() !== email
  )
    throw new ApiError(
      400,
      'Не удалось подтвердить почту. Запросите новый код.',
    );
  // The trusted provider verified the OTP. Provider tokens never leave the server.
  return { subject: user.id, email };
}
