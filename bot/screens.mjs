import { icons } from './emoji.mjs';
export const num = (value) => Number(value).toLocaleString('ru-RU');
export const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function ui(preferences = {}, emojiAvailable = false) {
  const custom = emojiAvailable && preferences.customEmoji !== false;
  const emoji = (name) =>
    custom
      ? `<tg-emoji emoji-id="${icons[name].id}">${icons[name].fallback}</tg-emoji>`
      : icons[name].fallback;
  const button = (text, data, icon, style) => ({
    text: `${icon && !custom ? icons[icon].fallback + ' ' : ''}${text}`,
    callback_data: data,
    ...(icon && custom ? { icon_custom_emoji_id: icons[icon].id } : {}),
    ...(style ? { style } : {}),
  });
  const back = (data = 'home') => [button('назад', data, 'back')];
  const block = (text) =>
    preferences.rich === false
      ? text
      : `<blockquote expandable>${text}</blockquote>`;
  const head = (name, title) => `${emoji(name)} <b>${title}</b>\n\n`;
  return { emoji, button, back, block, head };
}
export function screen(name, state, options = {}) {
  const {
    preferences = {},
    emojiAvailable = false,
    siteUrl,
    order,
    code,
    message,
  } = options;
  const {
    emoji,
    button: b,
    back,
    block,
    head,
  } = ui(preferences, emojiAvailable);
  if (name === 'shop' || name === 'admin')
    return options.view(ui(preferences, emojiAvailable));
  const site = new URL(siteUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname);
  const siteRow = local ? [] : [[{ text: '☾ открыть noctgram', url: siteUrl }]];
  const webHint = local
    ? 'открой noctgram в браузере на компьютере → noct stars'
    : `<a href="${escape(siteUrl)}">открыть noctgram</a> → noct stars`;
  const footer = [back()];
  if (name === 'proof')
    return {
      text:
        head('link', 'привязка аккаунта') +
        `введи этот код на сайте noctgram\n\n<b>${escape(code)}</b>\n\nкод действует 10 минут\nне пересылай его и не вводи на чужом устройстве`,
      rows: [[b('проверить привязку ›', 'home', 'link')], ...siteRow, back()],
    };
  if (name === 'error')
    return {
      text: head('error', 'не получилось') + escape(message),
      rows: footer,
    };
  if (name === 'settings')
    return {
      text:
        head('settings', 'оформление') +
        block(
          '• премиум-эмодзи — анимированные иконки\n• подробности — сворачиваемые блоки\n• статус — закреплённая строка с балансом',
        ) +
        (!emojiAvailable
          ? '\n\nпремиум-эмодзи пока недоступны этому боту'
          : ''),
      rows: [
        ...(emojiAvailable
          ? [
              [
                b(
                  `премиум-эмодзи ${preferences.customEmoji !== false ? '✓' : '✕'}`,
                  'toggle:customEmoji',
                  'stars',
                  preferences.customEmoji !== false ? 'success' : 'danger',
                ),
              ],
            ]
          : []),
        [
          b(
            `подробности ${preferences.rich !== false ? '✓' : '✕'}`,
            'toggle:rich',
            'history',
            preferences.rich !== false ? 'success' : 'danger',
          ),
        ],
        [
          b(
            `закреплённый статус ${preferences.pinned ? '✓' : '✕'}`,
            'toggle:pinned',
            'balance',
            preferences.pinned ? 'success' : 'danger',
          ),
        ],
        ...footer,
      ],
    };
  if (name === 'help')
    return {
      text:
        head('help', 'о noct stars') +
        'звёзды для поддержки авторов в noctgram\n\n' +
        block(
          '• все пополнения сейчас тестовые\n• telegram stars и деньги не списываются\n• звёзды появляются в балансе на сайте\n• лимит — 50 000 звёзд за 24 часа\n• отвязать telegram можно на сайте',
        ) +
        `\n\n${webHint}`,
      rows: [...siteRow, ...footer],
    };
  if (!state?.linked)
    return {
      text:
        head('moon', 'noct stars') +
        'маленькие звёзды — большая поддержка\n\n' +
        block(
          'привяжи свой аккаунт noctgram, чтобы пополнять баланс и поддерживать авторов',
        ) +
        `\n\n${webHint} → привязать telegram`,
      rows: [
        [b('проверить привязку ›', 'home', 'link')],
        ...siteRow,
        [
          b('как это работает ›', 'help', 'stars'),
          b('оформление ›', 'settings', 'settings'),
        ],
      ],
    };
  const who = '@' + escape(state.profile.handle);
  if (name === 'packages')
    return {
      text:
        head('stars', 'пополнить звёзды') +
        `выбери пакет для ${who}\n\n` +
        block(
          `${emoji('stars')} тестовые звёзды — без оплаты\nдоступно ещё ${num(Math.max(0, state.dailyLimit - state.usedToday))} за 24 часа`,
        ) +
        '\n\ntelegram stars не списываются',
      rows: [
        ...state.packages.map((n) => [
          b(`${num(n)} звёзд · бесплатно`, `pack:${n}`, 'stars'),
        ]),
        ...footer,
      ],
    };
  if (name === 'confirm')
    return {
      text:
        head('stars', 'твоё пополнение') +
        block(
          `${emoji('stars')} <b>${num(order.amount)} noct stars</b>\nаккаунт · ${who}\nстоимость · бесплатно`,
        ) +
        '\n\nнажми подтвердить — начислю тестовые звёзды\nпакет действует 10 минут',
      rows: [
        [
          b(
            `подтвердить · +${num(order.amount)} ✓`,
            `credit:${order.id}`,
            'stars',
            'success',
          ),
        ],
        back('packages'),
      ],
    };
  if (name === 'success')
    return {
      text:
        head('success', 'звёзды уже у тебя') +
        `<b>+${num(order.amount)} noct stars</b> → ${who}\n\n` +
        block(
          `баланс · ${num(state.balance)} звёзд\nоперация · ${escape(order.id.slice(0, 8))}\nтестовое пополнение · без оплаты`,
        ),
      rows: [
        [b('пополнить ещё ›', 'packages', 'stars')],
        ...siteRow,
        ...footer,
      ],
    };
  if (name === 'history')
    return {
      text:
        head('history', 'история пополнений') +
        (state.history.length
          ? block(
              state.history
                .map(
                  (t) =>
                    `<b>+${num(t.amount)} звёзд</b> · без оплаты\n${new Date(t.creditedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} мск · ${escape(t.id.slice(0, 8))}`,
                )
                .join('\n\n'),
            )
          : 'пока нет пополнений') +
        '\n\nпоследние 10 операций · вся история на сайте',
      rows: footer,
    };
  return {
    text:
      head('moon', 'noct stars') +
      `твоё пространство поддержки\n\n` +
      block(
        `${emoji('balance')} <b>${num(state.balance)} звёзд</b>\nаккаунт · ${who}\nтестовый режим · без оплаты`,
      ) +
      '\n\nвыбери, что хочешь сделать',
    rows: [
      [b('пополнить звёзды ›', 'packages', 'stars')],
      [
        b('история ›', 'history', 'history'),
        b('оформление ›', 'settings', 'settings'),
      ],
      ...siteRow,
      [
        b('обновить баланс ›', 'home', 'balance'),
        b('помощь ›', 'help', 'help'),
      ],
    ],
  };
}
