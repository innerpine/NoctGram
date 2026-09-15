import { telegramTransport } from './transport.mjs';
import { dropConfig } from './drop-config.mjs';
import {
  deliverDropUpdates,
  DropRetryError,
  dropRetryDelayMs,
} from './drop-service.mjs';
const { token, url } = dropConfig(),
  telegram = telegramTransport(token);
let offset = 0,
  stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
const webhook = await telegram('getWebhookInfo');
if (webhook.url)
  throw Error(
    'This bot has a webhook. Stop the existing deployment before running polling.',
  );
console.log('Noct Gifts bot is listening.');
while (!stopped) {
  try {
    const updates = await telegram('getUpdates', {
      offset,
      timeout: 10,
      allowed_updates: ['message'],
    });
    offset = await deliverDropUpdates({
      updates,
      telegram,
      url,
      offset,
      stopped: () => stopped,
    });
  } catch (error) {
    if (error instanceof DropRetryError) offset = error.offset;
    console.error('Telegram is temporarily unavailable; retrying.');
    const until = Date.now() + dropRetryDelayMs(error);
    while (!stopped && Date.now() < until)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000, until - Date.now())),
      );
  }
}
