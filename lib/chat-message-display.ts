import { emojiFallback } from './premium-emoji';
import type { Message } from './client';
export function messageSummary(
  message: Pick<Message, 'text' | 'attachments' | 'gift'> &
    Partial<Pick<Message, 'postShare' | 'sticker'>>,
) {
  return (
    emojiFallback(message.text) ||
    message.attachments
      ?.map((file) =>
        file.kind === 'image'
          ? 'Фото'
          : file.kind === 'video'
            ? 'Видео'
            : file.kind === 'voice'
              ? 'Голосовое сообщение'
              : file.kind === 'round'
                ? 'Видеосообщение'
                : file.name,
      )
      .join(', ') ||
    (message.gift
      ? 'Подарок'
      : message.sticker
        ? 'Стикер'
        : message.postShare
          ? 'Публикация'
          : 'Сообщение')
  );
}
export function sortedPins(messages: Message[]) {
  return messages
    .filter((message) => message.pinnedAt)
    .sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
}
