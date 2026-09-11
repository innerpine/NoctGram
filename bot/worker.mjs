import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { CloudflareBotRuntime } from './cloudflare-runtime.mjs';

function equalSecret(actual, expected) {
  if (!expected || expected.length < 32 || !actual) return false;
  const a = new TextEncoder().encode(actual),
    b = new TextEncoder().encode(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function configured(env) {
  return (
    /^\d+:[a-zA-Z0-9_-]{30,}$/.test(env.TELEGRAM_BOT_TOKEN || '') &&
    env.NOCT_BOT_SECRET?.length >= 32 &&
    env.TELEGRAM_WEBHOOK_SECRET?.length >= 32 &&
    env.NOCT_SITE_URL === 'https://noctgram.com'
  );
}
const reply = (status, body) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export class TelegramBot extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.runtime = new CloudflareBotRuntime(ctx, env);
  }
  async fetch(request) {
    if (new URL(request.url).pathname === '/operator/status') {
      await this.runtime.wake();
      return reply(200, this.runtime.store.diagnostics());
    }
    await this.runtime.accept(await request.json());
    return reply(200, { ok: true });
  }
  async alarm() {
    await this.runtime.alarm();
  }
}

const worker = {
  async fetch(request, env) {
    if (!configured(env)) return reply(503, { ok: false });
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET')
      return reply(200, { ok: true });
    const operator =
      url.pathname === '/operator/status' && request.method === 'GET';
    if (
      !operator &&
      (url.pathname !== '/telegram/webhook' || request.method !== 'POST')
    )
      return reply(404, { ok: false });
    if (
      !equalSecret(
        request.headers.get(
          operator ? 'Authorization' : 'X-Telegram-Bot-Api-Secret-Token',
        ),
        operator
          ? 'Bearer ' + env.NOCT_BOT_SECRET
          : env.TELEGRAM_WEBHOOK_SECRET,
      )
    )
      return reply(401, { ok: false });
    let body;
    if (!operator) {
      if (Number(request.headers.get('Content-Length')) > 65536)
        return reply(413, { ok: false });
      // Bound streamed requests as well as Content-Length; this is a public URL.
      const reader = request.body?.getReader(),
        parts = [];
      if (!reader) return reply(400, { ok: false });
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 65536) {
            await reader.cancel();
            return reply(413, { ok: false });
          }
          parts.push(value);
        }
        body = JSON.parse(await new Blob(parts).text());
      } catch {
        return reply(400, { ok: false });
      }
      if (!body || !Number.isSafeInteger(body.update_id) || body.update_id < 0)
        return reply(400, { ok: false });
    }
    // Namespace each bot by its public ID so rotating a token retains its state.
    const stub = env.BOT.get(
      env.BOT.idFromName(env.TELEGRAM_BOT_TOKEN.split(':')[0]),
    );
    try {
      return await stub.fetch(
        new Request('https://bot.internal' + url.pathname, {
          method: operator ? 'GET' : 'POST',
          ...(operator ? {} : { body: JSON.stringify(body) }),
        }),
      );
    } catch {
      // Telegram retries failed webhooks. No raw exception may expose secrets.
      return reply(503, { ok: false });
    }
  },
  async scheduled(_event, env) {
    if (!configured(env)) throw new Error('Bot configuration is incomplete');
    const stub = env.BOT.get(
      env.BOT.idFromName(env.TELEGRAM_BOT_TOKEN.split(':')[0]),
    );
    await stub.fetch('https://bot.internal/operator/status');
  },
};
export default worker;
