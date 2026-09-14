import { telegramTransport, siteTransport } from './transport.mjs';
import { syncAdminCommands } from './admin.mjs';

// Run only after both Workers and their secrets are deployed. This never calls
// getUpdates, discards pending updates, sends a message or makes a purchase.
try {
  const token = process.env.TELEGRAM_BOT_TOKEN || '',
    secret = process.env.NOCT_BOT_SECRET || '',
    webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '',
    endpoint = new URL(process.env.TELEGRAM_WEBHOOK_URL || '');
  if (
    !/^\d+:[a-zA-Z0-9_-]{30,}$/.test(token) ||
    secret.length < 32 ||
    !/^[a-zA-Z0-9_-]{32,256}$/.test(webhookSecret) ||
    endpoint.protocol !== 'https:' ||
    endpoint.pathname !== '/telegram/webhook' ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error('Bot secrets or webhook URL are missing or invalid');
  const telegram = telegramTransport(token),
    site = siteTransport(process.env.NOCT_SITE_URL, secret);
  const me = await telegram('getMe'),
    previous = await telegram('getWebhookInfo');
  if (previous.url && previous.url !== endpoint.href)
    throw new Error(
      'This bot already has a different webhook; migrate that integration explicitly first',
    );
  const health = await site({ action: 'health' });
  if (
    !health.enabled ||
    health.testMode ||
    health.botUsername.toLowerCase() !== me.username.toLowerCase()
  )
    throw new Error('Website bot settings do not match the live bot');
  const status = await fetch(new URL('/operator/status', endpoint), {
    headers: { Authorization: 'Bearer ' + secret },
  });
  if (!status.ok) throw new Error('Cloudflare bot is not ready');
  await telegram('setMyCommands', {
    commands: [
      { command: 'start', description: 'NoctGram · Stars и Premium' },
      { command: 'topup', description: 'Пополнить Noct Stars' },
      { command: 'premium', description: 'Noct Premium на 30 дней' },
      { command: 'history', description: 'Покупки' },
      { command: 'terms', description: 'Условия покупки' },
      { command: 'paysupport', description: 'Помощь с платежом' },
      { command: 'settings', description: 'Оформление бота' },
    ],
  });
  await syncAdminCommands(telegram, process.env.NOCT_BOT_ADMIN_IDS);
  await telegram('setMyDescription', {
    description:
      'NoctGram · Stars и Premium\n\nПривяжи аккаунт NoctGram, пополняй баланс Noct Stars и подключай Premium на 30 дней. Оплата — Telegram Stars. Помощь с покупками: /paysupport',
  });
  await telegram('setMyShortDescription', {
    short_description:
      'NoctGram · Noct Stars и Premium · оплата Telegram Stars',
  });
  await telegram('setWebhook', {
    url: endpoint.href,
    secret_token: webhookSecret,
    max_connections: 10,
    allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
    drop_pending_updates: false,
  });
  const current = await telegram('getWebhookInfo');
  if (current.url !== endpoint.href)
    throw new Error('Telegram did not retain the webhook');
  console.log(
    JSON.stringify({
      bot: '@' + me.username,
      webhook: current.url,
      pendingUpdates: current.pending_update_count,
    }),
  );
} catch (e) {
  // Fetch exceptions can contain token-bearing Telegram URLs. No raw error output.
  console.error(
    e.service
      ? `Setup failed: ${e.service}, HTTP ${e.status}`
      : 'Cloudflare bot setup failed; check configuration and deployed service health.',
  );
  process.exitCode = 1;
}
