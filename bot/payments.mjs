import catalog from '../lib/commerce-catalog.json' with { type: 'json' };
import { escape, num } from './screens.mjs';
import { paymentKey, deliverReceipt } from './payment-worker.mjs';

const terms =
  'noct stars — внутренняя валюта для подарков и поддержки авторов\nnoct premium — 30 дней, без автопродления\nначисление — после подтверждения telegram\nпомощь и возврат — /paysupport с номером заказа\nне отправляй пароли и коды входа';
function unpack(value) {
  return /^[a-f0-9]{32}$/.test(value)
    ? value.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
    : value;
}
const notice = (bot, chat, key, view) =>
  bot.render(chat, 'shop', null, {
    view,
    delivery: { commandUpdateId: key },
  });
export async function handlePaymentUpdate(bot, update) {
  const pre = update.pre_checkout_query;
  if (pre) {
    let ok = false,
      error = 'Не удалось проверить счёт. Попробуй снова.';
    try {
      await Promise.race([
        bot.site({
          action: 'paymentPrecheck',
          id: pre.invoice_payload,
          telegramId: String(pre.from.id),
          currency: pre.currency,
          amount: pre.total_amount,
          precheckoutId: pre.id,
        }),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 7500);
          timer.unref?.();
        }),
      ]);
      ok = true;
    } catch (e) {
      if (e.service === 'site' && e.status < 500) error = e.message;
    }
    await bot.telegram('answerPreCheckoutQuery', {
      pre_checkout_query_id: pre.id,
      ok,
      ...(ok ? {} : { error_message: error.slice(0, 200) }),
    });
    return true;
  }
  const m = update.message,
    p = m?.successful_payment || m?.refunded_payment;
  if (p) {
    if (
      m.chat?.type !== 'private' ||
      m.from?.id !== m.chat.id ||
      m.from?.is_bot
    )
      return true;
    const receipt = {
      action: 'paymentReceipt',
      id: p.invoice_payload,
      telegramId: String(m.from.id),
      currency: p.currency,
      amount: p.total_amount,
      chargeId: p.telegram_payment_charge_id,
      refund: !!m.refunded_payment,
    };
    // Persist before contacting the site. Never acknowledge the update before
    // its receipt is delivered; replaying it is safe after a crash.
    bot.store.set(paymentKey(receipt), receipt);
    const result = await deliverReceipt(bot, receipt);
    bot.store.set(paymentKey(receipt), null);
    if (!result) {
      await notice(
        bot,
        m.chat.id,
        'payment-review:' + update.update_id,
        ({ head, block, back }) => ({
          text:
            head('history', 'проверяем платёж') +
            block(
              'платёж сохранён для проверки\nпомощь — /paysupport с номером заказа',
            ),
          rows: [back()],
        }),
      );
      return true;
    }
    const noticeKey =
      'paid-notice:' + p.telegram_payment_charge_id + ':' + receipt.refund;
    if (!bot.store.get(noticeKey)) {
      await notice(bot, m.chat.id, noticeKey, ({ head, block, back }) => ({
        text:
          result.status === 'refunded'
            ? head('back', 'возврат учтён') +
              'баланс и покупки в noctgram обновлены'
            : result.status === 'paid'
              ? head('success', 'покупка готова') +
                block(
                  `${result.product === 'premium' ? 'noct premium · 30 дней' : num(result.units) + ' noct stars'}\nзаказ <code>${escape(result.id)}</code>`,
                )
              : head('history', 'проверяем платёж') +
                block(
                  `платёж сохранён\nпомощь — /paysupport ${escape(result.id)}`,
                ),
        rows: [back()],
      }));
      bot.store.set(noticeKey, true);
    }
    return true;
  }
  return false;
}
export async function handleShop(bot, update, state) {
  if (state.testMode) return false;
  const c = update.callback_query,
    m = c?.message || update.message,
    u = c?.from || m?.from;
  const chat = u.id,
    telegramId = String(u.id),
    text = m.text || '',
    data = c?.data || '',
    command = text.trim().split(/[\s@]/)[0].toLowerCase();
  const delivery = c
    ? { callbackMessageId: m.message_id }
    : { commandUpdateId: update.update_id };
  const send = (bot, chat, view) =>
    bot.render(chat, 'shop', state, {
      view,
      delivery,
    });
  const start = text.match(/^\/start(?:@[a-z0-9_]+)?\s+pay_([a-f0-9]{32})$/i);
  if (command === '/terms') {
    await send(bot, chat, ({ head, block, back }) => ({
      text: head('help', 'условия покупки') + block(terms),
      rows: [back()],
    }));
    return true;
  }
  if (command === '/paysupport' || command === '/support') {
    const detail = text.replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
    if (detail) {
      await bot.site({
        action: 'paymentSupport',
        telegramId,
        text: detail.slice(0, 1500),
        key: 'tg-' + update.update_id,
      });
      await send(bot, chat, ({ head, block, back }) => ({
        text:
          head('success', 'обращение сохранено') +
          block('номер <code>tg-' + update.update_id + '</code>'),
        rows: [back()],
      }));
    } else
      await send(bot, chat, ({ head, block, back }) => ({
        text:
          head('help', 'помощь с покупкой') +
          'опиши проблему и укажи номер заказа\n\n' +
          block('<code>/paysupport номер_заказа покупка не появилась</code>') +
          '\n\nпароли, коды входа и ключи не нужны',
        rows: [back()],
      }));
    return true;
  }
  if (start || data.startsWith('invoice:')) {
    const id = unpack(start ? start[1] : data.slice(8));
    const { invoice } = await bot.site({
      action: 'paymentInvoice',
      id,
      telegramId,
    });
    if (start) {
      await send(bot, chat, ({ head, block, button: b, back }) => ({
        text:
          head('stars', 'подтверждение покупки') +
          block(
            `<b>${escape(invoice.title)}</b>\nк оплате · ${num(invoice.prices[0].amount)} Telegram Stars`,
          ) +
          '\n\n' +
          block(terms),
        rows: [
          [
            b(
              'согласен · перейти к оплате',
              'invoice:' + id,
              'success',
              'success',
            ),
          ],
          back(),
        ],
      }));
      return true;
    }
    const key = 'invoice:' + c.id;
    if (!bot.store.get(key)) {
      const sent = await bot.telegram('sendInvoice', {
        chat_id: chat,
        ...invoice,
        start_parameter: 'pay_' + id.replaceAll('-', ''),
      });
      bot.store.set(key, sent.message_id);
    }
    return true;
  }
  if (data.startsWith('buy:')) {
    const { order } = await bot.site({
      action: 'paymentCreate',
      telegramId,
      sku: data.slice(4),
      key: 'tg_' + c.id,
      acceptedTerms: true,
    });
    const { invoice } = await bot.site({
      action: 'paymentInvoice',
      id: order.id,
      telegramId,
    });
    const key = 'invoice:' + c.id;
    if (!bot.store.get(key)) {
      const sent = await bot.telegram('sendInvoice', {
        chat_id: chat,
        ...invoice,
        start_parameter: 'pay_' + order.id.replaceAll('-', ''),
      });
      bot.store.set(key, sent.message_id);
    }
    return true;
  }
  if (
    data.startsWith('pack:') ||
    data === 'premium' ||
    command === '/premium'
  ) {
    const item = catalog.find(
      (p) =>
        p.id ===
        (data.startsWith('pack:') ? 'stars' + data.slice(5) : 'premium30'),
    );
    if (!item) return true;
    await send(bot, chat, ({ head, block, button: b, back }) => ({
      text:
        head(
          item.product === 'premium' ? 'moon' : 'stars',
          item.product === 'premium' ? 'noct premium' : 'пополнение звёзд',
        ) +
        block(
          `${item.product === 'premium' ? '30 дней · без автопродления' : num(item.units) + ' noct stars'}\nк оплате · <b>${num(item.xtr)} Telegram Stars</b>${state.linked ? '\nполучатель · @' + escape(state.profile.handle) : ''}`,
        ) +
        '\n\n' +
        block(terms),
      rows: [
        [
          b(
            `согласен · ${num(item.xtr)} Stars`,
            'buy:' + item.id,
            'success',
            'success',
          ),
        ],
        back(item.product === 'stars' ? 'packages' : 'home'),
      ],
    }));
    return true;
  }
  if (data === 'history' || command === '/history') {
    const result = await bot.site({ action: 'paymentHistory', telegramId });
    await send(bot, chat, ({ head, block, back }) => ({
      text:
        head('history', 'история покупок') +
        (result.orders
          .map((o) =>
            block(
              `${escape(catalog.find((p) => p.id === o.sku)?.title || o.sku)} · ${num(o.amountMinor)} Stars\n${o.reversedAt ? 'возврат' : o.fulfilledAt ? 'оплачено' : 'ожидает оплаты'} · <code>${escape(o.id)}</code>`,
            ),
          )
          .join('\n\n') || 'здесь появятся твои покупки'),
      rows: [back()],
    }));
    return true;
  }
  if (data === 'credit:') return true;
  if (data.startsWith('credit:')) {
    await send(bot, chat, ({ head, button: b, back }) => ({
      text:
        head('stars', 'пополнение звёзд') +
        'тестовые пополнения отключены\nвыбери пакет в новом меню',
      rows: [[b('выбрать пакет ›', 'packages', 'stars')], back()],
    }));
    return true;
  }
  if (data === 'help' || command === '/help') {
    await send(bot, chat, ({ head, block, back }) => ({
      text: head('help', 'о покупках') + block(terms),
      rows: [back()],
    }));
    return true;
  }
  if (
    data === 'settings' ||
    data.startsWith('toggle:') ||
    command === '/settings'
  )
    return false;
  if (!state.linked) {
    await bot.render(chat, 'home', state, { delivery });
    return true;
  }
  if (data === 'packages' || command === '/topup') {
    await send(bot, chat, ({ head, block, button: b, back }) => ({
      text:
        head('stars', 'noct stars') +
        'подарки и поддержка авторов в noctgram\n\n' +
        block(
          `получатель · @${escape(state.profile.handle)}\nчем больше пакет — тем выгоднее цена за звезду`,
        ) +
        '\n\nвыбери пакет · оплата Telegram Stars',
      rows: [
        ...catalog
          .filter((p) => p.product === 'stars')
          .map((p) => [
            b(
              `${num(p.units)} Noct Stars · ${num(p.xtr)} Stars`,
              'pack:' + p.units,
              'stars',
            ),
          ]),
        back(),
      ],
    }));
    return true;
  }
  await send(bot, chat, ({ head, block, emoji, button: b }) => ({
    text:
      head('moon', 'noctgram') +
      'маленькие звёзды — большая поддержка\n\n' +
      block(
        `@${escape(state.profile.handle)}\n${emoji('balance')} баланс · <b>${num(state.balance)} noct stars</b>`,
      ) +
      '\n\nпополни баланс или добавь больше оформления с premium',
    rows: [
      [b('пополнить noct stars ›', 'packages', 'stars')],
      [b('noct premium · 30 дней ›', 'premium', 'moon')],
      [
        b('история ›', 'history', 'history'),
        b('оформление ›', 'settings', 'settings'),
      ],
      [b('помощь ›', 'help', 'help')],
    ],
  }));
  return true;
}
