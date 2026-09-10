import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { siteTransport } from './transport.mjs';
const file = new URL('./data/state.sqlite', import.meta.url),
  botId = (process.env.TELEGRAM_BOT_TOKEN || '').split(':')[0];
const details = process.argv.includes('--support');
try {
  const site = siteTransport(
    process.env.NOCT_SITE_URL || 'http://localhost:3000',
    process.env.NOCT_BOT_SECRET || '',
  );
  const health = await site({ action: 'health' }),
    payments = await site({ action: 'paymentDiagnostics', details });
  let local = {};
  if (existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: true });
    const read = (key) => {
      const r = db
        .prepare('SELECT value FROM state WHERE bot=? AND key=?')
        .get(botId, key);
      return r ? JSON.parse(r.value) : null;
    };
    local = {
      lastHandledAt: read('lastHandledAt'),
      lastPaymentReconcileAt: read('lastPaymentReconcileAt'),
      queuedUpdates: db
        .prepare('SELECT COUNT(*) n FROM updates WHERE bot=?')
        .get(botId).n,
      unrecognizedReceipts: db
        .prepare(
          "SELECT COUNT(*) n FROM state WHERE bot=? AND key LIKE 'payment-review:%' AND value<>'null'",
        )
        .get(botId).n,
    };
    db.close();
  }
  console.log(
    JSON.stringify(
      {
        bot: health.botUsername,
        testMode: health.testMode,
        ...local,
        ...payments,
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    'Не удалось прочитать состояние. Проверь запущенный сайт и локальный bot/.env.',
  );
  process.exitCode = 1;
}
