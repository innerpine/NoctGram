import { readUpstreamJson } from './upstream-json';
import { ApiError } from './api-error';

function networkFailure(error: unknown): ApiError {
  const value = error as {
    name?: string;
    message?: string;
    code?: string;
    cause?: { code?: string; message?: string };
  } | null;
  // Inspect error categories only. Never return or log a raw request/error: it may
  // contain the Authorization header or a user's account information.
  const code = value?.cause?.code || value?.code || '';
  const message = value?.message || '';
  if (
    ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(code) ||
    /\bDNS\b|name resolution|resolve host|getaddrinfo/i.test(message)
  )
    return new ApiError(
      502,
      'Сервер Noctgram не может определить адрес Яндекс Музыки. Проверьте DNS и VPN на компьютере, где запущен Noctgram.',
      'YANDEX_DNS_ERROR',
    );
  if (
    value?.name === 'TimeoutError' ||
    [
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
    ].includes(code)
  )
    return new ApiError(
      504,
      'Сервер Noctgram не дождался соединения с Яндекс Музыкой. Проверьте доступ к Яндексу и VPN на компьютере с сервером.',
      'YANDEX_TIMEOUT',
    );
  if (/CERT|TLS|SSL|SELF_SIGNED/i.test(code))
    return new ApiError(
      502,
      'Не удалось проверить защищённое соединение с Яндекс Музыкой. Проверьте сертификаты и настройки сети на сервере Noctgram.',
      'YANDEX_TLS_ERROR',
    );
  return new ApiError(
    502,
    'Сервер Noctgram не смог соединиться с Яндекс Музыкой. VPN только в браузере на этот запрос не влияет.',
    'YANDEX_NETWORK_ERROR',
  );
}

export async function fetchYandex(
  path: string,
  token?: string,
  request = fetch,
) {
  try {
    return await request('https://api.music.yandex.net' + path, {
      headers: {
        ...(token ? { Authorization: 'OAuth ' + token } : {}),
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw networkFailure(error);
  }
}

/** Check the actual server's route to Yandex, without sending any user token. */
export async function checkYandexConnection(request = fetch) {
  const response = await fetchYandex('/account/status', undefined, request);
  if (![200, 400, 401, 403].includes(response.status))
    throw new ApiError(
      502,
      'Соединение установлено, но Яндекс Музыка вернула ошибку. Попробуйте позже.',
      'YANDEX_UPSTREAM_ERROR',
    );
  let value: unknown;
  try {
    value = await readUpstreamJson(response, 65536);
  } catch {
    /* A proxy/captive portal is not the API. */
  }
  if (
    !value ||
    typeof value !== 'object' ||
    (!('result' in value) && !('error' in value))
  )
    throw new ApiError(
      502,
      'Сервер получил неожиданный ответ вместо данных Яндекс Музыки. Проверьте сетевое подключение.',
      'YANDEX_UPSTREAM_ERROR',
    );
  return { ok: true };
}
