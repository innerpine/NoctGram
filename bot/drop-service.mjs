// Queue delivery is separate from polling so one inaccessible chat cannot block it.
export class DropRetryError extends Error {
  constructor(offset, retryAfter = 0) {
    super('Telegram delivery must be retried.');
    this.offset = offset;
    this.retryAfter = retryAfter;
  }
}

export function dropRetryDelayMs(error) {
  const requested = Number(error?.retryAfter) * 1000;
  return Number.isFinite(requested) && requested > 0
    ? Math.max(3000, Math.ceil(requested))
    : 3000;
}

export async function deliverDropUpdates({
  updates,
  telegram,
  url,
  offset = 0,
  stopped = () => false,
}) {
  for (const update of updates) {
    if (stopped()) break;
    if (update.update_id < offset) continue;
    const message = update.message;
    if (
      message?.chat?.type === 'private' &&
      /^\/(start|help)(?:@\w+)?(?:\s|$)/.test(message.text || '')
    ) {
      try {
        await telegram('sendMessage', {
          chat_id: message.chat.id,
          text: '🌙 Noct Gifts\n\nОткрывайте кейсы и улучшайте подарки. Выигранные подарки сразу появляются в вашем профиле NoctGram, баланс Stars общий.\n\nДля входа привяжите Telegram: NoctGram → Noct Stars → Telegram. Затем откройте приложение кнопкой ниже.',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Открыть Noct Gifts', web_app: { url } }],
              [{ text: 'Открыть NoctGram', url: 'https://noctgram.com' }],
            ],
          },
        });
      } catch (error) {
        // Blocked users and permanently invalid chats are acknowledged. A
        // transient failure keeps this update pending, but not earlier replies.
        if (error?.status !== 400 && error?.status !== 403) {
          throw new DropRetryError(offset, error?.retryAfter);
        }
      }
    }
    offset = Math.max(offset, update.update_id + 1);
  }
  return offset;
}
