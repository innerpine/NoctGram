import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { telegramTransport, RemoteError, safeBase } from './transport.mjs';

const local = new URL('./.env', import.meta.url),
  website = new URL('../.env', import.meta.url);
function replace(source, key, value) {
  const line = key + '=' + value;
  return new RegExp('^' + key + '=.*$', 'm').test(source)
    ? source.replace(new RegExp('^' + key + '=.*$', 'm'), line)
    : source.trimEnd() + '\n' + line + '\n';
}
try {
  let botEnv = await readFile(local, 'utf8');
  let appEnv = await readFile(website, 'utf8').catch((e) => {
    if (e.code === 'ENOENT') return '';
    throw e;
  });
  const values = parseEnv(botEnv),
    appValues = parseEnv(appEnv);
  const token = values.TELEGRAM_BOT_TOKEN || '';
  if (!/^\d+:[a-zA-Z0-9_-]{30,}$/.test(token))
    throw new Error(
      'Добавь токен BotFather в bot/.env: TELEGRAM_BOT_TOKEN=...',
    );
  const siteUrl = safeBase(values.NOCT_SITE_URL || 'http://localhost:3000');
  const telegram = telegramTransport(token);
  const me = await telegram('getMe');
  const secret =
    values.NOCT_BOT_SECRET ||
    appValues.NOCT_BOT_SECRET ||
    randomBytes(32).toString('hex');
  if (secret.length < 32 || !/^[a-zA-Z0-9_-]+$/.test(secret))
    throw new Error(
      'NOCT_BOT_SECRET должен содержать минимум 32 латинских символа или цифры',
    );
  botEnv = replace(
    replace(
      replace(botEnv, 'NOCT_BOT_SECRET', secret),
      'NOCT_SITE_URL',
      siteUrl,
    ),
    'NOCT_BOT_TEST_MODE',
    values.NOCT_BOT_TEST_MODE === '1' ? '1' : '0',
  );
  appEnv = replace(
    replace(
      replace(appEnv, 'NOCT_BOT_SECRET', secret),
      'NOCT_BOT_USERNAME',
      me.username,
    ),
    'NOCT_BOT_TEST_MODE',
    values.NOCT_BOT_TEST_MODE === '1' ? '1' : '0',
  );
  await writeFile(local, botEnv, { mode: 0o600 });
  await writeFile(website, appEnv, { mode: 0o600 });
  await telegram('setMyCommands', {
    commands: [
      { command: 'start', description: 'открыть noct stars' },
      { command: 'balance', description: 'твой баланс звёзд' },
      { command: 'topup', description: 'купить Noct Stars' },
      { command: 'history', description: 'история пополнений' },
      { command: 'settings', description: 'оформление бота' },
      { command: 'help', description: 'как всё работает' },
    ],
  });
  await telegram('setMyDescription', {
    description:
      'NoctGram · Stars и Premium\n\nПривяжи аккаунт NoctGram, пополняй баланс Stars и подключай Premium на 30 дней. Оплата в боте — Telegram Stars. Помощь с покупками: /paysupport',
  });
  await telegram('setMyShortDescription', {
    short_description:
      'NoctGram · Noct Stars и Premium · оплата Telegram Stars',
  });
  console.log(
    `@${me.username} настроен. Секреты сохранены только в локальных .env. Перезапусти сайт, затем npm run dev:bot`,
  );
} catch (e) {
  console.error(
    e instanceof RemoteError
      ? `Telegram недоступен или отклонил настройки: HTTP ${e.status}`
      : e instanceof Error
        ? e.message
        : 'Не удалось настроить бота',
  );
  process.exitCode = 1;
}
