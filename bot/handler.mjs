import { createHmac } from 'node:crypto';
import { RemoteError } from './transport.mjs';
import { screen, num } from './screens.mjs';
import { handlePaymentUpdate, handleShop } from './payments.mjs';
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
  recordDelivery(message) {
    if (!message || typeof message.text !== 'string') return;
    // Capability diagnostics only; never persist message text or link proofs.
    this.store.set('lastDelivery', {
      at: Date.now(),
      customEmoji: (message.entities || []).filter(
        (e) => e.type === 'custom_emoji',
      ).length,
      customButtons: (message.reply_markup?.inline_keyboard || [])
        .flat()
        .filter((b) => b.icon_custom_emoji_id).length,
    });
  }
  async render(chatId, name, state, extra = {}) {
    try {
      return await this.renderOnce(chatId, name, state, extra);
    } catch (e) {
      // All screens, including error/proof screens, must remain deliverable when
      // Telegram denies custom emoji. Retrying rendering never repeats a credit.
      if (
        e instanceof RemoteError &&
        e.service === 'telegram' &&
        e.status === 400 &&
        /emoji|entity|entities/i.test(e.message) &&
        this.emojiAvailable
      ) {
        this.emojiAvailable = false;
        return this.renderOnce(chatId, name, state, extra);
      }
      throw e;
    }
  }
  async renderOnce(chatId, name, state, extra = {}) {
    const key = 'chat:' + chatId;
    const preferences = this.store.get(key) || {};
    const { delivery = {}, ...screenOptions } = extra;
    const view = screen(name, state, {
      preferences,
      emojiAvailable: this.emojiAvailable,
      siteUrl: this.siteUrl,
      ...screenOptions,
    });
    const body = {
      chat_id: chatId,
      text: view.text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: view.rows },
    };
    // Commands need a visible reply below the user's message. Button navigation
    // edits the panel actually clicked, including an older panel above the chat.
    const commandUpdateId = delivery.commandUpdateId;
    const messageId =
      delivery.callbackMessageId ||
      (commandUpdateId !== undefined
        ? preferences.lastCommandUpdate === commandUpdateId
          ? preferences.lastCommandMessageId
          : undefined
        : preferences.messageId);
    if (messageId) {
      try {
        const edited = await this.telegram('editMessageText', {
          ...body,
          message_id: messageId,
        });
        this.recordDelivery(edited);
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
    this.store.set(key, {
      ...preferences,
      messageId: sent.message_id,
      ...(commandUpdateId !== undefined
        ? {
            lastCommandUpdate: commandUpdateId,
            lastCommandMessageId: sent.message_id,
          }
        : {}),
    });
    this.recordDelivery(sent);
  }
  async statusLine(chatId, state) {
    const key = 'chat:' + chatId,
      preferences = this.store.get(key) || {};
    if (!preferences.pinned) return;
    const text = `noct stars · ${state.linked ? num(state.balance) + ' звёзд' : 'аккаунт не привязан'}${state.testMode ? ' · тест' : ''}`;
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
    if (await handlePaymentUpdate(this, update)) return;
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
    const delivery = callback
      ? { callbackMessageId: message.message_id }
      : { commandUpdateId: update.update_id };
    const render = (name, state, extra = {}) =>
      this.render(chatId, name, state, { ...extra, delivery });
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
        await render('proof', null, { code });
        return;
      }
      const state = await this.site({ action: 'status', telegramId });
      if (await handleShop(this, update, state)) {
        await this.statusLine(chatId, state);
        return;
      }
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
            option === 'rich' || option === 'customEmoji'
              ? preferences[option] !== false
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
        await render('settings', state);
      } else if (data.startsWith('pack:') && state.linked) {
        const { order } = await this.site({
          action: 'order',
          telegramId,
          amount: Number(data.slice(5)),
          key: 'callback_' + callback.id,
        });
        await render(
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
        await render('success', result, { order: result.order });
        await this.statusLine(chatId, result);
        return;
      } else {
        const command = text.trim().split(/[\s@]/)[0].toLowerCase();
        const page = ['packages', 'history', 'settings', 'help'].includes(data)
          ? data
          : {
              '/topup': 'packages',
              '/history': 'history',
              '/help': 'help',
              '/settings': 'settings',
            }[command] || 'home';
        await render(page, state);
      }
      await this.statusLine(chatId, state);
    } catch (e) {
      if (
        e instanceof RemoteError &&
        e.service === 'site' &&
        [400, 403, 404, 409, 410, 429].includes(e.status)
      ) {
        await render('error', null, {
          message: e.message.toLocaleLowerCase('ru-RU'),
        });
        return;
      }
      throw e;
    }
  }
}
