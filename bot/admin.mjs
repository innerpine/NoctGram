import { escape, num } from './screens.mjs';

export function parseAdminIds(value = '') {
  return [
    ...new Set(
      String(value)
        .split(/[\s,]+/)
        .filter(
          (id) =>
            /^[1-9]\d{0,15}$/.test(id) && Number.isSafeInteger(Number(id)),
        ),
    ),
  ];
}
export function isBotAdmin(bot, id) {
  return (bot.adminIds || []).includes(String(id));
}
export async function syncAdminCommands(telegram, ids) {
  const admins = parseAdminIds(ids);
  if (!admins.length) return;
  const commands = await telegram('getMyCommands');
  for (const admin of admins)
    await telegram('setMyCommands', {
      scope: { type: 'chat', chat_id: Number(admin) },
      commands: [
        { command: 'admin', description: 'Админ-панель · пополнения и баланс' },
        ...commands.filter((command) => command.command !== 'admin'),
      ],
    });
}
const enabled = (bot) =>
  bot.adminIds?.length &&
  Number.isFinite(bot.adminNotificationsSince) &&
  bot.adminNotificationsSince > 0;
const pendingKey = (admin, id) => `admin-payment-pending:${admin}:${id}`;
const sentKey = (admin, id) => `admin-payment-sent:${admin}:${id}`;
const date = (at) =>
  new Date(at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Kyiv',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// Recheck recent provider receipts even when the old bot already delivered them
// before notifications were enabled. The site's credit remains idempotent.
export function needsAdminReceipt(bot, event, providerDate) {
  return !!(
    enabled(bot) &&
    !event.refund &&
    Number.isSafeInteger(providerDate) &&
    providerDate * 1000 + 999 >= bot.adminNotificationsSince &&
    !bot.store.get('admin-receipt-checked:' + event.chargeId)
  );
}

// Called only with the authenticated website's result, after its credit commits.
// No network call here: an admin's Telegram failure cannot undo a purchase.
export function recordAdminTopup(bot, event, order) {
  if (!enabled(bot) || !order || order.id !== event.id) return;
  const key = 'admin-topup:' + order.id;
  if (order.status === 'refunded' || order.reversedAt) {
    const previous = bot.store.get(key);
    if (previous)
      bot.store.set(key, {
        ...previous,
        reversedAt: order.reversedAt || Date.now(),
      });
    for (const admin of bot.adminIds)
      bot.store.set(pendingKey(admin, order.id), null);
  } else if (
    !event.refund &&
    order.status === 'paid' &&
    order.product === 'stars' &&
    order.provider === 'telegram' &&
    order.currency === 'XTR' &&
    event.currency === 'XTR' &&
    Number.isSafeInteger(order.fulfilledAt) &&
    order.fulfilledAt >= bot.adminNotificationsSince &&
    Number.isSafeInteger(order.units) &&
    order.units > 0 &&
    Number.isSafeInteger(order.amountMinor) &&
    order.amountMinor > 0 &&
    order.amountMinor === event.amount &&
    /^[1-9]\d{0,15}$/.test(event.telegramId) &&
    Number.isSafeInteger(Number(event.telegramId))
  ) {
    const topup = {
      id: order.id,
      units: order.units,
      amount: order.amountMinor,
      telegramId: event.telegramId,
      paidAt: order.fulfilledAt,
      reversedAt: null,
    };
    // A late paid replay must not resurrect a refund already observed by this bot.
    if (!bot.store.get(key)?.reversedAt) {
      bot.store.set(key, topup);
      for (const admin of bot.adminIds) {
        const pending = pendingKey(admin, order.id);
        if (!bot.store.get(sentKey(admin, order.id)) && !bot.store.get(pending))
          bot.store.set(pending, {
            admin,
            orderId: order.id,
            attempts: 0,
            nextAt: 0,
          });
      }
    }
  }
  bot.store.set('admin-receipt-checked:' + event.chargeId, true);
}

export async function flushAdminNotifications(bot, now = Date.now()) {
  if (!enabled(bot) || bot.flushingAdminNotifications) return;
  bot.flushingAdminNotifications = true;
  try {
    const entries = bot.store
      .entries('admin-payment-pending:')
      .filter(({ value }) => value && value.nextAt <= now)
      .slice(0, 10);
    for (const { key, value: job } of entries) {
      const topup = bot.store.get('admin-topup:' + job.orderId);
      if (
        !isBotAdmin(bot, job.admin) ||
        !topup ||
        topup.reversedAt ||
        bot.store.get(sentKey(job.admin, job.orderId))
      ) {
        bot.store.set(key, null);
        continue;
      }
      try {
        const sent = await bot.telegram('sendMessage', {
          chat_id: Number(job.admin),
          text:
            '<b>✅ Успешное пополнение Noct Stars</b>\n\n' +
            `Начислено: <b>${num(topup.units)} Noct Stars</b>\n` +
            `Оплачено: <b>${num(topup.amount)} Telegram Stars</b>\n` +
            `Покупатель: <a href="tg://user?id=${topup.telegramId}">${topup.telegramId}</a>\n` +
            `Заказ: <code>${escape(topup.id)}</code>\n${date(topup.paidAt)} (Киев)`,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Админ-панель', callback_data: 'admin:home' }],
            ],
          },
        });
        bot.store.set(sentKey(job.admin, job.orderId), {
          at: now,
          messageId: sent.message_id,
        });
        bot.store.set('lastAdminNotificationAt', now);
        bot.store.set(key, null);
      } catch (error) {
        const attempts = job.attempts + 1;
        const delay =
          error.status === 400 || error.status === 403
            ? 3600000
            : Math.max(
                (error.retryAfter || 0) * 1000,
                Math.min(3600000, 15000 * 2 ** Math.min(attempts, 8)),
              );
        bot.store.set(key, { ...job, attempts, nextAt: now + delay });
      }
    }
  } finally {
    bot.flushingAdminNotifications = false;
  }
}

export async function handleAdmin(bot, update) {
  const callback = update.callback_query;
  const message = callback?.message || update.message;
  const user = callback?.from || message?.from;
  const command = (message?.text || '').trim().split(/[\s@]/)[0].toLowerCase();
  if (!(callback?.data || '').startsWith('admin:') && command !== '/admin')
    return false;
  if (
    !message ||
    message.chat?.type !== 'private' ||
    !user ||
    user.is_bot ||
    user.id !== message.chat.id
  )
    return true;
  const delivery = callback
    ? { callbackMessageId: message.message_id }
    : { commandUpdateId: update.update_id };
  if (!isBotAdmin(bot, user.id)) {
    await bot.render(user.id, 'error', null, {
      delivery,
      message: 'Админ-панель недоступна этому аккаунту.',
    });
    return true;
  }
  const topups = bot.store
    .entries('admin-topup:')
    .map(({ value }) => value)
    .filter(Boolean)
    .sort((a, b) => b.paidAt - a.paidAt);
  const paid = topups.filter((topup) => !topup.reversedAt);
  let balance = 'временно недоступен';
  try {
    const value = await bot.telegram('getMyStarBalance');
    if (
      Number.isSafeInteger(value.amount) &&
      Number.isSafeInteger(value.nanostar_amount || 0)
    )
      balance =
        num(value.amount + (value.nanostar_amount || 0) / 1e9) +
        ' Telegram Stars';
  } catch {
    /* The admin panel remains available while Telegram statistics fail. */
  }
  const pending = bot.store
    .entries('admin-payment-pending:')
    .filter(({ value }) => value?.admin === String(user.id)).length;
  await bot.render(user.id, 'admin', null, {
    delivery,
    view: () => ({
      text:
        '<b>Админ-панель · NoctGram Pay</b>\n\n' +
        `Баланс бота: <b>${balance}</b>\n` +
        `Уведомления о пополнениях: <b>${enabled(bot) ? 'включены' : 'не настроены'}</b>\n` +
        `В очереди уведомлений: ${num(pending)}\n\n` +
        (enabled(bot)
          ? `<b>Пополнения с ${date(bot.adminNotificationsSince)} (Киев)</b>\n`
          : '<b>Пополнения</b>\n') +
        `${num(paid.length)} оплат · ${num(paid.reduce((n, p) => n + p.amount, 0))} Telegram Stars\n` +
        `Начислено: ${num(paid.reduce((n, p) => n + p.units, 0))} Noct Stars\n\n` +
        '<b>Последние пополнения</b>\n' +
        (topups
          .slice(0, 8)
          .map(
            (p) =>
              `${p.reversedAt ? '↩ Возврат' : '✅'} ${num(p.units)} Noct Stars ← ${num(p.amount)} Telegram Stars\n` +
              `${p.telegramId} · ${date(p.paidAt)}\n<code>${escape(p.id)}</code>`,
          )
          .join('\n\n') || 'Новых пополнений пока нет.'),
      rows: [
        [{ text: 'Обновить', callback_data: 'admin:home' }],
        [{ text: 'Главное меню', callback_data: 'home' }],
      ],
    }),
  });
  return true;
}
