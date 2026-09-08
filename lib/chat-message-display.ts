import type { Message } from './client';
export function messageSummary(
  message: Pick<Message, 'text' | 'attachments' | 'gift'>,
) {
  return (
    message.text ||
    message.attachments
      ?.map((file) =>
        file.kind === 'image'
          ? 'Фото'
          : file.kind === 'video'
            ? 'Видео'
            : file.name,
      )
      .join(', ') ||
    (message.gift ? 'Подарок' : 'Сообщение')
  );
}
export function sortedPins(messages: Message[]) {
  return messages
    .filter((message) => message.pinnedAt)
    .sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
}
