export class RemoteError extends Error {
  constructor(service, status, message, retryAfter = 0) {
    super(message);
    this.service = service;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export function safeBase(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new Error(
      'NOCT_SITE_URL: нужен HTTPS-адрес или локальный http://localhost:3000',
    );
  return url.origin;
}
// Never log fetch errors/URLs: the Telegram token is part of the URL path.
async function jsonPost(url, body, service, headers, signal, timeout = 15000) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    });
  } catch {
    throw new RemoteError(
      service,
      503,
      service === 'site' ? 'сайт пока недоступен' : 'telegram пока недоступен',
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new RemoteError(
      service,
      response.status >= 400 ? response.status : 502,
      'сервис вернул некорректный ответ',
    );
  }
  if (!response.ok || data.ok === false)
    throw new RemoteError(
      service,
      data.error_code || response.status,
      service === 'telegram'
        ? String(data.description || 'telegram error')
        : String(data.error || 'не удалось выполнить запрос'),
      Number(data.parameters?.retry_after) || 0,
    );
  return service === 'telegram' ? data.result : data;
}
export function telegramTransport(token, signal) {
  // Explicit allowlist: paid digital goods use Telegram Stars only.
  const allowed = new Set([
    'getMe',
    'sendInvoice',
    'answerPreCheckoutQuery',
    'getStarTransactions',
    'refundStarPayment',
    'getWebhookInfo',
    'setWebhook',
    'getUpdates',
    'sendMessage',
    'editMessageText',
    'answerCallbackQuery',
    'pinChatMessage',
    'unpinChatMessage',
    'setMyCommands',
    'setMyDescription',
    'setMyShortDescription',
  ]);
  return (method, body = {}) => {
    if (!allowed.has(method)) throw new Error('Telegram method is not enabled');
    return jsonPost(
      `https://api.telegram.org/bot${token}/${method}`,
      body,
      'telegram',
      {},
      signal,
      method === 'getUpdates' ? 45000 : 15000,
    );
  };
}
export function siteTransport(base, secret, signal) {
  const origin = safeBase(base);
  return (body) =>
    jsonPost(
      origin + '/api/bot',
      body,
      'site',
      { Authorization: 'Bearer ' + secret },
      signal,
    );
}
