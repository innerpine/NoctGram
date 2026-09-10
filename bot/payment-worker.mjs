export function normalizeStarTransaction(tx) {
  const incoming = !!tx.source && !tx.receiver,
    outgoing = !!tx.receiver && !tx.source;
  if (!incoming && !outgoing) return null;
  const p = incoming ? tx.source : tx.receiver;
  if (p.type !== 'user' || p.transaction_type !== 'invoice_payment')
    return null;
  if (
    !Number.isSafeInteger(tx.amount) ||
    tx.amount <= 0 ||
    (tx.nanostar_amount || 0) !== 0 ||
    !Number.isSafeInteger(p.user?.id) ||
    p.affiliate ||
    p.subscription_period
  )
    return { review: true, chargeId: tx.id };
  return {
    action: 'paymentReceipt',
    chargeId: tx.id,
    id: p.invoice_payload || null,
    refund: outgoing,
    telegramId: String(p.user.id),
    currency: 'XTR',
    amount: tx.amount,
  };
}
export const paymentKey = (e) =>
  'pending-payment:' + e.chargeId + ':' + (e.refund ? 'refund' : 'paid');
export async function deliverReceipt(bot, event) {
  try {
    if (!event.id) {
      const resolved = await bot.site({
        action: 'paymentResolveReceipt',
        chargeId: event.chargeId,
      });
      event = { ...event, id: resolved.id };
    }
    if (!event.id) {
      bot.store.set('payment-review:' + event.chargeId, event);
      return null;
    }
    return await bot.site(event);
  } catch (e) {
    if (e.service === 'site' && [400, 403, 404, 409].includes(e.status)) {
      bot.store.set('payment-review:' + event.chargeId, {
        ...event,
        errorCode: e.status,
      });
      return null;
    }
    throw e;
  }
}
export async function reconcilePayments(bot) {
  const { store, telegram, site } = bot;
  // Scan all history in bounded pages, repeatedly. Moving offsets are covered by
  // the next pass; same charge ID is deduplicated separately for paid and refund.
  const offset = store.get('star-scan-offset') || 0;
  const page = await telegram('getStarTransactions', { offset, limit: 100 });
  for (const tx of page.transactions) {
    const event = normalizeStarTransaction(tx);
    if (!event) continue;
    if (event.review) {
      store.set('payment-review:' + event.chargeId, event);
      continue;
    }
    const key = paymentKey(event);
    if (!store.get('delivered:' + key)) store.set(key, event);
  }
  store.set(
    'star-scan-offset',
    page.transactions.length < 100 ? 0 : offset + 100,
  );
  for (const entry of store
    .entries('pending-payment:')
    .filter((e) => e.value)
    .slice(0, 30)) {
    try {
      await deliverReceipt(bot, entry.value);
      store.set('delivered:' + entry.key, true);
      store.set(entry.key, null);
    } catch {
      /* Durable outbox retries independently of incoming updates. */
    }
  }
  // The server selects only duplicate charges or deleted-before-delivery cases.
  // A user's support request alone never authorizes an automatic refund.
  const jobs = await site({ action: 'paymentRefunds' });
  for (const job of jobs.receipts) {
    const key = 'refund-attempt:' + job.chargeId,
      last = store.get(key) || 0;
    if (Date.now() - last < 5 * 60000) continue;
    store.set(key, Date.now());
    try {
      if (
        (await telegram('refundStarPayment', {
          user_id: Number(job.telegramId),
          telegram_payment_charge_id: job.chargeId,
        })) !== true
      )
        continue;
      const event = { action: 'paymentReceipt', ...job, refund: true };
      store.set(paymentKey(event), event);
      await deliverReceipt(bot, event);
      store.set(paymentKey(event), null);
    } catch {
      /* Ambiguous failures are checked against provider history next pass. */
    }
  }
  await site({ action: 'paymentReconcile' });
  store.set('lastPaymentReconcileAt', Date.now());
}
export function startBotWorkers(bot, _signal) {
  let processing = false,
    reconciling = false,
    stopped = false;
  const runUpdates = async () => {
    if (processing || stopped) return;
    processing = true;
    try {
      for (const update of bot.store.pending()) {
        if (stopped) break;
        try {
          await bot.handle(update);
          bot.store.complete(update.update_id);
          bot.store.set('lastHandledAt', Date.now());
        } catch (e) {
          if (e.service === 'telegram' && [400, 403].includes(e.status))
            bot.store.complete(update.update_id);
          else bot.store.retry(update.update_id);
        }
      }
    } finally {
      processing = false;
    }
  };
  const runPayments = async () => {
    if (reconciling || stopped) return;
    reconciling = true;
    try {
      await reconcilePayments(bot);
    } catch {
      if (!stopped)
        console.warn('Проверка платежей отложена; квитанции сохранены.');
    } finally {
      reconciling = false;
    }
  };
  const jobs = setInterval(() => void runUpdates(), 750),
    payments = setInterval(() => void runPayments(), 60000);
  void runUpdates();
  void runPayments();
  return async () => {
    stopped = true;
    clearInterval(jobs);
    clearInterval(payments);
    while (processing || reconciling)
      await new Promise((resolve) => setTimeout(resolve, 25));
  };
}
