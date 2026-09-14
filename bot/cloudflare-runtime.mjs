import { CloudflareBotStore } from './cloudflare-store.mjs';
import { NoctBot } from './handler.mjs';
import { reconcilePayments } from './payment-worker.mjs';
import { siteTransport, telegramTransport } from './transport.mjs';
import { flushAdminNotifications } from './admin.mjs';

export class CloudflareBotRuntime {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.store = new CloudflareBotStore(ctx.storage.sql);
    this.bot = new NoctBot({
      store: this.store,
      telegram: telegramTransport(env.TELEGRAM_BOT_TOKEN),
      site: siteTransport(env.NOCT_SITE_URL, env.NOCT_BOT_SECRET),
      secret: env.NOCT_BOT_SECRET,
      siteUrl: env.NOCT_SITE_URL,
      emojiAvailable: env.NOCT_BOT_CUSTOM_EMOJI === '1',
      adminIds: env.NOCT_BOT_ADMIN_IDS,
      adminNotificationsSince: env.NOCT_BOT_ADMIN_NOTIFICATIONS_SINCE,
    });
  }
  async wake(at = Date.now() + 1000) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }
  async accept(update) {
    if (update.pre_checkout_query) {
      // A checkout must answer within ten seconds, even while another command
      // or payment reconciliation is waiting for a slow external service.
      await this.bot.handle(update);
    } else {
      this.store.enqueue(update);
      // Persist BOTH the update and its recovery alarm before acknowledging.
      await this.wake();
    }
  }
  async runUpdates() {
    if (this.processing) return;
    this.processing = true;
    try {
      for (const update of this.store.pending()) {
        try {
          await this.bot.handle(update);
          this.store.complete(update.update_id);
          this.store.set('lastHandledAt', Date.now());
        } catch (e) {
          // A refused outgoing message cannot cancel a stored payment receipt.
          if (e.service === 'telegram' && [400, 403].includes(e.status))
            this.store.complete(update.update_id);
          else this.store.retry(update.update_id);
        }
      }
    } finally {
      this.processing = false;
    }
  }
  async runPayments() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await reconcilePayments(this.bot);
      this.store.set('lastReconcileError', null);
    } catch (e) {
      // Never store URLs, provider bodies, receipt contents or token-bearing errors.
      this.store.set('lastReconcileError', {
        at: Date.now(),
        service: ['telegram', 'site'].includes(e.service)
          ? e.service
          : 'runtime',
        status: Number.isInteger(e.status) ? e.status : 500,
      });
    } finally {
      this.reconciling = false;
    }
  }
  async alarm() {
    // Schedule recovery first; a process interruption cannot orphan the queue.
    await this.wake(Date.now() + 60000);
    await Promise.all([this.runUpdates(), this.runPayments()]);
    await flushAdminNotifications(this.bot);
    this.store.cleanup();
    const next = this.store.nextRetry();
    if (next !== null) await this.wake(Math.max(Date.now() + 1000, next));
  }
}
