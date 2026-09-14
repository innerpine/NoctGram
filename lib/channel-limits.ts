export const MAX_OWNED_CHANNELS = 2;
export const MAX_CHANNEL_HANDLES = 3;
export const profileHandleLimit = (kind?: string) =>
  kind === 'channel' ? MAX_CHANNEL_HANDLES : 5;
export const CHANNEL_HANDLE_LIMIT_MESSAGE =
  'У канала может быть максимум 3 юзернейма: основной и 2 дополнительных.';
export const CHANNEL_LIMIT_MESSAGE =
  'Можно владеть максимум двумя каналами. Лимит уже достигнут.';
