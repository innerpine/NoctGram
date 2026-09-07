import { createHmac } from 'node:crypto';
import { RemoteError } from './transport.mjs';
import { screen, num } from './screens.mjs';
export class NoctBot {
  constructor({
    telegram,
    site,
    store,
    secret,
    siteUrl,
    emojiAvailable = false,
  }) {
    Object.assign(this, {
      telegram,
      site,
      store,
      secret,
      siteUrl,
      emojiAvailable,
    });
  }
  async render(chatId, name, state, extra = {}) {
    const key = 'chat:' + chatId;
    const preferences = this.store.get(key) || {};
    const view = screen(name, state, {
      preferences,
      emojiAvailable: this.emojiAvailable,
      siteUrl: this.siteUrl,
      ...extra,
    });
    const body = {
      chat_id: chatId,
      text: view.text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: view.rows },
    };
    if (preferences.messageId) {
      try {
        await this.telegram('editMessageText', {
          ...body,
          message_id: preferences.messageId,
        });
        return;
      } catch (e) {
        if (
          e instanceof RemoteError &&
          e.status === 400 &&
          /message is not modified/i.test(e.message)
        )
          return;
        if (
          !(
            e instanceof RemoteError &&
            e.status === 400 &&
            /message to edit not found|message can't be edited/i.test(e.message)
          )
        )
          throw e;
      }
    }
    const sent = await this.telegram('sendMessage', body);
    this.store.set(key, { ...preferences, messageId: sent.message_id });
  }
  async statusLine(chatId, state) {
    const key = 'chat:' + chatId,
      preferences = this.store.get(key) || {};
    if (!preferences.pinned) return;
    const text = `noct stars · ${state.linked ? num(state.balance) + ' звёзд' : 'аккаунт не привязан'} · тест`;
    if (preferences.statusText === text && preferences.statusPinned) return;
    if (preferences.statusMessageId) {
      try {
        await this.telegram('editMessageText', {
          chat_id: chatId,
          message_id: preferences.statusMessageId,
          text,
        });
      } catch (e) {
        if (
          !(
            e instanceof RemoteError &&
            e.status === 400 &&
            /message is not modified/i.test(e.message)
          )
        ) {
          if (
            e instanceof RemoteError &&
            e.status === 400 &&
            /message to edit not found|message can't be edited/i.test(e.message)
          )
            preferences.statusMessageId = null;
          else throw e;
        }
      }
    }
    if (!preferences.statusMessageId) {
      const sent = await this.telegram('sendMessage', {
        chat_id: chatId,
        text,
        disable_notification: true,
      });
      preferences.statusMessageId = sent.message_id;
      preferences.statusPinned = false;
      this.store.set(key, preferences);
    }
    if (!preferences.statusPinned)
      await this.telegram('pinChatMessage', {
        chat_id: chatId,
        message_id: preferences.statusMessageId,
        disable_notification: true,
      });
    this.store.set(key, {
      ...preferences,
      statusText: text,
      statusPinned: true,
    });
  }
  async handle(update) {
    const callback = update.callback_query,
      message = callback?.message || update.message;
    const user = callback?.from || message?.from;
    if (callback) {
      try {
        await this.telegram('answerCallbackQuery', {
          callback_query_id: callback.id,
        });
      } catch (e) {
        if (!(e instanceof RemoteError && [400, 403].includes(e.status)))
          throw e;
      }
    }
    if (
      !message ||
      message.chat?.type !== 'private' ||
      !user ||
      user.is_bot ||
      user.id !== message.chat.id
    )
      return;
    const chatId = user.id,
      telegramId = String(user.id);
    const data = callback?.data || '';
    const text = message.text || '';
    // A bot cannot prove an inbound transaction. This runtime never handles money.
    if (message.successful_payment || message.refunded_payment) return;
    try {
      const start = text.match(
        /^\/start(?:@[a-z0-9_]+)?\s+link_([a-f0-9]{32})$/i,
      );
      if (!callback && start) {
        // Stable across retries/crashes; the proof is never exposed by the site API.
        const digest = createHmac('sha256', this.secret)
          .update('link:' + start[1] + ':' + telegramId)
          .digest();
        const code = String(digest.readUInt32BE(0) % 100000000).padStart(
          8,
          '0',
        );
        await this.site({
          action: 'claim',
          telegramId,
          token: start[1],
          code,
          name: [user.first_name, user.last_name].filter(Boolean).join(' '),
          username: user.username || '',
        });
        await this.render(chatId, 'proof', null, { code });
        return;
      }
      const state = await this.site({ action: 'status', telegramId });
      if (data.startsWith('toggle:')) {
        const option = data.slice(7);
        if (
          !['rich', 'customEmoji', 'pinned'].includes(option) ||
          (option === 'customEmoji' && !this.emojiAvailable)
        )
          return;
        const key = 'chat:' + chatId,
          preferences = this.store.get(key) || {};
        // Replayed updates must not invert a toggle a second time.
        if (preferences.lastToggle !== update.update_id) {
          const value =
            option === 'rich'
              ? preferences.rich !== false
              : !!preferences[option];
          this.store.set(key, {
            ...preferences,
            [option]: !value,
            lastToggle: update.update_id,
          });
        }
        const current = this.store.get(key);
        if (option === 'pinned' && !current.pinned && current.statusPinned) {
          await this.telegram('unpinChatMessage', {
            chat_id: chatId,
            message_id: current.statusMessageId,
          });
          this.store.set(key, { ...current, statusPinned: false });
        }
        await this.render(chatId, 'settings', state);
      } else if (data.startsWith('pack:') && state.linked) {
        const { order } = await this.site({
          action: 'order',
          telegramId,
          amount: Number(data.slice(5)),
          key: 'callback_' + callback.id,
        });
        await this.render(
          chatId,
          order.status === 'credited' ? 'success' : 'confirm',
          state,
          { order },
        );
      } else if (data.startsWith('credit:') && state.linked) {
        const result = await this.site({
          action: 'credit',
          telegramId,
          id: data.slice(7),
        });
        await this.render(chatId, 'success', result, { order: result.order });
        await this.statusLine(chatId, result);
        return;
      } else {
        const command = text.split(/[ @]/)[0];
        const page = ['packages', 'history', 'settings', 'help'].includes(data)
          ? data
          : {
              '/topup': 'packages',
              '/history': 'history',
              '/help': 'help',
              '/settings': 'settings',
            }[command] || 'home';
        await this.render(chatId, page, state);
      }
      await this.statusLine(chatId, state);
    } catch (e) {
      if (
        e instanceof RemoteError &&
        e.service === 'site' &&
        [400, 403, 404, 409, 410, 429].includes(e.status)
      ) {
        await this.render(chatId, 'error', null, {
          message: e.message.toLocaleLowerCase('ru-RU'),
        });
        return;
      }
      // Telegram custom-emoji permissions can change. Retry with readable fallbacks.
      if (
        e instanceof RemoteError &&
        e.service === 'telegram' &&
        e.status === 400 &&
        /emoji|entity|entities/i.test(e.message) &&
        this.emojiAvailable
      ) {
        this.emojiAvailable = false;
        return this.handle(update);
      }
      throw e;
    }
  }
}
