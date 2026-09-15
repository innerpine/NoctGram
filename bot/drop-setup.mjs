import { telegramTransport } from './transport.mjs';
import { dropConfig } from './drop-config.mjs';
try {
  const { token, url } = dropConfig(),
    telegram = telegramTransport(token);
  const me = await telegram('getMe');
  await telegram('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Открыть Noct Gifts',
      web_app: { url },
    },
  });
  await telegram('setMyCommands', {
    commands: [
      { command: 'start', description: 'Открыть Noct Gifts' },
      { command: 'help', description: 'Аккаунт, подарки и Stars' },
    ],
  });
  await telegram('setMyDescription', {
    description:
      'Noct Gifts — кейсы и апгрейды подарков. Общий баланс Noct Stars и подарки в вашем профиле NoctGram. Привяжите Telegram в NoctGram, чтобы начать.',
  });
  await telegram('setMyShortDescription', {
    short_description: 'Ваши подарки и Noct Stars — вместе с NoctGram.',
  });
  console.log(`Noct Gifts menu configured for @${me.username}.`);
} catch {
  console.error(
    'Could not configure Noct Gifts. Check the server variables and Telegram availability.',
  );
  process.exitCode = 1;
}
