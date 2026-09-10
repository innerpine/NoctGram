import { setting } from './auth-session';
import { ApiError } from './api-error';

export async function cryptoPay<T>(
  method: 'createInvoice' | 'getInvoices',
  body: Record<string, unknown>,
): Promise<T> {
  const token = setting('CRYPTO_PAY_API_TOKEN');
  if (!token)
    throw new ApiError(503, 'Оплата через Crypto Pay пока недоступна');
  let response: Response;
  try {
    response = await fetch('https://pay.crypt.bot/api/' + method, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Crypto-Pay-API-Token': token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new ApiError(
      503,
      'Crypto Pay не отвечает. Попробуйте проверить оплату позже.',
    );
  }
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result?: T;
  } | null;
  if (!response.ok || !data?.ok || !data.result)
    throw new ApiError(502, 'Не удалось выполнить запрос к Crypto Pay');
  return data.result;
}
export function rubMinor(value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value))
    return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function cryptoInvoiceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !['pay.crypt.bot', 'app.send.tg', 'app.cr.bot'].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
