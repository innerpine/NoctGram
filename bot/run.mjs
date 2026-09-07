import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { BotStore } from './store.mjs';
import { NoctBot } from './handler.mjs';
import {
  telegramTransport,
  siteTransport,
  RemoteError,
  safeBase,
} from './transport.mjs';

const token = process.env.TELEGRAM_BOT_TOKEN || '',
  secret = process.env.NOCT_BOT_SECRET || '';
const siteUrl = safeBase(process.env.NOCT_SITE_URL || 'http://localhost:3000');
if (!/^\d+:[a-zA-Z0-9_-]{30,}$/.test(token) || secret.length < 32) {
  console.error(
    'Заполни bot/.env по bot/.env.example и выполни npm run setup:bot',
  );
  process.exit(1);
}
if (process.env.NOCT_BOT_TEST_MODE !== '1') {
  console.error(
    'Этот бот поддерживает только тестовые пополнения. Установи NOCT_BOT_TEST_MODE=1 в bot/.env',
  );
  process.exit(1);
}
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => controller.abort());
const telegram = telegramTransport(token, controller.signal),
  site = siteTransport(siteUrl, secret, controller.signal);
let store;
try {
  const me = await telegram('getMe'),
    webhook = await telegram('getWebhookInfo');
  if (webhook.url)
    throw new Error(
      'У бота уже есть webhook. Отключи его перед запуском polling; существующие обновления не удалялись',
    );
  const health = await site({ action: 'health' });
  if (
    !health.enabled ||
    !health.testMode ||
    health.botUsername.toLowerCase() !== me.username.toLowerCase()
  )
    throw new Error(
      'Настройки бота и сайта не совпадают — выполни npm run setup:bot и перезапусти сайт',
    );
  await mkdir(new URL('./data/', import.meta.url), { recursive: true });
  store = new BotStore(
    fileURLToPath(new URL('./data/state.sqlite', import.meta.url)),
    me.id,
  );
  const bot = new NoctBot({
    telegram,
    site,
    store,
    secret,
    siteUrl,
    emojiAvailable: process.env.NOCT_BOT_CUSTOM_EMOJI === '1',
  });
  console.log(`@${me.username} запущен · тестовые звёзды · ${siteUrl}`);
  let failures = 0;
  while (!controller.signal.aborted) {
    try {
      const updates = await telegram('getUpdates', {
        offset: store.get('offset') || 0,
        timeout: 30,
        limit: 20,
        allowed_updates: ['message', 'callback_query'],
      });
      for (const update of updates) {
        if (controller.signal.aborted) break;
        try {
          await bot.handle(update);
        } catch (e) {
          // A chat that blocked/deleted the bot must not stall all other users.
          if (
            !(
              e instanceof RemoteError &&
              e.service === 'telegram' &&
              [400, 403].includes(e.status)
            )
          )
            throw e;
          console.warn(
            'Telegram отклонил ответ в чат; операция сохранена, можно открыть /start заново',
          );
        }
        // Durable receipt commits before this cursor, so crashes cannot double-credit.
        store.set('offset', update.update_id + 1);
      }
      failures = 0;
    } catch (e) {
      if (controller.signal.aborted) break;
      if (
        e instanceof RemoteError &&
        [401, 409].includes(e.status) &&
        e.service === 'telegram'
      )
        throw new Error('Токен недействителен или запущен второй процесс бота');
      failures++;
      console.warn(
        `Связь с ${e instanceof RemoteError ? e.service : 'сервисом'} прервана; повтор ${failures}. Обновление сохранено для повторной обработки`,
      );
      await delay(
        Math.max(
          e instanceof RemoteError ? e.retryAfter * 1000 : 0,
          Math.min(30000, 1000 * 2 ** Math.min(failures, 5)),
        ),
        undefined,
        { signal: controller.signal },
      ).catch(() => {});
    }
  }
} catch (e) {
  if (!controller.signal.aborted) {
    console.error(
      e instanceof RemoteError
        ? `Не удалось запустить бота: ${e.service}, HTTP ${e.status}`
        : e instanceof Error && !(e instanceof TypeError)
          ? e.message
          : 'Не удалось запустить бота',
    );
    process.exitCode = 1;
  }
} finally {
  store?.close();
}
